/** F-031: the language of the proxy HTML pages. */
export type Language = "en" | "fr";

/** BR-406: a header longer than this many bytes is ignored. */
const MAX_ACCEPT_LANGUAGE_BYTES = 256;

/** BR-406: a language range, `*` or the ASCII grammar. */
const RANGE = /^(?:\*|[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*)$/u;
/** BR-406: `q=` / `Q=` with `0`, `0.` + up to three digits, `1`, `1.` + up to three zeros. */
const WEIGHT = /^[qQ]=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/u;

const isBlank = (character: string | undefined) =>
  character === " " || character === "\t";

/** BR-406: the value without leading and trailing spaces and tabs. */
function trimBlanks(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && isBlank(value[start])) start += 1;
  while (end > start && isBlank(value[end - 1])) end -= 1;
  return value.slice(start, end);
}

/** BR-405: `lang` present exactly once with the value `en` or `fr`. */
export function langParameter(query: URLSearchParams): Language | undefined {
  const values = query.getAll("lang");
  if (values.length !== 1) return undefined;
  const value = values[0];
  return value === "en" || value === "fr" ? value : undefined;
}

interface Item {
  range: string;
  weight: number;
}

function languageOf(range: string): Language | undefined {
  const primary = range.split("-")[0]?.toLowerCase();
  return primary === "en" || primary === "fr" ? primary : undefined;
}

/** BR-406: one item as range and weight, or undefined when it does not match. */
function parseItem(part: string): Item | undefined {
  const [range = "", weight, ...rest] = trimBlanks(part).split(";");
  const name = trimBlanks(range);
  if (rest.length > 0 || !RANGE.test(name)) return undefined;
  if (weight === undefined) return { range: name, weight: 1 };
  const value = WEIGHT.exec(trimBlanks(weight))?.[1];
  return value === undefined
    ? undefined
    : { range: name, weight: Number(value) };
}

/** BR-406: `*` stands for English, else French, unless refused with weight 0. */
function wildcardLanguage(items: readonly Item[]): Language | undefined {
  const refused = (language: Language) =>
    items.some(
      (item) => item.weight === 0 && languageOf(item.range) === language,
    );
  if (!refused("en")) return "en";
  if (!refused("fr")) return "fr";
  return undefined;
}

/** BR-406: the language an `Accept-Language` header asks for, if any. */
export function acceptLanguage(
  header: string | undefined,
): Language | undefined {
  if (
    header === undefined ||
    Buffer.byteLength(header, "utf8") > MAX_ACCEPT_LANGUAGE_BYTES
  )
    return undefined;
  const items = header
    .split(",")
    .map((part) => parseItem(part))
    .filter((item) => item !== undefined);
  const wildcard = wildcardLanguage(items);
  let best: { language: Language; weight: number } | undefined;
  for (const item of items) {
    const language = item.range === "*" ? wildcard : languageOf(item.range);
    if (language === undefined || item.weight === 0) continue;
    if (best === undefined || item.weight > best.weight)
      best = { language, weight: item.weight };
  }
  return best?.language;
}

/**
 * BR-404: the page language, from a valid `lang` query parameter, else the
 * `Accept-Language` header, else English.
 */
export function pageLanguage(
  query: URLSearchParams | undefined,
  header: string | undefined,
): Language {
  return (
    (query === undefined ? undefined : langParameter(query)) ??
    acceptLanguage(header) ??
    "en"
  );
}
