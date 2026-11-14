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
  text: string;
  op: string;
  font?: ProjectedFont;
  /** Counts a text-show once the tokens buffered before it are written. */
  shown?: () => void;
}
/** BR-419: buffers a Form's tokens until it shows text; text-free Forms emit nothing. */
class Emitter {
  private readonly frames: { items: Item[]; live: boolean }[] = [];
  private depth = 0;
  constructor(
    private readonly sink: CanonicalContent,
    private readonly production: Production,
  ) {}
  push() {
    this.frames.push({ items: [], live: false });
  }
  pop() {
    this.frames.pop();
  }
  emit(item: Item) {
    const top = this.frames.at(-1);
    if (top && !top.live) top.items.push(item);
    else this.write(item);
  }
  show(item: Item) {
    for (const frame of this.frames) {
      if (frame.live) continue;
      frame.live = true;
      for (const buffered of frame.items) this.write(buffered);
      frame.items = [];
    }
    this.write(item);
  }
  private write(item: Item) {
    if (item.op === "q" && ++this.depth > 32) fail("UNSUPPORTED_FORMAT");
    if (item.op === "Q") this.depth--;
    if (item.font) this.sink.fonts.add(item.font);
    item.shown?.();
    this.sink.emit(item.text);
    this.production.o++;
    this.production.canonical += Buffer.byteLength(item.text, "latin1") + 1;
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
  /** Replays a projection built once per stream (list) and resource scope. */
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
    const ops: Op[] = [];
    for (const op of recordContent(bytes(), this.file, scope)) {
      ops.push(op);
      yield op;
    }
    const byScope = this.programs.get(key) ?? new Map<Scope, Op[]>();
    byScope.set(scope, ops);
    this.programs.set(key, byScope);
  }
  async page(key: string, scope: Scope, bytes: () => Buffer) {
    const sink = new CanonicalContent();
    this.emitter = new Emitter(sink, this.production);
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
        state.font = this.fonts.select(op.font);
        const text = `${serializeName(state.font.name)} ${operandText(op.size)} Tf`;
        this.out.emit({ text, op: "Tf", font: state.font });
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
