import { extractionFail as fail } from "./extraction-values.js";
import { recordContent, type Op, type Scope } from "./pdf-content.js";
import { finiteNumber } from "./pdf-decode.js";
import type { FontRegistry, ProjectedFont } from "./pdf-fonts.js";
import type { PdfFile, PdfStream } from "./pdf-objects.js";
import {
  numeric,
  serialize,
  serializeName,
  type PdfValue,
} from "./pdf-syntax.js";
/** BR-418: the running and final text-production admission. */
export class Production {
  n = 0;
  s = 0;
  o = 0;
  pages = 0;
  canonical = 0;
  private readonly bytesByFont = new Map<ProjectedFont, number>();
  constructor(private readonly budget: number) {}
  shown(font: ProjectedFont, bytes: number, codes: number) {
    this.n += bytes;
    this.s += codes;
    this.bytesByFont.set(font, (this.bytesByFont.get(font) ?? 0) + bytes);
  }
  private items() {
    return 2 * (this.s + this.o + this.pages);
  }
  /** BR-418/419: canonical tokens the sum of I can still admit. */
  allowance() {
    return 32768 - (this.s + this.o + this.pages);
  }
  check() {
    if (this.canonical > this.budget || this.items() > 65536)
      fail("LIMIT_EXCEEDED");
    if (8 * (this.n + this.o + this.pages) + 3 * (this.pages - 1) > this.budget)
      fail("LIMIT_EXCEEDED");
  }
  /** BR-418: the sum of U with each font's final m, after the last page. */
  final() {
    let weighted = 0;
    for (const [font, bytes] of this.bytesByFont) weighted += bytes * font.m;
    const producerBytes = 8 * (weighted + this.o + this.pages);
    if (
      producerBytes + 3 * (this.pages - 1) > this.budget ||
      this.items() > 65536
    )
      fail("LIMIT_EXCEEDED");
    return { producerBytes, producerItems: this.items() };
  }
}
/** BR-416/418: the canonical content stream of one page (observable by tests). */
export class CanonicalContent {
  readonly parts: string[] = [];
  readonly fonts = new Set<ProjectedFont>();
  emit(text: string) {
    this.parts.push(text);
  }
  bytes() {
    return Buffer.from(this.parts.join("\n"), "latin1");
  }
}
interface Item {
  /** The token text; a `Tf` builds it once its font has its canonical name. */
  text: string | (() => string);
  op: string;
  font?: ProjectedFont;
  /** Counts a text-show once the tokens buffered before it are written. */
  shown?: () => void;
}
interface Frame {
  items: Item[];
  live: boolean;
  /** Tokens past the allowance were dropped: a later text-show can only refuse. */
  overflow: boolean;
}
/**
 * BR-419: buffers a Form's tokens until it shows text; text-free Forms emit
 * nothing. At most one token more than the sum of I can still admit is held
 * (observable by tests), so writing the held tokens refuses at the same token.
 */
export class Emitter {
  private readonly frames: Frame[] = [];
  private depth = 0;
  private held = 0;
  private overflowed = 0;
  constructor(
    private readonly sink: CanonicalContent,
    private readonly production: Production,
    private readonly nameOf: (font: ProjectedFont) => string,
  ) {}
  push() {
    this.frames.push({ items: [], live: false, overflow: false });
  }
  pop() {
    const frame = this.frames.pop();
    if (!frame || frame.live) return;
    this.held -= frame.items.length;
    if (frame.overflow) this.overflowed--;
  }
  emit(item: Item) {
    const top = this.frames.at(-1);
    if (!top || top.live) this.write(item);
    else if (this.overflowed === 0 && this.held <= this.production.allowance())
      this.hold(top, item);
    else if (!top.overflow) {
      top.overflow = true;
      this.overflowed++;
    }
  }
  hold(frame: Frame, item: Item) {
    frame.items.push(item);
    this.held++;
  }
  show(item: Item) {
    let overflow = false;
    for (const frame of this.frames) {
      if (frame.live) continue;
      frame.live = true;
      overflow ||= frame.overflow;
      for (const buffered of frame.items) this.write(buffered);
      frame.items = [];
    }
    this.held = 0;
    this.overflowed = 0;
    if (overflow) fail("LIMIT_EXCEEDED");
    this.write(item);
  }
  private write(item: Item) {
    if (item.op === "q" && ++this.depth > 32) fail("UNSUPPORTED_FORMAT");
    if (item.op === "Q") this.depth--;
    if (item.font) {
      this.nameOf(item.font);
      this.sink.fonts.add(item.font);
    }
    item.shown?.();
    const text = typeof item.text === "string" ? item.text : item.text();
    this.sink.emit(text);
    this.production.o++;
    this.production.canonical += Buffer.byteLength(text, "latin1") + 1;
    this.production.check();
  }
}
function operandText(v: PdfValue): string {
  return serialize(v);
}
function opText(op: string, operands: PdfValue[]) {
  return [...operands.map(operandText), op].join(" ");
}
interface GState {
  font: ProjectedFont | undefined;
}
const identity = [1, 0, 0, 1, 0, 0];
/** BR-419: Form `/Matrix`, six numbers passing the F-009 `cm` check. */
function formMatrix(file: PdfFile, stream: PdfStream) {
  const matrix = file.deref(stream.dict.get("Matrix"));
  if (matrix === undefined) return undefined;
  if (
    !Array.isArray(matrix) ||
    matrix.length !== 6 ||
    !matrix.every((n) => finiteNumber(n))
  )
    return fail("UNSUPPORTED_FORMAT");
  return matrix.every((n, i) => numeric(n) === identity[i])
    ? undefined
    : matrix;
}
/** BR-416/419: executes projected content, inlining Forms, with the running checks. */
export class Executor {
  private readonly programs = new Map<unknown, Map<Scope, Op[]>>();
  private readonly forms = new Set<PdfStream>();
  private executions = 0;
  private emitter: Emitter | undefined;
  constructor(
    private readonly file: PdfFile,
    private readonly fonts: FontRegistry,
    readonly production: Production,
  ) {}
  /**
   * Replays a projection built once per stream (list) and resource scope. A
   * projection with more operations than can still be emitted (each emits at
   * least one token) is not kept: it can only complete inside a Form that
   * emits nothing, and it is rebuilt at each execution, which pays its decoded
   * length again.
   */
  private *program(
    key: unknown,
    scope: Scope,
    bytes: () => Buffer,
  ): Generator<Op> {
    const known = this.programs.get(key)?.get(scope);
    if (known) {
      yield* known;
      return;
    }
    const limit = this.production.allowance() + 1;
    let ops: Op[] | undefined = [];
    for (const op of recordContent(bytes(), this.file, scope)) {
      if (ops) {
        ops.push(op);
        if (ops.length > limit) ops = undefined;
      }
      yield op;
    }
    if (ops) this.keep(key, scope, ops);
  }
  /** Keeps one projection (observable by tests). */
  keep(key: unknown, scope: Scope, ops: Op[]) {
    const byScope = this.programs.get(key) ?? new Map<Scope, Op[]>();
    byScope.set(scope, ops);
    this.programs.set(key, byScope);
  }
  async page(key: string, scope: Scope, bytes: () => Buffer) {
    const sink = new CanonicalContent();
    this.emitter = new Emitter(sink, this.production, this.fonts.nameOf);
    this.production.pages++;
    await this.execute(
      this.program(key, scope, bytes),
      scope,
      { font: undefined },
      [],
    );
    return sink;
  }
  private get out() {
    return this.emitter ?? fail("CONTENT_UNAVAILABLE");
  }
  private async execute(
    ops: Iterable<Op>,
    scope: Scope,
    start: GState,
    path: PdfStream[],
  ) {
    const stack: GState[] = [];
    let state = { ...start };
    for (const op of ops) {
      if (op.kind === "form") await this.form(op, scope, state, path);
      else if (op.kind === "font") {
        const font = this.fonts.select(op.font);
        state.font = font;
        const text = () =>
          `${serializeName(font.name)} ${operandText(op.size)} Tf`;
        this.out.emit({ text, op: "Tf", font });
      } else if (op.kind === "show") await this.show(op, state);
      else {
        if (op.op === "q") stack.push({ ...state });
        if (op.op === "Q") state = stack.pop() ?? state;
        this.out.emit({ text: opText(op.op, op.operands), op: op.op });
      }
    }
  }
  private async show(op: Extract<Op, { kind: "show" }>, state: GState) {
    const font = state.font;
    if (!font) return fail("CONTENT_UNAVAILABLE");
    let codes = 0,
      bytes = 0;
    for (const s of op.strings) {
      codes += await font.show(s);
      bytes += s.length;
    }
    this.out.show({
      text: opText(op.op, op.operands),
      op: op.op,
      shown: () => {
        this.production.shown(font, bytes, codes);
      },
    });
  }
  private async form(
    op: Extract<Op, { kind: "form" }>,
    caller: Scope,
    state: GState,
    path: PdfStream[],
  ) {
    if (path.includes(op.stream)) fail("CONTENT_UNAVAILABLE");
    if (path.length >= 8) fail("LIMIT_EXCEEDED");
    if (++this.executions > 4096) fail("LIMIT_EXCEEDED");
    this.forms.add(op.stream);
    if (this.forms.size > 256) fail("LIMIT_EXCEEDED");
    const matrix = formMatrix(this.file, op.stream);
    const used = this.file.wasDecoded(op.stream);
    const data = this.file.decoded(op.stream);
    if (used) this.file.budget.use(data.length);
    const own = this.file.deref(op.stream.dict.get("Resources"));
    if (own !== undefined && !(own instanceof Map)) fail("CONTENT_UNAVAILABLE");
    const scope = own ?? caller;
    this.out.push();
    this.out.emit({ text: "q", op: "q" });
    if (matrix) this.out.emit({ text: opText("cm", matrix), op: "cm" });
    await this.execute(
      this.program(op.stream, scope, () => data),
      scope,
      { ...state },
      [...path, op.stream],
    );
    this.out.emit({ text: "Q", op: "Q" });
    this.out.pop();
  }
}
