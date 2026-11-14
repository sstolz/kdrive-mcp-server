---
id: F-034
title: PDF text extraction for common generator output
ticket: "#4"
status: ready-for-freeze
version: 1
---

# F-034 — PDF text extraction for common generator output

Author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-14.
Base: branch `work/4-pdf` (main `3151786`).
IDs: F-034; BR-114 v2; BR-412–BR-418 v1; AC-01–AC-10; ADR-012 (proposed,
supersedes the PDF admission profile of ADR-004 and nothing else).
Next free IDs checked on main (`docs/spec-index.md`, `business-rules/`,
`architecture-decisions/`): F-034, BR-412, ADR-012.

## Context

`kdrive_read` with `format:"pdf"` (F-009 v1, BR-114 v1, ADR-004) admits a
closed profile: one classic cross-reference section, a trailer with exactly
`Size` and `Root`, a Catalog with exactly `Type` and `Pages`, pages with
exactly `Type`, `Parent`, `MediaBox`, `Resources` and `Contents`, one font
named `/F1` that is the nonembedded Type 1 Helvetica in WinAnsiEncoding, and a
fixed list of text and `q`/`Q`/`cm`/`Do` operators. Anything else refuses
before PDF.js. On 2026-11-13 the owner reported that a common tool-generated
PDF from the owner's drive was refused by `0.6.0-beta.1` even for one page
(the file is not recorded). Affected: every `kdrive_read` user who asks for
PDF text; today they must fall back to `kdrive_download` and read the bytes
elsewhere.

### Measurement (2026-11-14)

Method: a scratch generator wrote twenty synthetic PDFs, each the profile's
own one-page shape plus one feature that common generators emit (S20 combines
the features of a typical modern producer). Each file was first opened with
raw PDF.js 6.5.438 (every file gave the text `Hello modern PDF`, so all are
valid PDFs), then passed to the current `extractPdf` built from main
`3151786` in the dev container; the refusing check was read from the
source-mapped stack. No network, account or private file was used.

| Sample | Feature added to the profile shape | Result | Refusing check |
| --- | --- | --- | --- |
| S01 | none (profile shape) | text | — |
| S02 | FlateDecode content stream | text | — |
| S03 | trailer `/Info` and `/ID` | `UNSUPPORTED_FORMAT` | trailer keys (`Size`, `Root` only) |
| S04 | Flate with PNG predictor `/DecodeParms` | `UNSUPPORTED_FORMAT` | `/DecodeParms` refused |
| S05 | cross-reference stream (PDF 1.5) | `CONTENT_UNAVAILABLE` | `startxref` must point at a `xref` keyword |
| S06 | S05 plus an object stream | `CONTENT_UNAVAILABLE` | same as S05 |
| S07 | one incremental update (`/Prev`) | `UNSUPPORTED_FORMAT` | trailer keys |
| S08 | indirect `/Length` | `UNSUPPORTED_FORMAT` | direct integer `/Length` only |
| S09 | font resource named `/F2` | `UNSUPPORTED_FORMAT` | Font resource keys (`F1` only) |
| S10 | nonembedded TrueType, `Widths`, `FontDescriptor` | `UNSUPPORTED_FORMAT` | font dictionary keys and subtype |
| S11 | Type0 Identity-H font with `ToUnicode` | `UNSUPPORTED_FORMAT` | font dictionary keys and subtype |
| S12 | `rg`, `re`, `f`, `gs` with an ExtGState | `UNSUPPORTED_FORMAT` | Resources keys (`Font`, `XObject` only) |
| S13 | marked content `BDC`/`EMC` | `UNSUPPORTED_FORMAT` | content operator list |
| S14 | Resources `/ProcSet` | `UNSUPPORTED_FORMAT` | Resources keys |
| S15 | page `/Group`, `/Tabs`, `/StructParents` | `UNSUPPORTED_FORMAT` | Page keys |
| S16 | Catalog `/Metadata`, `/Lang`, `/ViewerPreferences` | `UNSUPPORTED_FORMAT` | Catalog keys |
| S17 | `Resources`/`MediaBox` inherited from Pages | `UNSUPPORTED_FORMAT` | Pages node keys |
| S18 | `Contents` array of three streams | `UNSUPPORTED_FORMAT` | `Contents` must be one stream reference |
| S19 | `0 g` inside `BT`/`ET` | `UNSUPPORTED_FORMAT` | content operator list |
| S20 | S03, S05, S06, S11–S16, `/F2`, Flate | `CONTENT_UNAVAILABLE` | same as S05 |

18 of 20 samples are refused, and each of the 18 features refuses on its own.
Removing S20's features one at a time, in the order the checks fire, meets
eight distinct refusals before the file passes: cross-reference stream,
trailer keys, Catalog keys, Page keys, Resources keys (`ProcSet`,
`ExtGState`), the font resource name, the font dictionary (Type0), then the
content operators (`BDC`). Three findings follow:

1. The container (cross-reference streams, object streams, incremental
   updates, predictors) is only the first gate. Widening it alone admits none
   of the modern combination: the closed key lists, the single-font rule and
   the closed operator list refuse it next.
2. A cross-reference stream refuses as `CONTENT_UNAVAILABLE`, which reads as
   a broken file, while F-009 reserves that code for corrupt admitted
   formats.
3. A probe gave PDF.js, with the production options of `extractPdf`
   (`stopAtErrors`, external factories refused), a nonembedded TrueType font
   with `Widths`, and a Type0 Identity-H font with `ToUnicode` but no font
   program: both extracted the text. Text extraction therefore does not need
   the font programs, which are the largest and riskiest parser input.

## Scope

- **Container.** Cross-reference streams, hybrid files (`/XRefStm`),
  incremental updates and linearized files through a bounded `/Prev` chain;
  object streams; indirect `/Length`; `%PDF-2.0` headers (BR-412, BR-413).
- **Decoding.** Only the streams the projection needs are decoded: page and
  Form content, `ToUnicode` CMaps, object streams and cross-reference
  streams. Admitted filters: none, or FlateDecode (alone or as a one-element
  array) with PNG predictors 10–15 (BR-414).
- **Projection.** PDF.js receives a canonical document built only from what
  text extraction needs: the page tree with each page's resolved `MediaBox`,
  and, for the selected pages only, the fonts their content selects and a
  re-serialized content stream that keeps the text operators and drops the
  rest. Metadata, annotations, actions, JavaScript, outlines, structure,
  forms, images, embedded files and font programs are never emitted
  (BR-415, BR-416).
- **Fonts.** Type 1, MMType1 and TrueType simple fonts with a standard
  encoding, an encoding dictionary or a `ToUnicode` CMap; Type0 fonts with
  Identity-H or Identity-V and a `ToUnicode` CMap (BR-417).
- **Producer bound.** The F-009 static text-production bound extended to
  mapped fonts (BR-418).
- **Errors.** Well-formed files outside the profile refuse as
  `UNSUPPORTED_FORMAT`; files inconsistent with their own structure refuse as
  `CONTENT_UNAVAILABLE` (BR-114 v2).
- **Docs.** README "Limits" bullet and the `docs/development.md` PDF section:
  what is extracted, what refuses and why, and `kdrive_download` as the
  fallback for a refused file; ADR-012.
- **Tests.** A synthetic corpus helper (`tests/helpers/pdf-corpus.ts`)
  that rebuilds S01–S20 and the hostile samples of the ACs, plus named BR
  tests.

### Out of scope

- Encryption of any kind, including an empty user password (refuses as
  `UNSUPPORTED_FORMAT`).
- Text inside Form XObjects (a selected page that shows text through a Form
  refuses; Forms without text are dropped), Type3 fonts, predefined or
  embedded CMaps other than Identity-H/V, inline images, `LZWDecode`,
  `ASCIIHexDecode`, `ASCII85Decode`, `RunLengthDecode` and TIFF predictor 2
  on a stream the projection needs (D-4, D-6).
- Text from annotations, form fields, attachments or optional-content
  metadata; OCR; reading order or layout beyond PDF.js item order (BR-115
  unchanged).
- Repair: a wrong cross-reference offset, data after the last `%%EOF` or a
  header not at byte 0 still refuses; PDF.js repair stays disabled.
- Any change to the existing ceilings: source bytes (8 MiB), decoded and
  canonical bytes (B), selected pages (10), pages (256), items (65,536),
  deadline, worker isolation and limits, serialized output and continuation
  (F-009, BR-110, BR-113, BR-117, BR-118).
- New dependencies or dependency versions (ADR-004 stance kept, D-7); new
  error codes or error texts; tool schema and descriptions (BR-060).
- Image extraction (`format:"image"`, ADR-010).

## Business rules

- **BR-114 v2** — v1 holds with the profile of F-034: PDF extraction accepts
  only input that passes BR-412–BR-418, never starts PDF.js on unsupported,
  malformed or over-budget input, and PDF.js only ever receives the canonical
  projection of BR-415, never source bytes. The header is `%PDF-1.0` to
  `%PDF-1.7` or `%PDF-2.0` at byte 0 followed by an end of line. A refusal
  uses `LIMIT_EXCEEDED` when a declared or computed ceiling of F-009 or
  F-034 is passed; otherwise `UNSUPPORTED_FORMAT` when the file is
  well-formed but uses a feature outside the profile (encryption, an
  unadmitted filter, font or operator, text in a Form); otherwise
  `CONTENT_UNAVAILABLE` when the file contradicts its own structure (an
  offset that does not hold the object it names, a cycle, a length that
  overruns its data, a missing required object). Verified by: AC-01,
  AC-09, AC-10.
- **BR-412** — Cross-reference data is read only from the last `startxref`
  offset and the chain it starts, with no scan for objects and no repair.
  Each section is either a classic `xref` table with a trailer, or a stream
  object whose dictionary has `/Type /XRef`, a direct `/Size`, a `/W` of
  three integers each 0–8 and an optional `/Index` of start/count pairs.
  A classic trailer's `/XRefStm` and every section's `/Prev` are followed;
  at most 32 sections are read and a section offset seen twice is a cycle.
  For each object number the newest section that lists it wins (a section's
  `/XRefStm` entries rank below its own table, above its `/Prev`). The
  newest trailer gives `/Root`; `/Size` of every section is at most 65,536
  and every listed object number is below its section's `/Size`. A
  decoded cross-reference stream holds exactly the listed entry count times
  the sum of `/W` bytes; a type 0 entry is free, type 1 gives a byte offset
  and generation, type 2 gives an object stream number and index, and any
  other type is free. Verified by: AC-02.
- **BR-413** — An object is resolved only through the merged cross-reference
  table. A type 1 object is parsed at its offset as
  `<number> <generation> obj`, one value, an optional stream framed by its
  `/Length`, and `endobj`; its number and generation equal the entry's. A
  type 2 object is read from the object stream named by the entry, which
  is itself a type 1 object with `/Type /ObjStm`, a direct `/N` and
  `/First`; its header pair at the entry's index names the same object
  number, the object is the one value between its offset and the next, has
  generation 0 and is not a stream; `/Extends` is ignored. An indirect
  `/Length` resolves to a nonnegative integer object; resolving it never
  requires framing the stream it measures and opens at most one object
  stream, whose own `/Length` is direct or a type 1 integer object. A
  reference to a free, absent or mismatched object in a role the projection
  needs refuses. At most 4,096 objects are resolved per invocation (the
  F-009 indirect-object ceiling). Verified by: AC-03.
- **BR-414** — Only the streams BR-412, BR-413, BR-416 and BR-417 need are
  decoded; any other stream is framed by its `/Length` and never decoded,
  whatever its filter. A needed stream has no filter, or `/FlateDecode`
  given as a name or a one-element array, with optional `/DecodeParms` (a
  dictionary, or a one-element array holding one) whose `/Predictor` is 1 or
  10–15, `/Colors` 1–4, `/BitsPerComponent` 8 and `/Columns` 1–65,536; PNG
  rows are undone with each row's own tag and the predicted data is a
  whole number of rows. Each needed stream is decoded once per invocation
  and its decoded length counts once against B with the F-009 inflate
  rules (`maxOutputLength` set to the remaining B, `rejectGarbageAfterEnd`).
  Verified by: AC-04.
- **BR-415** — The canonical document holds exactly: a Catalog with `Type`
  and `Pages`; every Pages node with `Type`, `Kids`, `Count` and `Parent`
  except at the root; every page with `Type`, `Parent`, its `MediaBox`
  (its own, or the nearest inherited one) and `Resources` and `Contents`;
  a trailer with `Size` and `Root`. A selected page's `Resources` holds only
  `Font`, with the fonts BR-417 admits under their source names, and its
  `Contents` is the one stream BR-416 builds, with no filter. A page that is
  not selected gets empty `Resources` and an empty content stream, and its
  content and resources are not read. Every other key, object and stream of
  the source is left out. The page tree keeps its source order and count,
  so `total_pages` is unchanged. Verified by: AC-05.
- **BR-416** — A selected page's content is its `Contents` stream, or the
  streams of a `Contents` array of at most 1,024 references joined with one
  line feed, tokenized once in order. Kept, with the F-009 operand checks:
  `q`, `Q`, `cm`, `BT`, `ET`, `Tf`, `Tc`, `Tw`, `Tz`, `TL`, `Ts`, `Tr`
  (integer 0–7), `Td`, `TD`, `Tm`, `T*`, `Tj`, `TJ`, `'` and `"`, with
  F-009's state rules except that string bytes are not restricted to
  0x20–0xFF and `Tf` takes any font name and a finite size. Dropped,
  operands included: path construction and painting, clipping, colour and
  colour space, line and rendering state, `sh`, marked content (`BMC`,
  `BDC`, `EMC`, `MP`, `DP`), `BX`/`EX`, `gs` (refused when the named
  ExtGState holds `/Font`), and `Do` of an Image XObject or of a Form
  XObject whose content, checked with these same rules through nested Forms
  (at most 8 deep, at most 256 distinct Forms, each decoded once, a Form
  reached again on its own path is a cycle), shows no text. Refused as
  `UNSUPPORTED_FORMAT`: `Do` of a Form that shows text, inline images
  (`BI`), `d0`, `d1` and any other operator. A `Q` with no open `q` is
  dropped, and `Q`s are appended for the `q`s left open at the end. The
  kept tokens are re-serialized; that stream counts against the canonical
  bound. Verified by: AC-06.
- **BR-417** — Only fonts selected by a kept `Tf` are read, at most 128
  distinct fonts per invocation; a `Tf` naming no font of the page's Font
  resource refuses. Admitted: (a) `Type1`, `MMType1` or `TrueType` with a
  `ToUnicode` CMap, or an `/Encoding` of `WinAnsiEncoding`, `MacRomanEncoding`
  or `StandardEncoding`, or an encoding dictionary with optional `/Type
  /Encoding`, one of those as optional `/BaseEncoding` and optional
  `/Differences` of at most 256 codes with glyph names of at most 31 bytes, or
  no `/Encoding` when `/BaseFont` is one of the 14 standard fonts; (b) `Type0`
  with `/Encoding` `Identity-H` or `Identity-V`, one `CIDFontType0` or
  `CIDFontType2` descendant, and a `ToUnicode` CMap. The projected font keeps
  `Type`, `Subtype`, `BaseFont`, `FirstChar`, `LastChar`, `Widths` (at most
  256 numbers), `Encoding`, `ToUnicode` and, for Type0, one descendant with
  `Type`, `Subtype`, `BaseFont`, `CIDSystemInfo`, `DW` and `W`; a
  `FontDescriptor` keeps `Type`, `FontName`, `Flags`, `FontBBox`,
  `ItalicAngle`, `Ascent`, `Descent`, `CapHeight`, `StemV` and `MissingWidth`.
  `FontFile`, `FontFile2`, `FontFile3` and a stream `CIDToGIDMap` are never
  decoded or emitted. A `ToUnicode` CMap is parsed with the bounded tokenizer:
  only code space ranges, `bfchar` and `bfrange` entries (the array form
  included) count, codes are 1 or 2 bytes, destinations are UTF-16BE of at
  most 64 bytes, `usecmap` refuses, a CMap has at most 65,536 entries and all
  admitted CMaps together cover at most 262,144 codes; it is re-emitted as a
  canonical CMap built from the admitted entries. Every other font refuses as
  `UNSUPPORTED_FORMAT`. Verified by: AC-07.
- **BR-418** — The F-009 text-production admission holds with weighted
  string bytes: for each selected page, N is the sum over text-show strings
  of the string's bytes times `m` of its font, where `m = max(1,
  ceil(D / 3))` and D is the largest UTF-8 byte length PDF.js can give one
  code of that font (from the canonical CMap for a `ToUnicode` font; for
  other fonts the maximum established by exact-pin source checks, 3 unless
  those checks show more). `U = 8 * (N + O + 1)`, `I = 2 * (S + O + 1)` with
  S the unweighted string bytes, the sum of U plus 3 per separator is at
  most B, the sum of I at most 65,536, and a string over 4,096 bytes refuses,
  all before PDF.js starts. Verified by: AC-08.

## Contract details

### Ceilings added by F-034

All are per invocation, cumulative under BR-117 (equality permitted), and
refuse as `LIMIT_EXCEEDED`. F-009 ceilings are unchanged.

| Work | Ceiling |
| --- | --- |
| Cross-reference sections read (`/Prev`, `/XRefStm`) | 32 |
| `/Size` of a section; listed object numbers | 65,536; below `/Size` |
| `/W` field width | 0–8 bytes each |
| Objects resolved | 4,096 (F-009 ceiling, now counted on resolution) |
| Object streams opened to resolve one indirect `/Length` | 1 |
| PNG predictor `/Columns` × `/Colors` | 65,536 × 4 |
| `Contents` array references | 1,024 |
| Form XObjects checked; Form nesting | 256; 8 |
| Distinct fonts read | 128 |
| `Widths`, `Differences` codes; glyph name | 256, 256; 31 bytes |
| `ToUnicode` entries per CMap; codes covered in all CMaps | 65,536; 262,144 |
| `ToUnicode` destination | 64 bytes UTF-16BE |

Decoded bytes of cross-reference streams, object streams, content streams,
Form streams and `ToUnicode` streams all count against B once each; the
canonical document, with its re-serialized content and CMaps, stays at most
B. Streams that are never decoded add nothing.

### Hostile input

- Decompression bombs: every inflate runs under the remaining B (F-009);
  object and cross-reference streams share that budget; nothing is decoded
  speculatively.
- Cross-reference loops and floods: a repeated section offset is a cycle;
  32 sections and `/Size` 65,536 bound the table.
- Object-stream recursion: an object stream is reached only through a
  type 1 entry and never holds a stream, so it cannot contain another; the
  `/Length` rule of BR-413 stops length chains.
- Huge `/Length`: a stream that overruns the file refuses; the F-009
  8 MiB stream ceiling stays.
- Predictor abuse: the row width is bounded, the data is a whole number of
  rows, and undoing a predictor never grows the data.
- Font and CMap abuse: font programs are never parsed; CMaps are bounded
  and re-emitted canonically, so PDF.js never parses a source CMap.
- Repeated execution: Forms that show text refuse and the others are
  dropped, so PDF.js executes each kept operator once.

## Acceptance criteria

All ACs run against the actual pinned PDF.js through `extractPdf` (or the
worker) with a spy on the PDF.js start, using synthetic files built by
`tests/helpers/pdf-corpus.ts`.

- **AC-01** (BR-114 v2, BR-412–BR-418) — Given S01–S20 of the measurement,
  When page 1 is read, Then each returns `Hello modern PDF` with
  `total_pages` 1, and the bytes PDF.js receives contain no `/Filter`,
  `/XRef`, `/ObjStm`, `/FontFile`, `/Metadata`, `/Info` or `/ExtGState`.
  Verified by: `TestBR114_v2 AC-01 synthetic producer corpus extracts`.
- **AC-02** (BR-412) — Given (a) a file whose second revision replaces page
  1's content, (b) a hybrid file whose `/XRefStm` lists the content object,
  (c) a linearized-style file whose last `startxref` points at a first-page
  section with `/Prev` to the main section, (d) a `/Prev` chain A→B→A,
  (e) 32 and 33 sections, (f) `/Size` 65,536 and 65,537, (g) `/W [1 9 2]`,
  (h) a cross-reference stream one byte short of its entry count, When page
  1 is read, Then (a) gives the second revision's text, (b) and (c) give
  the text, (d) is `CONTENT_UNAVAILABLE`, (e) gives the text at 32 and
  `LIMIT_EXCEEDED` at 33, (f) text then `LIMIT_EXCEEDED`, (g)
  `LIMIT_EXCEEDED`, (h) `CONTENT_UNAVAILABLE`, each refusal before PDF.js.
  Verified by: `TestBR412_xref_chain`.
- **AC-03** (BR-413) — Given (a) all non-stream objects in one object
  stream, (b) a type 2 entry naming an object stream that is itself a
  type 2 object, (c) a header pair naming another object number, (d) a
  stream object inside an object stream, (e) indirect `/Length` objects,
  one of them inside an object stream, (f) an object stream whose `/Length`
  lives inside itself, (g) a generation mismatch on the page object, (h) a
  page tree that needs 4,096 and 4,097 resolved objects, When page 1 is
  read, Then (a) and (e) give the text, (b), (c), (d), (f) and (g) are
  `CONTENT_UNAVAILABLE`, and (h) gives the text then `LIMIT_EXCEEDED`, each
  refusal before PDF.js. Verified by: `TestBR413_object_resolution`.
- **AC-04** (BR-414, BR-117) — Given budget B and (a) Flate content with
  predictor 12 decoding to exactly B and to B + 1 bytes, (b) an object
  stream and (c) a cross-reference stream that each inflate one byte over
  the remaining B, (d) `/Columns` 65,537, (e) predictor 2, (f) predicted data
  that is not a whole number of rows, (g) `LZWDecode` content, (h) a page
  that also draws a `DCTDecode` image whose data is not a JPEG, (i) a
  `/Length` past the end of the file, When page 1 is read, Then (a) gives
  the text at B and `LIMIT_EXCEEDED` at B + 1, (b), (c) and (d) are
  `LIMIT_EXCEEDED`, (e) and (g) are `UNSUPPORTED_FORMAT`, (f) and (i) are
  `CONTENT_UNAVAILABLE`, and (h) gives the text with the image never
  decoded. Verified by: `TestBR414_stream_decoding`.
- **AC-05** (BR-415) — Given a three-page file with `/OpenAction`
  JavaScript, a link annotation with a URI action, `/AcroForm`,
  `/Names /EmbeddedFiles`, `/Outlines`, `/StructTreeRoot`, `/Metadata`, a
  `MediaBox` and `Resources` inherited from the root Pages node, and a
  Type3 font with an inline image on page 3, When pages `[1, 2]` are read,
  Then the text of both pages returns with `total_pages` 3, the canonical
  bytes contain none of those keys nor `/S /JavaScript`, page 3 has empty
  `Resources` and content there, and reading page `[3]` is
  `UNSUPPORTED_FORMAT`. Verified by: `TestBR415_projection`.
- **AC-06** (BR-416) — Given pages with (a) every dropped operator family
  between text objects, (b) a text-free Form (nested 8 deep) drawn with
  `Do`, (c) a Form that shows text, (d) Forms nested 9 deep, (e) a Form
  cycle, (f) `gs` naming an ExtGState with `/Font`, (g) an inline image,
  (h) an unknown operator, (i) a stray `Q` and two unclosed `q`, (j) a
  `Contents` array splitting `BT ... ET` across two streams, (k) one
  content stream shared by pages 1 and 2, When the page(s) are read, Then
  (a), (b), (i), (j) and (k) give the text (k for pages `[1, 2]`) and the
  canonical content holds only kept operators, (c), (f), (g) and (h) are
  `UNSUPPORTED_FORMAT`, (d) is `LIMIT_EXCEEDED` and (e) is
  `CONTENT_UNAVAILABLE`. Verified by: `TestBR416_content_projection`.
- **AC-07** (BR-417) — Given (a) a Type1 font with `/Differences` mapping
  codes below 0x20, (b) a TrueType font in WinAnsiEncoding whose
  `FontFile2` holds random bytes, (c) a Type0 Identity-H font whose
  `ToUnicode` maps one code to `ffi`, (d) a Type0 font without `ToUnicode`,
  (e) a Type0 font with `/Encoding /UniJIS-UCS2-H`, (f) a Type3 font
  selected by `Tf`, (g) a CMap with `usecmap`, (h) a CMap of 65,537 entries,
  (i) a destination of 66 bytes, (j) 129 distinct fonts, (k) a symbolic
  TrueType font with no `/Encoding` and no `ToUnicode`, When page 1 is read,
  Then (a), (b) and (c) give their text and the canonical bytes hold no
  font program and no source CMap, (d), (e), (f), (g) and (k) are
  `UNSUPPORTED_FORMAT`, and (h), (i) and (j) are `LIMIT_EXCEEDED`.
  Verified by: `TestBR417_fonts`.
- **AC-08** (BR-418) — Given a `ToUnicode` font whose largest destination
  is 48 UTF-8 bytes (`m` 16) and a page repeating one string so that the
  sum of U is exactly B and B + 1, When the page is read, Then the first
  gives its text and the second is `LIMIT_EXCEEDED` before PDF.js; and the
  exact-pin dependency stress of `TestBR114_pdf_producer_admission` passes
  for Type0/`ToUnicode` and Differences fonts with produced bytes and items
  never above the admitted U and I. Verified by:
  `TestBR418_producer_admission`, `TestBR114_pdf_producer_admission`.
- **AC-09** (BR-114 v2) — Given (a) a well-formed file with `/Encrypt`,
  (b) a `%PDF-2.0` file, (c) `%PDF-2.1`, (d) a cross-reference offset one
  byte off, (e) bytes after the last `%%EOF`, When page 1 is read, Then (a)
  and (c) are `UNSUPPORTED_FORMAT`, (b) gives the text, (d) and (e) are
  `CONTENT_UNAVAILABLE`, each refusal before PDF.js. Verified by:
  `TestBR114_v2 AC-09 error classification`.
- **AC-10** (BR-114 v2, BR-115, BR-117, BR-118, BR-122) — Given the
  existing extraction suites (`tests/read-*.test.ts`), When `make check`
  runs, Then every test passes; a test that asserted a refusal of a feature
  F-034 admits (object or cross-reference streams, content arrays and reuse,
  extra keys, other fonts or operators) is rewritten to assert the BR-114 v2
  outcome and names BR-114 v2, and no test is removed. Verified by:
  `make check`.

## Decisions

- **D-1 — Projection instead of a wider whitelist.** The canonical document
  keeps only what text extraction reads and drops everything else, rather
  than admitting more keys into the closed lists. Every common generator
  adds keys the profile does not know (S03, S14–S16), and the list of such
  keys is open-ended; dropping them is both wider and safer, since actions,
  JavaScript, annotations and attachments never reach PDF.js. Rejected:
  extending the closed key lists (each new generator brings new keys, the
  measurement shows eight gates); passing the source to PDF.js with only
  container checks (loses the static bounds ADR-004 relies on).
- **D-2 — Container widening (BR-412, BR-413).** Cross-reference and object
  streams are the default of PDF 1.5+ generators (S05, S06, S20);
  incremental updates come from any "save" after annotation or signing
  (S07); linearized files reuse the same `/Prev` chain; indirect `/Length`
  is common in TeX output (S08). All are offset-driven with no scanning, so
  the reading stays deterministic. Rejected: requiring the strict F-009
  rule that every byte between objects is whitespace (incremental files
  hold superseded objects); repair (PDF.js's repair interprets damaged
  files in ways the preflight cannot bound).
- **D-3 — Decode only what is needed (BR-414).** Images and font programs
  carry DCT, JBIG2, JPX or exotic filters that text never needs; framing
  them without decoding removes their decoder surface and their budget.
  FlateDecode with PNG predictors covers the cross-reference streams of
  every PDF 1.5+ generator and the content streams of almost all.
  Rejected: other filters (rare on content and CMaps; each adds a decoder);
  TIFF predictor 2 (not used on these streams by common generators).
- **D-4 — Forms that show text refuse (BR-416).** Text-free Forms
  (backgrounds, logos, transparency groups) are common and are dropped.
  Executing text Forms needs per-invocation accounting of repeated
  execution and resource scoping, which can follow in its own ticket.
  Rejected: dropping text Forms silently (a page could return
  `NO_EXTRACTABLE_TEXT` or miss text with no sign); inlining Forms into the
  page content (resource renaming and repeated-execution bounds).
- **D-5 — Fonts without programs (BR-417).** Measurement finding 3 shows
  PDF.js extracts text from the encoding and `ToUnicode` without the
  program. Not parsing programs removes the TrueType/CFF parser, the
  largest attack surface, from untrusted input. Type0 needs `ToUnicode`
  because, without the program, Identity codes have no text meaning; a
  simple font whose only mapping is its program refuses for the same
  reason. Rejected: passing font programs (parser surface, memory);
  predefined CMaps (need external CMap data, refused by BR-122).
- **D-6 — Selected pages only (BR-415).** F-009 read every page's content;
  a feature on page 30 refused a read of page 1. Projecting only the
  selected pages reads less untrusted data and admits more files; other
  pages keep their place so numbering and `total_pages` hold.
- **D-7 — No new dependency; ADR-012.** PDF.js 6.5.438 stays the only PDF
  dependency and still receives a bounded canonical document. ADR-004 fixed
  the closed Helvetica/WinAnsi profile in its decision; ADR-012 supersedes
  that part only (AGENTS.md §7: an accepted ADR never changes). Rejected: a
  general PDF library or a second parser (ADR-004 reasons hold); native
  tools (Docker-only and pure-JavaScript stance).
- **D-8 — Error classes (BR-114 v2).** A cross-reference stream refused as
  `CONTENT_UNAVAILABLE` misled users (finding 2). Bounds first, then
  well-formed-but-unsupported, then inconsistent, matching F-009's
  "Errors" paragraph. No new code or text: the fallback to
  `kdrive_download` is documented instead (D-9).
- **D-9 — Document the rest.** README and `docs/development.md` list the
  admitted container, filters, fonts and operators, the refusals of
  "Out of scope", and say that a refused PDF can be fetched with
  `kdrive_download`. Rejected: a hint in the error text (changes fixed
  error strings, BR-120) or in the tool description (BR-060).

## Open questions

None.

## Stress-test

Pending spec review.
