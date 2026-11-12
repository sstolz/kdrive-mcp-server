import type { ClientFacts, Fact } from "../../src/auth/verdict.ts";

export interface MatrixRow extends ClientFacts {
  checked: string;
  sources: string[];
  redirectWithIss: string;
  redirectWithoutIss: string;
  version: string;
  equalsReference: "yes" | "no" | "unverified";
  realTest: "not tested" | "passed" | "failed";
  notes: string;
}

export interface Matrix {
  reference: string;
  rows: MatrixRow[];
}

const HEADERS = [
  "Client",
  "Checked",
  "Sources",
  "Dynamic registration",
  "CIMD",
  "Manual client ID",
  "Rejects inconsistent issuer identification",
  "Redirect URI with RFC 9207 issuer identification",
  "Redirect URI otherwise",
  "MCP authorization version",
  "Equals reference",
  "Real test",
  "Notes",
];
const FACTS: readonly string[] = ["supported", "not supported", "unverified"];
const RESULTS: readonly string[] = ["not tested", "passed", "failed"];

export class MatrixError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MatrixError";
  }
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/gu, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function fact(value: string, row: string): Fact {
  if (!FACTS.includes(value)) throw new MatrixError(`Invalid fact in ${row}.`);
  return value as Fact;
}

/** BR-108: parses and validates `docs/mcp-client-compatibility.md`. */
// eslint-disable-next-line sonarjs/cognitive-complexity -- F-011: pre-existing complex function; splitting it is deferred to keep reviewed control flow unchanged in this ticket (BACKLOG.md)
export function parseMatrix(text: string): Matrix {
  const reference =
    /Reference MCP authorization specification version: `(\d{4}-\d{2}-\d{2})`/u.exec(
      text,
    )?.[1];
  if (!reference) throw new MatrixError("Reference version missing.");
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^\|\s*Client\s*\|/u.test(line));
  if (start < 0 || cells(lines[start] ?? "").join("|") !== HEADERS.join("|"))
    throw new MatrixError("Matrix table missing or malformed.");
  const rows: MatrixRow[] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    const [
      client = "",
      checked = "",
      sourceCell = "",
      dynamic = "",
      cimd = "",
      manual = "",
      rejects = "",
      withIss = "",
      withoutIss = "",
      version = "",
      equals = "",
      realTest = "",
      notes = "",
    ] = cells(line);
    if (cells(line).length !== HEADERS.length || !client)
      throw new MatrixError("Matrix row malformed.");
    // eslint-disable-next-line sonarjs/super-linear-regex -- F-011: applied only to short, locally bounded strings
    const sources = sourceCell.match(/[a-z]+:\/\/[^\s)<>\]]+/giu) ?? [];
    if (!isDate(checked) || !sources.length)
      throw new MatrixError(`Invalid date or source in ${client}.`);
    for (const source of sources)
      if (!source.startsWith("https://"))
        throw new MatrixError(`Non-https source in ${client}.`);
    if (!/^(\d{4}-\d{2}-\d{2}|unverified)$/u.test(version))
      throw new MatrixError(`Invalid version in ${client}.`);
    const expected =
      version === "unverified"
        ? "unverified"
        : // eslint-disable-next-line sonarjs/no-nested-conditional -- F-011: pre-existing nested conditional kept unchanged; refactor tracked in BACKLOG.md
          version === reference
          ? "yes"
          : "no";
    if (equals !== expected)
      throw new MatrixError(`Inconsistent reference comparison in ${client}.`);
    if (!RESULTS.includes(realTest) || !withIss || !withoutIss)
      throw new MatrixError(`Invalid row ${client}.`);
    rows.push({
      client,
      checked,
      sources,
      dynamicRegistration: fact(dynamic, client),
      cimd: fact(cimd, client),
      manualClientId: fact(manual, client),
      rejectsInconsistentIssuer: fact(rejects, client),
      redirectWithIss: withIss,
      redirectWithoutIss: withoutIss,
      version,
      equalsReference: expected,
      realTest: realTest as MatrixRow["realTest"],
      notes,
    });
  }
  if (!rows.length) throw new MatrixError("Matrix has no rows.");
  return { reference, rows };
}
