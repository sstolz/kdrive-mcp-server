import { extractionFail as fail } from "./extraction-values.js";
import { Budget, finiteNumber } from "./pdf-decode.js";
import { type Scope } from "./pdf-content.js";
import { Executor, Production, type CanonicalContent } from "./pdf-execute.js";
import { FontRegistry, type ProjectedFont } from "./pdf-fonts.js";
import { PdfFile, type Framed } from "./pdf-objects.js";
import {
  isName,
  isRef,
  numeric,
  serialize,
  type PdfValue,
} from "./pdf-syntax.js";
import { readXref, terminalFrame } from "./pdf-xref.js";
type Dict = Map<string, PdfValue>;
interface PageNode {
  kind: "page";
  index: number;
  mediaBox: PdfValue[];
  /** BR-415: the raw `/Resources` value, resolved only for a selected page. */
  resources: PdfValue | undefined;
  contents: PdfValue | undefined;
}
interface PagesNode {
  kind: "pages";
  kids: TreeNode[];
  count: number;
}
type TreeNode = PageNode | PagesNode;
type Visited =
  { kind: "page"; page: PageNode } | ({ kind: "pages" } & Omit<Frame, "node">);
interface Frame {
  id: number;
  here: Inherited;
  kids: PdfValue[];
  next: number;
  before: number;
  count: PdfValue | undefined;
  node: PagesNode;
}
interface Inherited {
  mediaBox: PdfValue | undefined;
  resources: PdfValue | undefined;
}
const header = /^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/u;
function framedDict(framed: Framed): Dict {
  if (framed.stream || !(framed.value instanceof Map))
    return fail("CONTENT_UNAVAILABLE");
  return framed.value;
}
function typeName(d: Dict, file: PdfFile) {
  const type = file.deref(d.get("Type"));
  return isName(type) ? type.name : undefined;
}
/** BR-415: each page's `MediaBox`, its own or the nearest inherited one. */
function mediaBox(file: PdfFile, value: PdfValue | undefined): PdfValue[] {
  const box = file.deref(value);
  if (box === undefined) return fail("CONTENT_UNAVAILABLE");
  if (
    !Array.isArray(box) ||
    box.length !== 4 ||
    !box.every((n) => finiteNumber(file.deref(n)))
  )
    return fail("UNSUPPORTED_FORMAT");
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = box.map(
    (n) => numeric(file.deref(n)) ?? 0,
  );
  if (x2 <= x1 || y2 <= y1) fail("UNSUPPORTED_FORMAT");
  return box.map((n) => file.deref(n) ?? 0);
}
/** BR-114 v2: the Catalog and the page tree, in tree order. */
class PageTree {
  readonly pages: PageNode[] = [];
  private readonly seen = new Set<number>();
  constructor(private readonly file: PdfFile) {}
  /** Walks the tree iteratively, so a deep chain of Pages nodes needs no call stack. */
  walk(rootRef: PdfValue | undefined): TreeNode {
    const root: PagesNode = { kind: "pages", kids: [], count: 0 };
    const top = this.visit(rootRef, undefined, {
      mediaBox: undefined,
      resources: undefined,
    });
    if (top.kind !== "pages") return fail("CONTENT_UNAVAILABLE");
    const stack: Frame[] = [{ ...top, node: root }];
    while (stack.length) {
      const frame = stack.at(-1);
      if (!frame) break;
      const kid = frame.kids[frame.next++];
      if (frame.next > frame.kids.length) {
        stack.pop();
        frame.node.count = this.pages.length - frame.before;
        if (frame.count !== frame.node.count) fail("CONTENT_UNAVAILABLE");
        continue;
      }
      const child = this.visit(kid, frame.id, frame.here);
      if (child.kind === "page") frame.node.kids.push(child.page);
      else {
        const node: PagesNode = { kind: "pages", kids: [], count: 0 };
        frame.node.kids.push(node);
        stack.push({ ...child, node });
      }
    }
    return root;
  }
  private visit(
    ref: PdfValue | undefined,
    parent: number | undefined,
    inherited: Inherited,
  ): Visited {
    if (!isRef(ref)) return fail("CONTENT_UNAVAILABLE");
    if (this.seen.has(ref.ref)) fail("CONTENT_UNAVAILABLE");
    this.seen.add(ref.ref);
    const d = framedDict(this.file.resolve(ref));
    const type = typeName(d, this.file);
    if (parent !== undefined) {
      const up = d.get("Parent");
      if (!isRef(up) || up.ref !== parent) fail("CONTENT_UNAVAILABLE");
    } else if (type !== "Pages") fail("CONTENT_UNAVAILABLE");
    const here: Inherited = {
      mediaBox: d.get("MediaBox") ?? inherited.mediaBox,
      resources: d.get("Resources") ?? inherited.resources,
    };
    let visited: Visited;
    if (type === "Page") visited = { kind: "page", page: this.page(d, here) };
    else visited = this.pagesNode(ref.ref, d, type, here);
    return visited;
  }
  private pagesNode(
    id: number,
    d: Dict,
    type: string | undefined,
    here: Inherited,
  ): Visited {
    if (type !== "Pages") fail("CONTENT_UNAVAILABLE");
    const kids = this.file.deref(d.get("Kids"));
    if (!Array.isArray(kids)) return fail("CONTENT_UNAVAILABLE");
    return {
      kind: "pages",
      id,
      here,
      kids,
      next: 0,
      before: this.pages.length,
      count: this.file.deref(d.get("Count")),
    };
  }
  private page(d: Dict, here: Inherited): PageNode {
    if (this.pages.length >= 256) fail("LIMIT_EXCEEDED");
    const box = mediaBox(this.file, here.mediaBox);
    const node: PageNode = {
      kind: "page",
      index: this.pages.length + 1,
      mediaBox: box,
      resources: here.resources,
      contents: d.get("Contents"),
    };
    this.pages.push(node);
    return node;
  }
}
/** BR-415: a selected page's resource scope, resolved when that page is processed. */
function pageScope(file: PdfFile, value: PdfValue | undefined): Scope {
  const resources = file.deref(value);
  if (resources !== undefined && !(resources instanceof Map))
    fail("CONTENT_UNAVAILABLE");
  return resources;
}
/** BR-416: `Contents` references, each use counting its decoded length against B. */
function contentStreams(file: PdfFile, contents: PdfValue | undefined) {
  if (contents === undefined) return [];
  let refs: PdfValue[] = [contents];
  if (isRef(contents)) {
    const framed = file.resolve(contents);
    if (!framed.stream) {
      if (!Array.isArray(framed.value)) return fail("CONTENT_UNAVAILABLE");
      refs = framed.value;
    }
  } else if (Array.isArray(contents)) refs = contents;
  else return fail("CONTENT_UNAVAILABLE");
  if (refs.length > 1024) fail("LIMIT_EXCEEDED");
  return refs.map((ref) => {
    if (!isRef(ref)) return fail("CONTENT_UNAVAILABLE");
    const stream = file.resolve(ref).stream;
    if (!stream) return fail("CONTENT_UNAVAILABLE");
    const used = file.wasDecoded(stream);
    const data = file.decoded(stream);
    if (used) file.budget.use(data.length);
    return { id: ref.ref, data };
  });
}
/** BR-415: the canonical document, numbered by the projection with generation 0. */
class Writer {
  private readonly chunks: Buffer[] = [];
  private readonly offsets: number[] = [];
  private total: number;
  private next = 1;
  constructor(private readonly budget: number) {
    this.chunks.push(Buffer.from("%PDF-1.7\n"));
    this.total = 9;
  }
  reserve() {
    return this.next++;
  }
  put(id: number, body: string, stream?: Buffer) {
    const text = stream
      ? `${String(id)} 0 obj\n<< /Length ${String(stream.length)} >>\nstream\n`
      : `${String(id)} 0 obj\n${body}\nendobj\n`;
    this.offsets[id] = this.total;
    this.append(Buffer.from(text, "latin1"));
    if (stream) {
      this.append(stream);
      this.append(Buffer.from("\nendstream\nendobj\n"));
    }
    return id;
  }
  readonly add = (body: string, stream?: Buffer) =>
    this.put(this.reserve(), body, stream);
  private append(chunk: Buffer) {
    this.chunks.push(chunk);
    this.total += chunk.length;
    if (this.total > this.budget) fail("LIMIT_EXCEEDED");
  }
  finish() {
    const start = this.total;
    let xref = `xref\n0 ${String(this.next)}\n0000000000 65535 f \n`;
    for (let id = 1; id < this.next; id++)
      xref += `${String(this.offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
    xref += `trailer\n<< /Size ${String(this.next)} /Root 1 0 R >>\nstartxref\n${String(start)}\n%%EOF\n`;
    this.append(Buffer.from(xref, "latin1"));
    return Buffer.concat(this.chunks);
  }
}
interface Projected {
  content: CanonicalContent;
}
function writeDocument(
  root: TreeNode,
  projected: Map<number, Projected>,
  fonts: readonly ProjectedFont[],
  budget: number,
) {
  const w = new Writer(budget),
    catalog = w.reserve(),
    empty = w.reserve();
  const fontRefs = new Map<ProjectedFont, number>();
  const pageResources = (content: CanonicalContent) => {
    const entries = fonts
      .filter((f) => content.fonts.has(f))
      .map((f) => `/${f.name} ${String(fontRefs.get(f) ?? 0)} 0 R`);
    return `<< /Font << ${entries.join(" ")} >> >>`;
  };
  const writeNode = (
    node: TreeNode,
    id: number,
    parent: number | undefined,
  ) => {
    const up = parent === undefined ? "" : ` /Parent ${String(parent)} 0 R`;
    if (node.kind === "pages") {
      const ids = node.kids.map(() => w.reserve());
      w.put(
        id,
        `<< /Type /Pages /Kids [${ids.map((k) => String(k) + " 0 R").join(" ")}] /Count ${String(node.count)}${up} >>`,
      );
      return node.kids.map((kid, i): [TreeNode, number, number] => [
        kid,
        ids[i] ?? 0,
        id,
      ]);
    }
    const page = projected.get(node.index);
    const contents = page ? w.add("<< >>", page.content.bytes()) : empty;
    const resources = page ? pageResources(page.content) : "<< >>";
    w.put(
      id,
      `<< /Type /Page${up} /MediaBox ${serialize(node.mediaBox)} /Resources ${resources} /Contents ${String(contents)} 0 R >>`,
    );
    return [];
  };
  for (const font of fonts) fontRefs.set(font, font.write(w.add));
  w.put(empty, "<< >>", Buffer.alloc(0));
  const pages = w.reserve();
  w.put(catalog, `<< /Type /Catalog /Pages ${String(pages)} 0 R >>`);
  const pending: [TreeNode, number, number | undefined][] = [
    [root, pages, undefined],
  ];
  for (let item = pending.pop(); item; item = pending.pop())
    pending.push(...writeNode(...item).reverse());
  return w.finish();
}
/** BR-114 v2: the trailer, `/Encrypt` included, then the Catalog. */
function catalogPages(file: PdfFile, trailers: Dict[]) {
  if (trailers.some((t) => t.has("Encrypt"))) fail("UNSUPPORTED_FORMAT");
  const root = trailers[0]?.get("Root");
  if (!isRef(root)) fail("CONTENT_UNAVAILABLE");
  const catalog = framedDict(file.resolve(root));
  if (typeName(catalog, file) !== "Catalog") fail("CONTENT_UNAVAILABLE");
  return catalog.get("Pages");
}
/** BR-114 v2: PDF.js only ever receives the canonical projection of BR-415. */
export async function preflightPdf(
  input: Uint8Array,
  budget: number,
  selected: number[],
) {
  const source = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (!header.test(source.subarray(0, 10).toString("latin1")))
    fail("UNSUPPORTED_FORMAT");
  const start = terminalFrame(source),
    decoded = new Budget(budget),
    { table, trailers } = readXref(source, start, decoded),
    file = new PdfFile(source, table, decoded);
  const tree = new PageTree(file),
    root = tree.walk(catalogPages(file, trailers));
  if (tree.pages.length < 1) fail("UNSUPPORTED_FORMAT");
  if (selected.some((n) => n > tree.pages.length)) fail("INVALID_RANGE");
  const fonts = new FontRegistry(file),
    executor = new Executor(file, fonts, new Production(budget)),
    projected = new Map<number, Projected>();
  for (const index of [...new Set(selected)].sort((a, b) => a - b)) {
    const page = tree.pages[index - 1];
    if (!page) return fail("INVALID_RANGE");
    const scope = pageScope(file, page.resources);
    const streams = contentStreams(file, page.contents);
    const key = streams.map((s) => String(s.id)).join(",");
    const content = await executor.page(key, scope, () =>
      Buffer.concat(
        streams.flatMap((s, i) => (i ? [Buffer.from("\n"), s.data] : [s.data])),
      ),
    );
    projected.set(index, { content });
  }
  const admission = executor.production.final();
  return {
    bytes: writeDocument(root, projected, fonts.fonts, budget),
    total_pages: tree.pages.length,
    ...admission,
  };
}
