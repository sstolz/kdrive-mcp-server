---
id: F-034
title: PDF text extraction for common generator output
ticket: "#4"
status: ready-for-freeze
version: 2
---

# F-034 — PDF text extraction for common generator output

Version 1 frozen 2026-11-14 (autonomous mode, PROJECT.md D-1) on reviewed
revision `bf63d65` after spec reviews 1–5 and the spec decision pass; kept in
`features/history/F-034-v1.md`. Version 2 (2026-11-14, ready for freeze) amends
the contract after code review 1 (`4-code-review-1-reviewer`) and the code
decision pass (`4-code-decision-1-fable`): `ToUnicode` codes count at their
assignment and each stream is parsed once (BR-417), a CIDFont `W` covers at most
65,536 CIDs (BR-417), only fonts an emitted `Tf` names are written and numbered
(BR-415), the resources of pages that are not selected are never resolved
(BR-415), and a Form projection too long to be emitted is neither held nor kept
(BR-419); the ceiling table, Hostile input and AC-02, AC-03, AC-05, AC-07, AC-11
and AC-12 follow. BR versions are unchanged: the rules are pending acceptance
and are edited in place. See `## Stress-test`, Code reviews.

Author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-14; revised
after spec reviews 1, 2 and 3, the spec decision pass and spec review 4 by
fresh authors, Claude Opus 5.5 (effort unknown), 2026-11-14.
Base: branch `feat/4-pdf-profile` (main `3151786`).
IDs: F-034; BR-114 v2; BR-412–BR-420 v1; AC-01–AC-13; ADR-012 (proposed,
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

### Measurement 2 (spec review 1, 2026-11-14)

Spec review 1 named generator shapes that v1 of this spec still refused,
and the owner chose to widen the profile to them (option A, 2026-11-14).
Method: the same scratch approach wrote nine more one-page files (S21–S29),
each reproducing one shape with synthetic content. For each file, raw PDF.js
6.5.438 with the production options of `extractPdf` read the source; the
current `extractPdf` (main `3151786`, dev container) gave the "before"
result; and the same PDF.js read a hand-built canonical projection that
follows BR-415–BR-420 below (Forms inlined, canonical font names, no font
program, explicit encodings, inline images removed) for the "after" result.
F-034 v1's outcome follows from its rules (text Forms, inline images and
fonts with no usable mapping refuse).

| Sample | Shape | Raw PDF.js on the source | Before: F-009 | Before: F-034 v1 | After: projection |
| --- | --- | --- | --- | --- | --- |
| S21 | OCRmyPDF: image page, invisible (`3 Tr`) Type0 text layer grafted as a Form | `Hello modern PDF` | `UNSUPPORTED_FORMAT` | `UNSUPPORTED_FORMAT` (text Form) | same as source |
| S22 | qpdf/pdftk overlay: `Contents` array, stamp page as a Form whose `/F1` is another font than the page's `/F1` | `Hello modern PDF` + `Overlay stamp` | `UNSUPPORTED_FORMAT` | `UNSUPPORTED_FORMAT` (text Form) | `Hello modern PDF\nOverlay stamp` (Measurement 3) |
| S23 | pdfjam/pdfpages 2-up: two page Forms, one with a rotating `/Matrix`, no page Font resource | `Hello modern PDF` + `Second page` | `UNSUPPORTED_FORMAT` | `UNSUPPORTED_FORMAT` (text Form) | `Hello modern PDF\nSecond page` (Measurement 3) |
| S24 | pdfTeX page including a PDF figure Form (`PTEX.*`, `/Group`, `gs`) whose labels sit in a nested Form | `Hello modern PDF` + `Figure label` | `UNSUPPORTED_FORMAT` | `UNSUPPORTED_FORMAT` (text Form) | `Hello modern PDF\nFigure label` (Measurement 3) |
| S25 | Skia (Chrome): text inside a transparency-group Form drawn after `gs`, Type0 font, flipped CTM | `Hello modern PDF` | `UNSUPPORTED_FORMAT` | `UNSUPPORTED_FORMAT` (text Form) | same as source |
| S26 | pdfLaTeX Computer Modern Type 1 subset: `Flags 4`, no `/Encoding`, no `ToUnicode`, OT1 built-in encoding in the program | `Hello ﬁnal “modern” – PDF` | `UNSUPPORTED_FORMAT` | `UNSUPPORTED_FORMAT` (no mapping) | same as source |
| S27 | ReportLab: inline image `/F [/A85 /Fl]` before the text | `Hello modern PDF` | `UNSUPPORTED_FORMAT` | `UNSUPPORTED_FORMAT` (`BI`) | same as source |
| S28 | Ghostscript-style: inline image mask, `/F /Fl`, binary data | `Hello modern PDF` | `UNSUPPORTED_FORMAT` | `UNSUPPORTED_FORMAT` (`BI`) | same as source |
| S29 | unfiltered inline image whose data holds the bytes `EI Q` | `Hello modern PDF` | `UNSUPPORTED_FORMAT` | `UNSUPPORTED_FORMAT` (`BI`) | same as source |

For S26 the same PDF.js was also given the font with its program removed and
no `/Encoding`: it returned `Hello nal \modern" { PDF` with `Flags 4` and
with `Flags 32` alike, because without the program PDF.js falls back to
MacRomanEncoding or StandardEncoding and loses the OT1 codes 12 (`fi`), 34,
92 and 123. Giving it instead an explicit encoding derived from the built-in
encoding in the program's cleartext part (BR-420) restored the source text
exactly. Two further findings follow:

4. Text Forms, inline images and Computer Modern fonts are each common
   enough (OCR, overlays, imposition, LaTeX figures, browser printing,
   ReportLab, LaTeX body text) that refusing them leaves whole families of
   files unreadable; each can be admitted with a static bound.
5. Dropping a font program changes PDF.js's choice of base encoding (it then
   follows `Flags` and the font name). The projection must therefore state
   every mapping explicitly and refuse when a shown code's mapping can only
   come from the dropped program.

### Measurement 3 (spec decision pass, 2026-11-14)

The decision pass found gaps that Measurement 2 missed, because it joined the
items PDF.js returns without their line ends. Method: PDF.js 6.5.438 with the
production options of `extractPdf`, each item read as `extractPdf` joins it
(`str`, then a line feed when `hasEOL`), on synthetic files and on hand-built
projections that follow the rules below (canonical font names, base encoding
kept, Type3 projected), in the dev container. Three local generator samples
(LibreOffice 24.2, cairo 1.18 and ReportLab, all with synthetic text) were
surveyed structurally; they are not committed, and S30–S33 are their
synthetic equivalents, built by the test helper.

| Probe | Result |
| --- | --- |
| S21, S25–S29 projected | the source text; S22, S23 and S24 projected give `Hello modern PDF\nOverlay stamp`, `Hello modern PDF\nSecond page` and `Hello modern PDF\nFigure label`, where raw PDF.js on the source gives no line feed between the two parts |
| Type0 `CIDFontType2` without program, `ToUnicode` mapping three codes to `ffi`, U+1F600 and `A` | `fA` when named `ArialMT`, `Arial`, `TimesNewRomanPSMT`, `Calibri`, `Helvetica`, `CourierNew` or `Symbol`; `ffi😀A` when named `Foo`, `Verdana`, `ABCDEF+ArialMT` or `K1`, and for every `CIDFontType0` |
| Simple `Type1` or `TrueType` font with the same kind of `ToUnicode`, named after any of the 12 standard Latin fonts, `Symbol`, `ZapfDingbats`, `ArialMT`, `Arial` or `K1` | the full mapping (`ffi😀C`) in every case |
| Nonembedded `TrueType` `Symbol`, `WinAnsiEncoding`, `Widths`, showing `Hello world` | Greek letters (`Ηελλο ωορλδ…`); named `K1`, `Wingdings` or `Helvetica`: `Hello world…` |
| Nonembedded `Courier` without `Widths`, same text renamed `K1` | same text, split into 3 items under `Courier` and 2 under `K1` (standard metrics) |
| GBK name `/#CB#CE#CC#E5`, `WinAnsiEncoding`; the same font named `K1` | no text; `Hi` |
| `/Differences` `/G80 /c129 /uni0082 /g0083` at their own codes 0x80–0x83 | U+0080–U+0083 with no `/BaseEncoding`, `€•‚ƒ` with `/BaseEncoding /WinAnsiEncoding`, `ÄÅÇÉ` with `MacRomanEncoding` |
| A shown code named `/g17`, `/Foo` or `/G00`; named `/cAB` | the raw code as text; `«` (PDF.js then reads every `c` name of the font as hexadecimal) |
| WinAnsi Helvetica showing 0x01, 0x7F, 0x81, 0x8D, 0x8F, 0x90, 0x9D | a space for 0x01 (no glyph in the table); a bullet U+2022 for each of the others |
| Type3 (LibreOffice shape): `FontMatrix [0.001 0 0 0.001 0 0]`, glyph `/gid883`, `ToUnicode` to U+1F600, between Helvetica text (S32) | `Smile 😀 done` raw, and the same projected as a `Type1` font `/K2` with the same `Widths`, no program |
| Type3 (cairo shape): `FontMatrix [1 0 0 -1 0 0]`, `Widths [1.0]`, glyph `/0`, `ToUnicode` (S33) | `Smile 😀done` raw, and the same projected with `Widths [1000]`; with glyph `/H` and no `ToUnicode`, `Smile Hdone` both ways |
| Content `[/ASCII85Decode /FlateDecode]` (ReportLab default, S30) or `/ASCIIHexDecode` (S31) | `Hello modern PDF` |
| `Tf` size 0.0001, ±0.001, ±0.5, ±12, ±100,000, ±200,000; 0; 250,000; 1,000,000; each showing `Hello modern world`, `T*`, `second line here`, `T*`, `end` with `TL` 1.2 times the absolute size from a point where the text fits its page (`MediaBox [-1000000 -1000000 1000000 1000000]`, the largest the numeric check admits, at 100,000 and above) | `Hello modern world\nsecond line here\nend`; `Hello modern worldsecond line hereend` (no line ends); `Hello modern wor\nsecond line here\nend`; `Hello\nseco` (the lines no longer fit the page and PDF.js leaves out the glyphs outside it) |
| A 120-character line at size 12 on a Letter page; `Hello` and `world` 14 units apart at sizes 100, 512 and 1,000,000 on a Letter page | cut at the page edge; `Hello modernsecond line h\nend`, `Heseend` and `Hsend` with a longer first line, `Hwend` with `Hello`: PDF.js leaves out glyphs outside the page box and joins overlapping lines at any size, on the source and the projection alike |
| Node 26.13.0 inflate of a 64 MiB bomb | `inflateSync` with `maxOutputLength` 65,536 throws `ERR_BUFFER_TOO_LARGE` and returns no output; `createInflate` (`chunkSize` 16,384) destroyed once 65,536 bytes were produced stopped after 4 chunks in about 2 ms |

The survey found, in the LibreOffice sample, a Type3 emoji font with
`ToUnicode`; in the cairo sample, a Type3 font with a flipped `FontMatrix` and
a Type0 font showing a code whose `ToUnicode` destination has two code
points; and in the ReportLab sample, `[/ASCII85Decode /FlateDecode]` on every
stream. Each was refused by the earlier draft on that feature alone. Five
findings follow (10 from the spec review 4 rows):

6. Inlining a Form changes where PDF.js reports a line end, so the expected
   text of a projected file is its own measured string, not raw PDF.js on
   the source.
7. PDF.js reads font names as hints (system-font fallback for Type0, symbol
   and GBK encodings for simple fonts). Canonical names remove those hints;
   only the 12 standard Latin names carry metrics worth keeping.
8. PDF.js reads glyph names of the forms `Gxx`, `cNN`, `uniXXXX` and `g00xx`
   at their own code through the base encoding, and returns the raw code for
   a name it cannot map; the projection keeps the source base encoding name
   and refuses such names.
9. Type3 fonts and the ASCII filters are common generator output (emoji in
   LibreOffice and cairo, every ReportLab stream) and admit a program-less
   projection or a small decoder.
10. The `Tf` size changes no projected text while the lines fit their page. Size
    0 drops every line end, and at 250,000 a line of three words no longer
    fits the largest admissible page, so PDF.js leaves out its last glyphs; the
    projection admits nonzero sizes up to 100,000 in absolute value.

## Scope

- **Container.** Cross-reference streams, hybrid files (`/XRefStm`),
  incremental updates and linearized files through a bounded `/Prev` chain;
  object streams; indirect `/Length`; `%PDF-2.0` headers (BR-412, BR-413).
- **Decoding.** Only the streams the projection needs are decoded: page and Form
  content, `ToUnicode` CMaps, object streams, cross-reference streams, the
  cleartext part of a Type 1 font program whose built-in encoding is needed, and
  FlateDecode inline images whose end must be found. Admitted filters: none,
  FlateDecode with PNG predictors 10–15, ASCII85Decode or ASCIIHexDecode, alone
  or with the ASCII filter before FlateDecode (BR-414); a Type 1 program takes
  FlateDecode or no filter only.
- **Projection.** PDF.js receives a canonical document built only from what
  text extraction needs: the page tree with each page's resolved `MediaBox`,
  and, for the selected pages only, the fonts their content selects under
  canonical names and one re-serialized content stream per page that keeps
  the text operators, with Form XObjects inlined and everything else
  dropped. Metadata, annotations, actions, JavaScript, outlines, structure,
  forms, images, embedded files, XObjects and font programs are never
  emitted (BR-415, BR-416, BR-419).
- **Forms.** Form XObjects, transparency groups included, are inlined
  under a bounded nesting depth, distinct-Form count and execution count;
  every execution counts toward the text-production bound (BR-419, BR-418).
- **Inline images.** Skipped when their data length is given or computable;
  refused otherwise (BR-416).
- **Fonts.** Type 1, MMType1 and TrueType simple fonts whose shown codes all map
  through an explicit or determinable encoding or a `ToUnicode` CMap, including
  Type 1 fonts whose only mapping is the built-in encoding of their program
  (read from its cleartext part only); Type0 fonts with Identity-H or Identity-V
  and a `ToUnicode` CMap that maps every shown code; Type3 fonts, projected as
  program-less simple fonts whose glyph procedures are never read. Every font is
  emitted under a canonical name, except simple fonts named after one of the 12
  standard Latin fonts (BR-417, BR-420).
- **Producer bound.** The F-009 static text-production bound extended to
  mapped fonts and inlined Forms (BR-418).
- **Errors.** Well-formed files outside the profile refuse as
  `UNSUPPORTED_FORMAT`; files inconsistent with their own structure refuse as
  `CONTENT_UNAVAILABLE`; the first failing check in processing order decides
  (BR-114 v2).
- **Docs.** README "Limits" bullet and the `docs/development.md` PDF section:
  what is extracted, what refuses and why, and `kdrive_download` as the
  fallback for a refused file; ADR-012.
- **Tests.** A synthetic corpus helper (`tests/helpers/pdf-corpus.ts`) that
  rebuilds S01–S33 and the hostile samples of the ACs, plus named BR tests.

### Out of scope

- Encryption of any kind, including an empty user password (refuses as
  `UNSUPPORTED_FORMAT`).
- Predefined or embedded CMaps other than Identity-H/V; Type 1 fonts in
  `FontFile3` (CFF) or TrueType fonts whose shown codes have no mapping outside
  the program; `Symbol` and `ZapfDingbats` without `/Differences` or `ToUnicode`
  for their shown codes; shown codes whose glyph name PDF.js cannot map;
  `LZWDecode`, `RunLengthDecode`, other filter orders and TIFF predictor 2 on a
  stream the projection needs, and any filter but FlateDecode on a Type 1
  program; `q`, `Q` or `cm` inside a text object, nested `BT` and text operators
  outside `BT`/`ET` (refused as in F-009); inline images whose length is neither
  given nor computable (DCT, CCITT, JBIG2, LZW or run-length data without `/L`)
  (D-3, D-5, D-10, D-11, D-13).
- Text from annotations, form fields, attachments or optional-content
  metadata; optional-content visibility (text in a hidden optional-content
  Form or marked-content section is returned, as PDF.js returns it from the
  source); OCR; reading order or layout beyond PDF.js item order (BR-115
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
  only input that passes BR-412–BR-420, never starts PDF.js on unsupported,
  malformed or over-budget input, and PDF.js only ever receives the canonical
  projection of BR-415, never source bytes. The header is `%PDF-1.0` to
  `%PDF-1.7` or `%PDF-2.0` at byte 0 followed by an end of line. Checks run in
  this processing order and the first check that fails decides the refusal: the
  header; the cross-reference chain from the last `startxref`, newest section
  first (BR-412); the trailer, including `/Encrypt`; the Catalog and the page
  tree in tree order; then each selected page in ascending page number, its
  `Contents` references with the decoded length each one uses (BR-416), then its
  content tokens in order, where a `Do` of a Form runs that Form's checks, its
  use of decoded bytes included, at that token (BR-419), the first `Tf` that
  selects a font runs that font's checks at that token (BR-417, BR-420), the
  first shown code that needs a Type 1 built-in encoding reads it at that token
  (BR-420), and each emitted canonical token runs the running checks of BR-418
  at that token; then the final weighted U of BR-418. An object, stream or CMap
  is checked when the step that needs it first resolves it. A failing check
  refuses with `LIMIT_EXCEEDED` when it is a declared or computed ceiling of
  F-009 or F-034, every bound of the table "Ceilings added by F-034" included,
  whatever the wording of the BR that states it (the count or size that passes
  the ceiling fails); the computed size of a Flate inline image is a consistency
  check, not a ceiling, and Flate output over it refuses as
  `CONTENT_UNAVAILABLE` (BR-416); with `UNSUPPORTED_FORMAT` when the file is
  well-formed but uses a feature outside the profile (encryption, an unadmitted
  filter, font, encoding, glyph name or operator, an inline image of unknown
  length) or fails an F-009 operand check (arity, type, the 1,000,000 numeric
  bound, the 32-level `q` nesting of BR-416) or the `Tf` size check of BR-416,
  each keeps its F-009 code and is not a ceiling; and with
  `CONTENT_UNAVAILABLE` when the file contradicts its own structure (an offset
  that does not hold the object it names, a cycle, a length that overruns its
  data, a missing required object or resource). Verified by: AC-01, AC-09,
  AC-10.
- **BR-412** — Cross-reference data is read only from the last `startxref`
  offset and the chain it starts, with no scan for objects and no repair.
  Each section is either a classic `xref` table with a trailer, or a stream
  object whose dictionary has `/Type /XRef`, a `/Size`, a `/W` of three
  integers each 0–8 with `W[1]` at least 1, and an optional `/Index` of at
  most 4,096 start/count pairs that are ascending, non-overlapping and whose
  counts total at most `/Size`; its `/Length`, `/Filter`, `/DecodeParms`,
  `/Size`, `/W`, `/Index` and `/Prev` are direct objects. A classic
  trailer's `/XRefStm` and every section's `/Prev` are followed; at most 32
  sections are read and a section offset seen twice is a cycle. Sections
  rank newest first, and for each object number the newest section that
  lists it wins, a free entry included. Within one hybrid section, an
  in-use table entry wins over the section's `/XRefStm`, while a free table
  entry, or a number the table does not list, takes the `/XRefStm` entry;
  the `/XRefStm` entries rank above the section's `/Prev`. The newest
  trailer gives `/Root`; `/Size` of every section is at most 65,536 and
  every listed object number is below its section's `/Size`. A decoded
  cross-reference stream holds exactly the listed entry count times the sum
  of `/W` bytes. A field of width 0 takes its default: type 1 for the first
  field, 0 for the third. A type 0 entry is free, type 1 gives a byte offset
  and generation, type 2 gives an object stream number and index, and any
  other type is free. Verified by: AC-02.
- **BR-413** — An object is resolved only through the merged cross-reference
  table. A type 1 object is parsed at its offset as `<number> <generation> obj`,
  one value, an optional stream framed by its `/Length`, and `endobj`; its
  number and generation equal the entry's. A type 2 object is read from the
  object stream named by the entry, which is itself a type 1 object with `/Type
  /ObjStm`, a direct `/N` of 1–4,096 and a direct `/First`. The header of an
  object stream is parsed once per invocation: `/N` pairs of object number and
  offset, offsets strictly increasing from 0 and each below the decoded length
  minus `/First`. The pair at the entry's index names the same object number;
  the object is the one value between its offset and the next (or the end), has
  generation 0 and is not a stream; `/Extends` is ignored. An indirect `/Length`
  resolves to a nonnegative integer object; resolving it never requires framing
  the stream it measures and opens at most one object stream, whose own
  `/Length` is direct or a type 1 integer object; an indirect `/Length` that
  needs more than one object stream, or an object stream whose own `/Length` is
  neither (a type 2 object, one living inside that object stream itself
  included), refuses as `CONTENT_UNAVAILABLE`. A reference `n g R` names the
  entry of object `n` and requires its generation to be `g`: a type 1 entry with
  generation `g`, any `g` the entry and the object header agree on, or a type 2
  entry when `g` is 0; a reference whose generation differs, and a reference to
  a free, absent or mismatched object, in a role the projection needs, refuses
  as `CONTENT_UNAVAILABLE`. The canonical document renumbers what it emits, with
  generation 0 (BR-415). At most 4,096 distinct objects are resolved per
  invocation (the F-009 indirect-object ceiling); an object resolved again is
  served from the cache and not counted again. Verified by: AC-03.
- **BR-414** — Only the streams BR-412, BR-413, BR-416, BR-417, BR-419 and
  BR-420 need are decoded; any other stream is framed by its `/Length` and never
  decoded, whatever its filter. A needed stream has no filter, or a `/Filter`
  that is a name or an array of one or two names: `/FlateDecode`,
  `/ASCII85Decode` or `/ASCIIHexDecode` alone, or `/ASCII85Decode` or
  `/ASCIIHexDecode` followed by `/FlateDecode`; any other filter, order or count
  refuses as `UNSUPPORTED_FORMAT`. `/DecodeParms` is absent, `null`, a
  dictionary (with one filter) or an array as long as the filter array whose
  entries are dictionaries or `null`; only the entry of `/FlateDecode` may be a
  dictionary, and a dictionary for an ASCII filter refuses as
  `UNSUPPORTED_FORMAT`. The `/FlateDecode` parameters have `/Predictor` 1 or
  10–15, `/Colors` 1–4, `/BitsPerComponent` 8 and `/Columns` 1–65,536; PNG rows
  are undone with each row's own tag and the predicted data is a whole number of
  rows. `/ASCIIHexDecode` reads pairs of hexadecimal digits, skipping white
  space, up to `>` (a final single digit is followed by 0); `/ASCII85Decode`
  reads groups of five characters `!`–`u`, `z` for four zero bytes at the start
  of a group, skipping white space, up to `~>`, a final group of 2–4 characters
  giving 1–3 bytes. Under either filter, a byte other than those it reads (a
  hexadecimal digit; `!`–`u`, or `z` at the start of a group), white space and
  its end marker, an ASCII85 group above 2^32 − 1 or final group of one
  character, or data that ends without its end marker (`>` for
  `/ASCIIHexDecode`, `~>` for `/ASCII85Decode`) refuses as
  `CONTENT_UNAVAILABLE`, and bytes after the end marker are ignored. Each needed
  stream is decoded once per invocation, and the output of each filter of its
  chain, the ASCII stage before `/FlateDecode` included, counts against B with
  the F-009 inflate rules (`maxOutputLength` set to the remaining B,
  `rejectGarbageAfterEnd`); an ASCII stage whose output passes the remaining B
  refuses as `LIMIT_EXCEEDED` at that byte. Content and Form streams also count
  their decoded length again at each further use (BR-416, BR-419). Two
  exceptions apply. A Flate inline image (BR-416) is inflated from the rest of
  its content stream with `maxOutputLength` set to the smaller of its computed
  size and the remaining B and without `rejectGarbageAfterEnd`, since the
  content after its data is not garbage; its data length is the number of input
  bytes the inflate consumed up to the end of the zlib stream. A Type 1 program
  (BR-420) has no filter or `/FlateDecode` alone, without `/DecodeParms`;
  another filter or any `/DecodeParms` refuses as `UNSUPPORTED_FORMAT`, and a
  `/Length1` over the remaining B refuses as `LIMIT_EXCEEDED` before inflating.
  Node offers no synchronous inflate that stops early (`inflateSync` with
  `maxOutputLength` throws and returns no output), so a Flate program is
  inflated with the asynchronous `zlib.createInflate` with `chunkSize` 16,384:
  output chunks are kept until `/Length1` bytes are held, then the stream is
  destroyed and reads no further input. Every byte it produced, at most
  `/Length1` + 16,383, counts against B, and output passing the remaining B
  refuses as `LIMIT_EXCEEDED`; a program whose output (or unfiltered data) ends
  before `/Length1` bytes refuses as `CONTENT_UNAVAILABLE`. Verified by: AC-04,
  AC-12.
- **BR-415** — The canonical document holds exactly: a Catalog with `Type` and
  `Pages`; every Pages node with `Type`, `Kids`, `Count` and `Parent` except at
  the root; every page with `Type`, `Parent`, its `MediaBox` (its own, or the
  nearest inherited one) and `Resources` and `Contents`; a trailer with `Size`
  and `Root`. A selected page's `Resources` holds only `Font`, with the fonts
  BR-417 admits that an emitted `Tf` of that page's canonical content names,
  under canonical names `/K1`, `/K2`, … numbered without gaps in the order in
  which an emitted `Tf` first names them in the invocation (one name per
  indirect font object, or per direct font dictionary at its place, whatever
  resource name or Form selected it; the same names serve as `BaseFont` under
  BR-417); a font that only `Tf`s of Forms that emit nothing (BR-419) select is
  read and checked (BR-417, BR-420) but neither named nor written, so every
  written font is referenced by some page, and its `Contents` is the one stream
  BR-416 builds, with no filter. A selected page with no `/Contents` gets an
  empty content stream. A page that is not selected gets empty `Resources` and
  an empty content stream, and its content and resources are not read: its
  `/Resources` value, its own or inherited, is neither resolved nor
  type-checked, and only a selected page's value is resolved, when that page is
  processed. Every other key, object and stream of the source, XObjects
  included, is left out. The page tree keeps its source order and count, so
  `total_pages` is unchanged. Every emitted object is numbered by the projection
  with generation 0. Verified by: AC-05.
- **BR-416** — A selected page's content is its `Contents` stream, or the
  streams of a `Contents` array of at most 1,024 references joined with one line
  feed, tokenized once in order, with the page's `Resources` (own or inherited)
  as resource scope. Each stream is decoded and tokenized once per invocation
  (BR-414), but every use counts its decoded length against B: each reference of
  a selected page's `Contents` beyond the stream's first use, on the same page
  or another selected page, adds the stream's decoded length again, as the
  references are read and before the page's content is joined or tokenized, and
  the reference that passes the remaining B refuses as `LIMIT_EXCEEDED`; dropped
  operators, which emit no token, are thus paid for at every use. Kept, with the
  F-009 operand checks: `q`, `Q`, `cm`, `BT`, `ET`, the text state operators
  `Tf`, `Tc`, `Tw`, `Tz`, `TL`, `Ts` and `Tr` (integer 0–7), and inside
  `BT`/`ET` only `Td`, `TD`, `Tm`, `T*`, `Tj`, `TJ`, `'` and `"`. As in F-009
  and ISO 32000-1 §8.2, `BT` inside a text object, `ET` outside one, `Td`, `TD`,
  `Tm`, `T*` or a text-show operator outside `BT`/`ET`, and `q`, `Q` or `cm`
  inside `BT`/`ET` refuse as `UNSUPPORTED_FORMAT` (PDF.js runs them with state
  rules of its own, which the preflight does not model). The F-009 limit of 32
  nested `q` levels is counted on the canonical stream of the page, the `q` that
  wraps each inlined Form and the Forms' own `q`s included (BR-419); the `q`
  that opens a 33rd level refuses as `UNSUPPORTED_FORMAT`. String bytes are not
  restricted to 0x20–0xFF, and `Tf` takes a font name of the resource scope and
  a size that passes the F-009 numeric operand check, is not 0 and is at most
  100,000 in absolute value (otherwise `UNSUPPORTED_FORMAT`); negative and
  fractional sizes are admitted. This measured bound replaces the F-009 size
  range 1–512: within it the size only changes the geometry of PDF.js's items,
  as it does on the source, while size 0 drops PDF.js's line ends and, at
  250,000, a line of three words no longer fits the largest page the numeric
  check admits, so PDF.js leaves out its last glyphs (F-034 Measurement 3,
  D-13). Text state is part of the graphics state: it persists across `BT`/`ET`,
  is saved and restored by `q`/`Q`, `BT` resets only the text matrices, and text
  state operators are kept inside or outside `BT`/`ET`. A text-show operator
  with no font set refuses as `CONTENT_UNAVAILABLE`. Dropped, operands included:
  path construction and painting, clipping, colour and colour space, line and
  rendering state, `sh`, marked content (`BMC`, `BDC`, `EMC`, `MP`, `DP`),
  `BX`/`EX`, `gs` (refused when the ExtGState it names in the resource scope
  holds `/Font`), `Do` of an Image or PostScript XObject, and inline images
  whose data is framed as follows: after `BI`, at most 32 key/value pairs up to
  `ID`, with direct values only, and one white-space byte; the data length is
  `/L` (or `/Length`) when present, else, when the first filter of `/F` (or
  `/Filter`) is `/AHx` (or `/ASCIIHexDecode`), the bytes up to and including the
  first `>`, else, when it is `/A85` (or `/ASCII85Decode`), the bytes up to and
  including the first `~>`, else, with no filter, the computed size, else, when
  the only filter is `/Fl` (or `/FlateDecode`) with no `/DP` (or
  `/DecodeParms`), the input bytes that one inflate of BR-414 consumes
  (`maxOutputLength` the smaller of the computed size and the remaining B). The
  computed size is `H` × ceil(`W` × `BPC` × components / 8), where `W` and `H`
  are 1–65,536, `BPC` is 1, 2, 4, 8 or 16 and is 1 when absent with `/IM true`,
  and components are 1 for `/G`, `/I`, an indexed space or `/IM true`, 3 for
  `/RGB` and 4 for `/CMYK`, long names included; a `W` or `H` over 65,536
  refuses as `LIMIT_EXCEEDED`. After the data come optional white space and `EI`
  followed by white space, a delimiter or the end. An inline image whose length
  is none of these refuses as `UNSUPPORTED_FORMAT`; framing that overruns the
  content or is not followed by `EI` refuses as `CONTENT_UNAVAILABLE`; an
  inflate whose output passes the remaining B refuses as `LIMIT_EXCEEDED`; one
  whose output passes the computed size first, a consistency check and not a
  ceiling, refuses as `CONTENT_UNAVAILABLE`, as does a zlib stream that does not
  end within the content; inflated inline bytes count against B. `Do` of a Form
  XObject is inlined by BR-419. `Do` inside `BT`/`ET`, `d0`, `d1` and any other
  operator refuse as `UNSUPPORTED_FORMAT`. A `Q` with no open `q` of the same
  content stream or Form is dropped, and `Q`s are appended for the `q`s left
  open at its end. The kept tokens are rebuilt by the canonical serializer
  (numbers in the F-009 form, strings as hexadecimal strings, names with `#xx`
  escapes for bytes outside 0x21–0x7E, delimiters and `#`, `Tf` operands renamed
  to the canonical font names), never copied as source bytes; that stream counts
  against the canonical bound. Verified by: AC-06.
- **BR-417** — Only fonts selected by a kept `Tf` are read, at most 128 distinct
  fonts per invocation; a `Tf` naming no font of its resource scope refuses as
  `CONTENT_UNAVAILABLE`. Every key the projection keeps or reads is
  type-checked, and a wrong type or a missing required key refuses as
  `CONTENT_UNAVAILABLE`. Admitted: (a) `Type1`, `MMType1` or `TrueType` simple
  fonts whose encoding BR-420 resolves; (b) `Type0` with `/Encoding` the name
  `Identity-H` or `Identity-V`, one `CIDFontType0` or `CIDFontType2` descendant
  with a `FontDescriptor`, and a `ToUnicode` stream that maps every code the
  font's kept strings show (a shown code it does not map refuses as
  `UNSUPPORTED_FORMAT`; a string of odd length shown with it refuses as
  `CONTENT_UNAVAILABLE`); (c) `Type3` fonts whose encoding BR-420 resolves,
  projected as a simple font without a program: `FontMatrix` is an array of six
  numbers that pass the F-009 numeric operand check, the first above 0, the
  second and third 0 and the fourth not 0 (any other refuses as
  `UNSUPPORTED_FORMAT`), `FirstChar`, `LastChar`, `Widths` and `Encoding` are
  required, and `CharProcs`, `Resources`, `FontBBox` and `FontDescriptor` are
  never resolved or read. A `ToUnicode` given as a name, such as `/Identity-H`,
  refuses as `UNSUPPORTED_FORMAT`. The projected simple font keeps `Type`,
  `Subtype` (`Type1` for a `Type3` source), `BaseFont`, `FirstChar`, `LastChar`
  (integers 0–255), `Widths` (at most 256 finite numbers; for a `Type3` source
  each width times the first `FontMatrix` number times 1,000, a product over
  1,000,000 in absolute value refusing as `UNSUPPORTED_FORMAT`), `ToUnicode` and
  the `Encoding` of BR-420; the projected Type0 font keeps `Type`, `Subtype`,
  `BaseFont`, `Encoding`, `ToUnicode` and one descendant with `Type`, `Subtype`,
  `BaseFont` (the same name), `DW` (a finite number), `W` (an array of at most
  65,536 numbers in total, in the `c [w …]` and `c1 c2 w` forms, codes 0–65,535,
  whose ranges and arrays cover at most 65,536 CIDs in total, each `c1 c2 w`
  covering c2 − c1 + 1 CIDs, or none when c2 is below c1, and each `c [w …]` as
  many CIDs as its array has numbers, so that the widths PDF.js 6.5.438 expands
  stay bounded), its `FontDescriptor`, and a `CIDSystemInfo` emitted as `<<
  /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>` after the source
  value is checked (a dictionary with `Registry` and `Ordering` strings of at
  most 64 bytes and an integer `Supplement`). The emitted `BaseFont` of every
  font is its canonical name of BR-415, except for a `Type1`, `MMType1` or
  `TrueType` font whose source `BaseFont` is exactly one of the 12 standard
  Latin names (`Times-Roman`, `Times-Bold`, `Times-Italic`, `Times-BoldItalic`,
  `Helvetica`, `Helvetica-Bold`, `Helvetica-Oblique`, `Helvetica-BoldOblique`,
  `Courier`, `Courier-Bold`, `Courier-Oblique`, `Courier-BoldOblique`), which
  keeps it so that PDF.js uses that font's standard metrics; the source
  `BaseFont`, a name of at most 127 bytes (optional for `Type3`), is checked and
  otherwise never emitted, since PDF.js 6.5.438 reads font names as hints (a
  system-font fallback that keeps one code point per `ToUnicode` destination for
  some Type0 names, the symbol and GBK encodings for simple fonts). A kept
  `FontDescriptor` holds `Type`, `FontName` (emitted equal to the projected
  `BaseFont` of the font that holds it, whatever its source value, since PDF.js
  6.5.438 uses `FontName` when it differs from `BaseFont`), `FontBBox` (four
  finite numbers), `ItalicAngle`, `Ascent`, `Descent`, `CapHeight`, `StemV` and
  `MissingWidth` (finite numbers, each optional except `FontName`), and `Flags`
  set to the source `Flags` with the Symbolic flag (value 4) cleared and the
  Nonsymbolic flag (value 32) set; a simple font without a source
  `FontDescriptor`, and every projected `Type3` font, get none. `FontFile`,
  `FontFile2`, `FontFile3`, a stream `CIDToGIDMap`, `CharProcs` and `FontMatrix`
  are never emitted. A `ToUnicode` CMap is parsed with the bounded tokenizer:
  only code space ranges, `bfchar` and `bfrange` entries count; codes are 1 or 2
  bytes and keyed by their numeric value; a `bfrange` has a low and high code of
  the same length that differ only in the last byte, low not above high, and
  either one destination string, incremented over the range as PDF.js 6.5.438
  does, or an array whose length equals the range size; destinations are
  UTF-16BE strings of 2–64 bytes; when a code is mapped twice the last entry
  wins; `usecmap` refuses as `UNSUPPORTED_FORMAT`; every code an entry assigns
  counts at its assignment, a `bfchar` entry 1 and a `bfrange` entry its range
  size (high − low + 1), a code assigned twice counting twice; one CMap assigns
  at most 65,536 codes and all admitted CMaps together at most 262,144, and the
  entry whose assignments pass either count refuses as `LIMIT_EXCEEDED` before
  its range is expanded. Each `ToUnicode` stream is parsed and counted once per
  invocation: fonts that share one stream reuse that parse. Each admitted CMap
  is re-emitted canonically as one `bfchar` entry per mapped code in ascending
  order. Passing a bound of this rule (128 fonts, a 127-byte `BaseFont`, 256
  `Widths` numbers, 65,536 `W` numbers, 65,536 CIDs covered by one `W`, 64-byte
  `CIDSystemInfo` strings, 64-byte destinations, the CMap code counts) refuses
  as `LIMIT_EXCEEDED`. Every other font refuses as `UNSUPPORTED_FORMAT`.
  Verified by: AC-07.
- **BR-418** — The F-009 text-production admission holds with weighted string
  bytes, counted on the canonical content stream of each selected page, so every
  Form execution counts its strings and operators again: N is the sum over
  text-show strings of the string's bytes times `m` of the font in effect at
  that point of the canonical stream (for a Form that shows text before its own
  `Tf`, the font its caller set, at each execution), where `m = max(1, ceil(D /
  3))`; S is the number of shown codes: string bytes for a simple font, string
  bytes divided by two for a Type0 font (whose codes are two bytes, BR-417), so
  a two-byte code counts as one possible item; O is the number of operators in
  the canonical content stream. D of a font is the largest of: the UTF-8 length
  of each canonical `ToUnicode` destination (an unpaired surrogate counts 3
  bytes); for each glyph name in the font's canonical `/Differences`, 4 when the
  name starts with `u` and has 6 characters, or 7 characters without the prefix
  `uni`, else 3; and 1. `U = 8 * (N + O + 1)`, `I = 2 * (S + O + 1)`, the sum of
  U plus 3 per separator is at most B, the sum of I at most 65,536, and a string
  over 4,096 bytes refuses. These checks run while the canonical content is
  emitted: at each emitted token, the canonical bytes emitted so far, the
  4,096-byte string check, S, O, the sum of I and the sum of U computed with `m
  = 1` (both sums including the current page's `+ 1` terms and separator) are
  updated, and the token that makes one of them pass its ceiling refuses there
  as `LIMIT_EXCEEDED`, before the next token is read. Only the sum of U with
  each font's final `m`, known once every shown code is collected, is checked
  after the last selected page. All refusals happen before PDF.js starts.
  Verified by: AC-08, AC-11.
- **BR-419** — A `Do` whose name the resource scope's `/XObject` maps to a
  stream with `/Subtype /Form` (any `/Group`, `/Ref`, `/OC`, `PTEX.*` or other
  key ignored) is inlined: the canonical content receives `q`, then `cm` with
  the Form's `/Matrix` when it is present and not the identity, then the Form's
  projected tokens, then `Q`; the wrapping `q` counts toward the 32-level
  nesting of BR-416. A `/Matrix` that is not an array of six numbers passing the
  F-009 `cm` operand check (each finite, with absolute value at most 1,000,000)
  refuses as `UNSUPPORTED_FORMAT`, as a failing `cm` does. The Form's content is
  its decoded stream, decoded once per invocation and checked with BR-416; every
  execution after the stream's first use adds its decoded length to the bytes
  counted against B (BR-414), at the `Do` and before any of its tokens is
  emitted, and the execution that passes the remaining B refuses as
  `LIMIT_EXCEEDED`, so dropped operators in a Form are paid for at every
  execution. The content is checked starting outside `BT` with the caller's
  graphics state and font; content that ends inside `BT`/`ET` refuses as
  `CONTENT_UNAVAILABLE`. Its resource scope is its own `/Resources`, or, when it
  has none, the resource scope of the content that invoked it; its `Tf`, `gs`
  and `Do` names resolve in that scope, and fonts it selects take the canonical
  names of BR-415. The projection of a Form is built once per pair of Form and
  resource scope and reused for later executions with that scope, its nested
  executions counted again each time (a projection holding more tokens than the
  sum of I can still admit is not kept and is rebuilt at each execution, which
  pays its decoded length again as every execution does, and inflates and counts
  its inline images again); at each execution, its text-show strings are counted
  (BR-418) and their codes collected (BR-417, BR-420) with the font in effect at
  that point of the canonical stream, so a Form that shows text with its
  caller's font adds its codes to that font, once for each font it is drawn
  with. An inlined Form whose projected tokens, nested Forms included, hold no
  text-show operator (`Tj`, `TJ`, `'`, `"`) emits nothing, whatever its length:
  while no text has been shown, the tokens held back for it are at most one more
  than the sum of I can still admit, and a text-show after more refuses as
  `LIMIT_EXCEEDED` at the same token as if all were held; one that shows text
  before its own first `Tf` needs a font set by its caller (BR-416). Bounds per
  invocation: at most 256 distinct Forms, nesting at most 8 Forms deep, and at
  most 4,096 Form executions in total (every `Do` of a Form counts, with or
  without text); a Form reached again on its own `Do` path is a cycle and
  refuses as `CONTENT_UNAVAILABLE`; an XObject of another subtype than `Form`,
  `Image` or `PS` refuses as `UNSUPPORTED_FORMAT`. Verified by: AC-11.
- **BR-420** — A simple font's encoding is resolved per shown code, and the
  projection emits it as `/Encoding << /Type /Encoding /BaseEncoding <name>
  /Differences [...] >>`. `/BaseEncoding` is the source base encoding name when
  it is `WinAnsiEncoding`, `MacRomanEncoding` or `MacExpertEncoding` (the
  `/Encoding` name or its `/BaseEncoding`), the three names PDF.js 6.5.438
  honours, and is left out otherwise (a `StandardEncoding` name, which PDF.js
  ignores, or a base table taken from the font name, `Flags` or the program),
  because PDF.js reads a glyph name of the `G`, `g`, `C`, `c` or `u` forms below
  whose value equals its own code through that base. `/Differences` lists every
  code the font's kept strings show that the `ToUnicode` CMap does not map, with
  its resolved glyph name; codes are collected at every execution with the font
  in effect (BR-419). A source `/Encoding` is checked in every case, even when a
  `ToUnicode` CMap exists: a name `StandardEncoding`, `WinAnsiEncoding`,
  `MacRomanEncoding` or `MacExpertEncoding`, or a dictionary with optional
  `/Type /Encoding`, one of those names as optional `/BaseEncoding` and optional
  `/Differences` of codes (integers 0–255) and glyph names; any other value
  refuses as `UNSUPPORTED_FORMAT`, and more than 256 codes or a glyph name over
  31 bytes refuses as `LIMIT_EXCEEDED`. The base table is the named one, else
  (no `/Encoding`, or no `/BaseEncoding`): no base table for a `Type3` font;
  StandardEncoding for a font with no font program whose `BaseFont`, without a
  subset prefix, is one of the 12 standard Latin fonts (Times, Helvetica and
  Courier families) or whose `Flags` have Nonsymbolic set and Symbolic clear;
  StandardEncoding for a `TrueType` font with a `FontFile2` and Nonsymbolic set;
  for a `Type1` or `MMType1` font with a `FontFile`, the built-in encoding of
  its program; otherwise no base table. `/Differences` entries override the base
  table. The built-in encoding is read only at the first shown code that the
  `ToUnicode` CMap does not map and that has no `/Differences` entry, so the
  program of a font whose `/Differences` and `ToUnicode` cover every shown code
  is never read. It is read from the program's cleartext part only: a direct
  integer `/Length1` of 1–65,536 bytes (over 65,536 refuses as
  `LIMIT_EXCEEDED`), decoded by the streaming inflate of BR-414 up to that
  length, tokenized with the bounded tokenizer up to its first `/Encoding` name,
  which is followed either by `StandardEncoding def` or by `<n> array` with `n`
  1–256, optionally `0 1 255 {1 index exch /.notdef put} for`, `dup <code>
  /<name> put` groups with each code below `n`, and `readonly def` or `def`;
  when a code is put twice, the last group wins; more than 256 groups or a name
  over 31 bytes refuses as `LIMIT_EXCEEDED`; anything else, or no `/Encoding` in
  that part, refuses as `UNSUPPORTED_FORMAT`, and the encrypted part is never
  read. The tables are those of PDF.js 6.5.438. A shown code that the
  `ToUnicode` CMap does not map and that resolves to no glyph name, to
  `.notdef`, or to a name PDF.js 6.5.438 maps to no character refuses as
  `UNSUPPORTED_FORMAT`, as a Type0 code without a mapping does, since PDF.js
  would return the raw code. PDF.js maps a name of its glyph list; `uni` and
  four uppercase hexadecimal digits, or `u` and four to six; `G` and two
  hexadecimal digits; `g` and four; `C` or `c` and two or three decimal digits;
  and `f_h`, `f_t` and `T_h`; each numeric form giving a value 1–0x10FFFF. Any
  other name, a `C` or `c` name with hexadecimal digits included (PDF.js then
  rereads every such name of the font as hexadecimal), refuses. Verified by:
  AC-07, AC-12.

## Contract details

### Ceilings added by F-034

All are per invocation, cumulative under BR-117 (equality permitted), and
passing any of them refuses as `LIMIT_EXCEEDED`, in the BR texts and here alike;
a value below a lower bound or of the wrong type refuses as its BR says. Flate
inline image output over its computed size is a consistency check, not a
ceiling, and refuses as `CONTENT_UNAVAILABLE` (BR-416). The F-009 operand checks
(arity, type, the 1,000,000 numeric bound, 32 nested `q` levels), and the
BR-416 `Tf` size check, are not ceilings and keep their F-009 code,
`UNSUPPORTED_FORMAT`. F-009 ceilings are unchanged. AC-13 covers one example
on each side of every ceiling not covered by AC-02–AC-12.

| Work | Ceiling |
| --- | --- |
| Cross-reference sections read (`/Prev`, `/XRefStm`) | 32 |
| `/Size` of a section; listed object numbers | 65,536; below `/Size` |
| `/W` field width; `/Index` pairs | 8 bytes each (`W[1]` ≥ 1); 4,096 |
| Distinct objects resolved | 4,096 (F-009 ceiling, now counted on first resolution) |
| Objects in one object stream (`/N`) | 4,096 |
| PNG predictor `/Columns` (with `/Colors` up to 4) | 65,536 |
| `Contents` array references | 1,024 |
| Distinct Forms; Form nesting; Form executions | 256; 8; 4,096 |
| Inline image dictionary pairs; `W`, `H` | 32; 65,536 each |
| Flate inline image output | remaining B |
| ASCII filter output (each stage) | remaining B |
| Decoded bytes used by `Contents` references and Form executions, counted per use | remaining B |
| Type 1 program inflate output | remaining B (at most `/Length1` + 16,383 bytes) |
| Distinct fonts read | 128 |
| `Widths` numbers; `Differences` codes; glyph name | 256; 256; 31 bytes |
| CIDFont `W` numbers; CIDs one `W` covers | 65,536; 65,536 |
| `BaseFont` name; `CIDSystemInfo` strings | 127 bytes; 64 bytes each |
| Type 1 cleartext `/Length1`; built-in encoding groups | 65,536 bytes; 256 |
| `ToUnicode` codes assigned per CMap; in all CMaps (each stream once) | 65,536; 262,144 |
| `ToUnicode` destination | 64 bytes UTF-16BE |
| Text-show string (F-009) | 4,096 bytes |

Decoded bytes of cross-reference streams, object streams, content streams, Form
streams, `ToUnicode` streams, Type 1 cleartext parts (with the inflate's
overshoot of at most 16,383 bytes) and inflated inline images count against B,
the output of each ASCII filter stage included; content and Form streams count
their decoded length again at every further use, per `Contents` reference,
selected page and Form execution (BR-416, BR-419); the canonical document, with
its re-serialized content and CMaps, stays at most B, checked at each emitted
token (BR-418). Streams that are never decoded add nothing.

### Hostile input

- Decompression bombs: every inflate runs under the remaining B (F-009); object
  and cross-reference streams share that budget; a Flate inline image inflates
  under the smaller of its computed size and the remaining B, so a computed size
  of up to 2^35 bytes never raises the cap; a Type 1 program is inflated by an
  asynchronous inflate destroyed once `/Length1` bytes are held, so at most one
  16 KiB chunk more is produced, and that overshoot counts against B; an
  `/ASCII85Decode` stage, whose `z` turns one byte into four, counts its output
  against B; nothing is decoded speculatively.
- Cross-reference loops and floods: a repeated section offset is a cycle; 32
  sections, `/Size` 65,536 and 4,096 `/Index` pairs bound the table; sections
  merge into one table as they are read, newest first, so it holds at most
  65,536 entries whatever the number of sections.
- Object-stream recursion: an object stream is reached only through a
  type 1 entry and never holds a stream, so it cannot contain another; the
  `/Length` rule of BR-413 stops length chains; each header is parsed once.
- Huge `/Length`: a stream that overruns the file refuses; the F-009
  8 MiB stream ceiling stays.
- Predictor abuse: the row width is bounded, the data is a whole number of
  rows, and undoing a predictor never grows the data.
- Font and CMap abuse: font programs are never parsed and never reach PDF.js;
  only the cleartext part of a Type 1 program is tokenized, under a 64 KiB
  bound, and only when a shown code needs it; CMaps are bounded and re-emitted
  canonically, so PDF.js never parses a source CMap; each `ToUnicode` stream is
  parsed once and every code a `bfrange` assigns counts at its assignment, so
  range expansion costs at most 262,144 assignments per invocation; a CIDFont
  `W` covers at most 65,536 CIDs, so PDF.js expands at most that many widths per
  font; every shown code that `ToUnicode` does not map is listed in
  `/Differences` under a glyph name PDF.js maps, so the default table PDF.js
  picks from `Flags` never decides a shown code; fonts are emitted under
  canonical names (the 12 standard Latin names excepted), so no source name
  reaches PDF.js's system-font, symbol-encoding or GBK heuristics; a Type3
  font's glyph procedures and resources are never read.
- Repeated execution: every Form execution is inlined and counted, so a Form
  drawn many times or nested many ways costs its full output against B, the item
  ceiling and the 4,096-execution ceiling before PDF.js starts; the running
  checks of BR-418 stop the projection at the token that passes a ceiling, so
  the canonical stream is never built beyond the bounds; each Form is decoded
  once and its projection kept unless it holds more tokens than can still be
  emitted (then it is rebuilt at each execution, its inline images inflated and
  counted again, and a Form that emits nothing holds back at most that many
  tokens), but its decoded length counts against B at every execution, as a
  content stream does at every `Contents` reference and selected page, so a
  stream of dropped operators reused 1,024 times on each of 10 pages, which
  emits no token, still costs 10,240 times its length against B before it is
  tokenized.
- Inline-image smuggling: inline data is skipped by a length that never
  depends on searching for `EI`, so bytes inside the data (S29) are never
  read as operators.

## Acceptance criteria

All ACs run against the actual pinned PDF.js through `extractPdf` (or the
worker) with a spy on the PDF.js start, using synthetic files built by
`tests/helpers/pdf-corpus.ts`. Each refusing sample holds exactly one defect;
every other part of the file is valid, so the expected code is the one the
named check gives. AC-09 (g) and (h) hold two defects on purpose, to test
the processing order.

- **AC-01** (BR-114 v2, BR-412–BR-420) — Given S01–S33 of the measurements
  (S30–S33 are the synthetic equivalents of Measurement 3: `[/ASCII85Decode
  /FlateDecode]` and `/ASCIIHexDecode` content, the LibreOffice-shaped and
  cairo-shaped Type3 fonts), When page 1 is read, Then each returns exactly its
  golden string, measured on its projection (Measurement 3, `\n` a line feed),
  with `total_pages` 1: `Hello modern PDF` for S01–S21, S25 and S27–S31; `Hello
  modern PDF\nOverlay stamp` for S22; `Hello modern PDF\nSecond page` for S23;
  `Hello modern PDF\nFigure label` for S24; `Hello ﬁnal “modern” – PDF` for S26;
  `Smile 😀 done` for S32; and `Smile 😀done` for S33; and the bytes PDF.js
  receives contain no `/Filter`, `/XRef`, `/ObjStm`, `/FontFile`, `/Metadata`,
  `/Info`, `/ExtGState`, `/XObject`, `/Type3`, `/CharProcs` or `BI`. Verified
  by: `BR-114 v2 AC-01 synthetic producer corpus extracts`.
- **AC-02** (BR-412) — Given (a) a file whose second revision replaces page 1's
  content, (b) a hybrid file whose table marks the content object free and whose
  `/XRefStm` lists it in use, (b2) the same file whose table lists the content
  object in use at the right offset and whose `/XRefStm` lists it in an object
  stream with other text, (c) a linearized-style file whose last `startxref`
  points at a first-page section with `/Prev` to the main section, (d) a `/Prev`
  chain A→B→A, (e) 32 and 33 sections, (f) `/Size` 65,536 and 65,537, (g) `/W [1
  8 2]` and `/W [1 9 2]`, (h) a cross-reference stream one byte short of its
  entry count, (i) an indirect `/W`, (j) `/W [1 0 2]`, (k) `/W [0 4 0]` listing
  every object, (l) `/Index [0 5 3 4]`, (m) `/Index [5 4 0 5]`, (n) `/Index`
  counts totalling `/Size` + 1, (o) 4,096 and 4,097 `/Index` pairs, (p) 31
  sections whose 30 older ones are cross-reference streams of 65,536 one-byte
  rows (`/W [0 1 0]`), When page 1 is read, Then (a) gives the second revision's
  text, (b), (c), (g) at 8 and (k) give the text, (b2) gives the table's text,
  (d) and (h) are `CONTENT_UNAVAILABLE`, (e) gives the text at 32 and
  `LIMIT_EXCEEDED` at 33, (f) and (o) give the text then `LIMIT_EXCEEDED`, (g)
  at 9 is `LIMIT_EXCEEDED`, (i), (j), (l), (m) and (n) are
  `CONTENT_UNAVAILABLE`, (p) gives the text with at most 66,560 map insertions
  while the chain is read (65,536 for the one merged table and the dictionaries
  of the sections, not one table per section), each refusal before PDF.js.
  Verified by: `BR-412 AC-02 cross-reference chain`.
- **AC-03** (BR-413) — Given (a) all non-stream objects in one object stream,
  (b) a type 2 entry naming an object stream that is itself a type 2 object, (c)
  a header pair naming another object number, (d) a stream object inside an
  object stream, (e) indirect `/Length` objects, one of them inside an object
  stream, (f) an object stream whose `/Length` lives inside itself, (g) a
  generation mismatch on the page object, (h) a page tree that needs 4,096 and
  4,097 distinct resolved objects, (i) a page tree that resolves the same 4,000
  objects twice, (j) header offsets `0 10 10`, (k) `/N` 4,096 and 4,097, (l) an
  object stream whose `/Length` is a type 2 object of another object stream, (m)
  a content stream referenced as `4 1 R` whose entry and object have generation
  1, (n) a reference `5 1 R` to a type 2 object, (o) a `Contents` array whose
  first stream has `/Length 7 0 R` and whose second has `/Length 7 5 R`, object
  7 having generation 0, (p) a page whose `/F1` is `5 0 R` and whose `/F2`,
  selected after `/F1`, is `5 7 R`, When page 1 is read, Then (a), (e), (i) and
  (m) give the text, (b), (c), (d), (f), (g), (j), (l), (n), (o) and (p) are
  `CONTENT_UNAVAILABLE`, and (h) and (k) give the text then `LIMIT_EXCEEDED`,
  each refusal before PDF.js. Verified by: `BR-413 AC-03 object resolution`.
- **AC-04** (BR-414, BR-117) — Given budget B and (a) Flate content with
  predictor 12 whose inflated bytes, counted against B with everything else the
  file decodes, reach exactly B and B + 1, (b) an object stream and (c) a
  cross-reference stream that each inflate one byte over the remaining B, (d)
  `/Columns` 65,536 with `/Colors` 4 and `/Columns` 65,537, (e) predictor 2, (f)
  predicted data that is not a whole number of rows, (g) `LZWDecode` content,
  (h) a page that also draws a `DCTDecode` image whose data is not a JPEG, (i) a
  `/Length` past the end of the file, (j) content with
  `/Filter [/ASCII85Decode /FlateDecode]` and
  `/DecodeParms [null << /Predictor 12 /Columns 4 >>]`, a `ToUnicode` with
  `/ASCIIHexDecode`, and an object stream with `[/ASCIIHexDecode /FlateDecode]`,
  (k) `/DecodeParms [<< /Predictor 12 >> null]` on that chain, (l)
  `[/FlateDecode /ASCII85Decode]`, (m) `/ASCII85Decode` data holding the byte
  `v`, `/ASCII85Decode` data without `~>`, `/ASCIIHexDecode` data holding the
  byte `G`, and `/ASCIIHexDecode` data without `>`, each in its own file, (n)
  `/ASCII85Decode` data of `z` groups whose output passes the remaining B, (o)
  `/ASCIIHexDecode` and (p) `/ASCII85Decode` content with no other filter whose
  decoded bytes, counted against B with everything else the file decodes, reach
  exactly B and B + 1, and the same filter before `/FlateDecode` with its ASCII
  stage output reaching B + 1, When page 1 is read, Then (a) gives the text at B
  and `LIMIT_EXCEEDED` at B + 1, (b) and (c) are `LIMIT_EXCEEDED`, (d) gives the
  text at 65,536 and `LIMIT_EXCEEDED` at 65,537, (e), (g), (k) and (l) are
  `UNSUPPORTED_FORMAT`, (f), (i) and (m) are `CONTENT_UNAVAILABLE`, (h) gives
  the text with the image never decoded, (j) gives the text, (n) is
  `LIMIT_EXCEEDED` with no more than the remaining B decoded, and (o) and (p)
  give the text at B and are `LIMIT_EXCEEDED` at B + 1, the chained case at its
  ASCII stage with no inflate run. Verified by: `BR-414 AC-04 stream decoding`.
- **AC-05** (BR-415) — Given a three-page file with `/OpenAction` JavaScript, a
  link annotation with a URI action, `/AcroForm`, `/Names /EmbeddedFiles`,
  `/Outlines`, `/StructTreeRoot`, `/Metadata`, a `MediaBox` and `Resources`
  inherited from the root Pages node, a page 2 with no `/Contents`, and a Type0
  font with `/Encoding /UniJIS-UCS2-H` on page 3, When pages `[1, 2]` are read,
  Then page 1's text returns with `total_pages` 3, the canonical bytes contain
  none of those keys nor `/S /JavaScript`, page 1's font is `/K1`, page 2 has an
  empty content stream, page 3 has empty `Resources` and content, and reading
  page `[3]` is `UNSUPPORTED_FORMAT`; given (b) a two-page file whose page 2
  `/Resources` is `99 0 R`, an object no section lists, When page `[1]` is read,
  Then page 1's text returns; given (c) a page that draws a Form selecting `/F2`
  with no text-show and then shows text with `/F1`, When page 1 is read, Then
  its text returns and the canonical bytes hold one font, named `/K1`, and no
  `/K2`. Verified by: `BR-415 AC-05 canonical projection`, `BR-415 AC-05
  canonical projection (b) unread resources of a page not selected`, `BR-415
  AC-05 canonical projection (c) a font selected only in a text-free Form`.
- **AC-06** (BR-416) — Given pages with (a) every dropped operator family
  between text objects, (b) `Tf` and `Tc` before `BT` and a second `BT` that
  shows text without `Tf`, (c) a text-show with no font set, (d) `gs` naming an
  ExtGState with `/Font`, (e) an unknown operator, (f) a stray `Q` and two
  unclosed `q`, (g) a `Contents` array splitting `BT ... ET` across two streams,
  (h) one content stream shared by pages 1 and 2, (i) 1,024 and 1,025 `Contents`
  references, (j) inline images framed by `/L`, by `/A85`, by `/AHx`, by size
  with no filter (S29), and by one `/Fl` inflate, (k) an inline image with
  `/F /DCT` and no `/L`, (l) an inline image with `/F /Fl` and `/DP`, (m) an
  inline image whose computed size overruns the content, (n) 32 and 33 inline
  dictionary pairs, (o) `Do` inside `BT`, (p) a font name with bytes outside
  0x21–0x7E, (q) a Flate inline image with `W` and `H` 65,536, `BPC` 16 and
  `/CMYK` (computed size 2^35 bytes) whose data inflates to more than the
  remaining B, (r) a Flate inline image whose data inflates to one byte more
  than its computed size, below the remaining B, (s) an unfiltered image mask
  with `/IM true` and no `/BPC`, framed by size, (t) an unfiltered `/G` image
  with `BPC` 1, `H` 1 and `W` 65,536 and 65,537, (u) `/A85` data holding `>`
  before its `~>`, (v) a stream of L bytes of dropped operators referenced 1,024
  times by the `Contents` array of each of 10 selected pages, with 10,240 × L
  plus the file's other decoded bytes at B and at B + 1, (w) `q` inside `BT`,
  `BT` inside `BT`, `Td` outside `BT`/`ET` and `ET` outside a text object, each
  on its own page, (x) `Tf` sizes −100,000, −12, −0.5, 0.001, 0.5 and 100,000,
  each showing `Hello modern world`, `T*`, `second line here`, `T*` and `end`
  with `TL` 1.2 times the absolute size from a point where the text fits its
  page (`MediaBox [-1000000 -1000000 1000000 1000000]` at ±100,000), and the
  same at sizes 0, 100,001 and −100,001, When the page(s) are read, Then (a),
  (b), (f), (g), (h), (j), (p), (s) and (u) give the text (h for pages `[1, 2]`)
  and the canonical content holds only kept operators, hexadecimal strings and
  `#`-escaped names, (x) at each nonzero size of absolute value at most 100,000
  gives exactly `Hello modern world\nsecond line here\nend`, (c), (m) and (r)
  are `CONTENT_UNAVAILABLE`, (q) is `LIMIT_EXCEEDED` with no more than the
  remaining B inflated, (d), (e), (k), (l), (o), (w) and (x) at 0, 100,001 and
  −100,001 are `UNSUPPORTED_FORMAT`, (i), (n), (t) and (v) give the text then
  `LIMIT_EXCEEDED`, (v) refusing at the page's `Contents` array before its
  content is joined or tokenized (the test observes no tokenizer call for that
  page), each refusal before PDF.js. Verified by:
  `BR-416 AC-06 content projection`.
- **AC-07** (BR-417) — Given (a) a TrueType font in WinAnsiEncoding whose
  `FontFile2` holds random bytes, (b) a Type0 Identity-H font with a
  `CIDFontType2` descendant, both named `/ArialMT`, whose `ToUnicode` maps three
  codes to `ffi`, U+1F600 and `A`, (c) a Type0 font without `ToUnicode`, (d) a
  Type0 font with `/Encoding /UniJIS-UCS2-H`, (e) a Type3 font with `FontMatrix
  [0.001 0 0 0.001 0 0]`, `/Differences [1 /gid883]` and a `ToUnicode` mapping
  code 1 to U+1F600, whose `CharProcs` and `Resources` reference absent objects,
  (e2) Type3 fonts with `FontMatrix [0.001 0.001 0 0.001 0 0]`, with `FontMatrix
  [-0.001 0 0 0.001 0 0]`, and with a width of 1,000,001 under `FontMatrix
  [0.001 0 0 0.001 0 0]`, (f) a CMap with `usecmap`, (g) CMaps of 65,536 and
  65,537 entries, (h) destinations of 64 and 66 bytes, (i) 128 and 129 distinct
  fonts, (j) a Type0 font whose `ToUnicode` misses one shown code, (k)
  `/ToUnicode /Identity-H`, (l) a `bfrange` with an array one element short, (m)
  a code mapped by two entries, (n) CMaps mapping 262,144 and 262,145 codes in
  total, (o) `Widths` of 256 and 257 numbers, (p) a descendant `W` of 65,536 and
  65,537 numbers, (q) a descendant without `FontDescriptor`, (r) a `Flags` value
  that is a string, (s) a nonembedded `TrueType` font named `/Symbol` with
  `WinAnsiEncoding` and `Widths`, showing `Hello`, (t) a nonembedded `Courier`
  without `Widths`, (u) a Type3 font without `Widths`, (v) CMaps of 256
  `bfrange` entries of 256 codes each (65,536 codes), alone and followed by one
  `bfchar` entry for a code already mapped, (w) a CMap of 65,536 `<00> <FF>
  <0041>` entries, (x) one `ToUnicode` stream assigning 65,536 codes shared by
  five fonts shown on the page, (y) descendant `W` arrays `[0 65534 500 65535
  [500]]` (65,536 CIDs) and `[0 65534 500 65535 [500 500]]`, (z) a descendant
  `W` of 21,845 `0 65535 500` triples, When page 1 is read, Then (a), (b), (e),
  (m), (s), (t) and (x) give their text (`ffi😀A` for (b), `😀` for (e), the last
  entry for (m), `Hello` for (s)) and the canonical bytes hold no font program,
  no source CMap, no `CharProcs`, `/BaseFont /K1` and `/FontName /K1` for (b),
  `/Subtype /Type1 /BaseFont /K1` for (e), `/BaseFont /K1` for (s) and
  `/BaseFont /Courier` for (t), (c), (d), (e2), (f), (j) and (k) are
  `UNSUPPORTED_FORMAT`, (l), (q), (r) and (u) are `CONTENT_UNAVAILABLE`, and
  (g), (h), (i), (n), (o), (p), (v) and (y) give the text then `LIMIT_EXCEEDED`,
  and (w) and (z) are `LIMIT_EXCEEDED`, (w) at its 257th entry. Verified by:
  `BR-417 AC-07 fonts`.
- **AC-08** (BR-418) — Given a `ToUnicode` font whose largest destination is 48
  UTF-8 bytes (`m` 16) and a page repeating one string so that the sum of U is
  exactly B and B + 1; a Differences font whose names include `u1F600` (D 4, `m`
  2 here) at the same two sums; a Form holding that string drawn so that the sum
  of U is B and B + 1; strings of 4,096 and 4,097 bytes; and pages whose sum of
  I is 65,536 and 65,537, once with a simple font and once with a Type0 font
  whose two-byte codes each count 1 in S, When the page is read, Then each first
  case gives its text and each second case is `LIMIT_EXCEEDED` before PDF.js;
  and the exact-pin dependency stress of `TestBR114_pdf_producer_admission`
  passes for Type0/`ToUnicode`, Differences, Type3 and Form-inlined text, with
  `Tf` sizes −12, 0.5 and 100,000 among the cases, with produced bytes and items
  never above the admitted U and I. Verified by: `BR-418 AC-08 producer
  admission`, `TestBR114_pdf_producer_admission`.
- **AC-09** (BR-114 v2) — Given (a) a well-formed file with `/Encrypt`,
  (b) a `%PDF-2.0` file, (c) `%PDF-2.1`, (d) a cross-reference offset one
  byte off, (e) bytes after the last `%%EOF`, (f) `%PDF-1.7` followed by a
  space instead of an end of line, (g) a file with an unknown operator on
  page 1 and a `/Prev` cycle, (h) a file whose first selected page uses
  an `LZWDecode` content stream and whose second selected page needs 129
  fonts, When the page(s) are read, Then (a), (c) and (f) are
  `UNSUPPORTED_FORMAT`, (b) gives the text, (d) and (e) are
  `CONTENT_UNAVAILABLE`, (g) is `CONTENT_UNAVAILABLE` (the chain is checked
  first) and (h), read as pages `[1, 2]`, is `UNSUPPORTED_FORMAT` (page 1
  first), each refusal before PDF.js. Verified by: `BR-114 v2 AC-09 error
  classification`.
- **AC-10** (BR-114 v2, BR-115, BR-117, BR-118, BR-122) — Given the
  existing extraction suites (`tests/read-*.test.ts`), When `make check`
  runs, Then every test passes; a test that asserted a refusal of a feature
  F-034 admits (object or cross-reference streams, content arrays and reuse,
  extra keys, other fonts or operators, Forms, inline images) is rewritten
  to assert the BR-114 v2 outcome and names BR-114 v2, and no test is
  removed. Verified by: `make check`.
- **AC-11** (BR-419, BR-418) — Given (a) S21–S25, (b) a Form without
  `/Resources` whose caller is a Form with a Font `/F1`, (c) a Form whose own
  `/F1` differs from the page's `/F1` (S22), (d) a text-free Form nested 8 deep
  and Forms with text nested 8 and 9 deep, (e) a Form cycle A→B→A, (f) 256 and
  257 distinct Forms, (g) a Form drawn 4,096 and 4,097 times through nested
  `Do`s, (h) Forms with a `/Matrix` of five numbers and with one entry
  1,000,001, (i) an XObject with `/Subtype /Foo`, (j) a Form ending inside `BT`,
  (k) a Form of 1,000 `0 Tc` operators drawn 4,096 times through nested `Do`s,
  (l) a page holding 30 nested `q` that draws a Form with one, and then with
  two, `q` of its own, (m) a Form that shows text before its own `Tf`, drawn
  once under a WinAnsi Type 1 font and once under a Type0 font whose `ToUnicode`
  maps its codes, (n) a Form of L bytes of dropped operators and one `Tj`, drawn
  through nested `Do`s so that the decoded bytes its executions use, with the
  file's other decoded bytes, are B and B + 1, (o) a page that draws a text-free
  Form of `q Q` repeated 2,000,000 times and then shows `A`, (p) a page that
  sets `/F1` and draws a Form of 32,766 `0 Tc` followed by `BT (a) Tj ET`, and
  the same with 40,000 `0 Tc`, When page 1 is read, Then (a) gives the golden
  strings of AC-01 for S21–S25, (a), (b) and (c) give the text with the
  canonical content holding `q`, the `/Matrix` as `cm` and `Q` around each
  inlined Form and one canonical name per font object, (d) gives the text at 8
  and `LIMIT_EXCEEDED` at 9 with no output for the text-free Form, (f), (g) and
  (n) give the text then `LIMIT_EXCEEDED` ((n) at the `Do` that passes B, before
  that execution's tokens), (e) and (j) are `CONTENT_UNAVAILABLE`, (h) and (i)
  are `UNSUPPORTED_FORMAT`, (k) is `LIMIT_EXCEEDED` at the token whose operator
  makes the sum of I pass 65,536, with no token emitted after it (read through
  the emitted-token count the test observes), (l) gives the text with one `q`
  and is `UNSUPPORTED_FORMAT` with two, (o) gives `A` with at most 32,769 of the
  Form's tokens held back and its projection not kept, (m) gives both texts with
  the Form's codes in the simple font's canonical `/Differences`, and (p) is
  `LIMIT_EXCEEDED` with the same 32,768 tokens emitted for both counts, each
  refusal before PDF.js. Verified by: `BR-419 AC-11 Form inlining`.
- **AC-12** (BR-420) — Given (a) S26, (b) a Type1 font with `/Differences`
  mapping codes below 0x20, (c) nonembedded Helvetica with no `/Encoding`, (d) a
  symbolic TrueType font with a `FontFile2`, no `/Encoding` and no `ToUnicode`,
  (e) a font whose `/Encoding` is `/Foo` while a `ToUnicode` maps every shown
  code, (f) `/Differences` of 256 and 257 codes, (g) glyph names of 31 and 32
  bytes, (h) a cleartext `/Length1` of 65,536 and 65,537, (i) a cleartext whose
  `/Encoding` array uses another procedure than the admitted loop, (j) a WinAnsi
  font showing code 0x01, which has no glyph in the table (0x81 is a bullet in
  PDF.js), with no `ToUnicode`, (k) a `Symbol` font with no `/Encoding` and no
  `ToUnicode`, (l) an equality test of the four base tables against the pinned
  PDF.js tables, (m) a pdfTeX-style `Type1` font with a `FontFile` whose
  `/Length1` is 70,000, full `/Differences` for its shown codes and no
  `/BaseEncoding`, (n) a cleartext that puts code 65 twice, (o) a cleartext `10
  array` that puts code 12, (p) a `FontFile` that inflates to fewer than
  `/Length1` bytes, (q) a nonembedded `Symbol` font with `/Differences` naming
  `/H`, `/alpha` and `/beta` for its shown codes, (r) a nonembedded `TrueType`
  font whose `BaseFont` is `/#CB#CE#CC#E5` with `WinAnsiEncoding` and a
  `FontDescriptor` whose `FontName` is `/#B7#C2#CB#CE`, showing `Hi`, (s)
  `/Differences` naming `/G80`, `/c129`, `/uni0082` and `/g0083` at codes
  0x80–0x83 under `/BaseEncoding /WinAnsiEncoding`, and the same with no
  `/BaseEncoding`, (t) a `Type1` font whose `FontFile` has `/DecodeParms` and a
  shown code that needs its built-in encoding, (u) shown codes named `/g17`,
  `/Foo`, `/G00` and `/cAB`, each in its own file, (v) a `Type1` font whose
  `FontFile` has `/Length1` 1,000 and Flate data that inflates to 2^30 bytes,
  with a shown code that needs its built-in encoding, (w) a Type3 font with no
  `/BaseEncoding` and no `ToUnicode` showing a code named `/gid883`, (x) a
  `Type1` font whose `FontFile` has `/Length1` 1,000 and Flate data that
  inflates to 20,000 bytes, so that its inflate produces one 16,384-byte chunk
  (`/Length1` and an overshoot of 15,384 bytes), with a shown code that needs
  its built-in encoding, and (y) the same font with Flate data that inflates to
  exactly 1,000 bytes, each with those produced bytes and everything else the
  file decodes at exactly B and at B + 1, (z) a cleartext `dup 72 /<name> put`
  group whose name has 300 bytes, and (aa) a cleartext `dup 72 (<string>) put`
  group whose string has 5,000 bytes, When page 1 is read, Then (a), (b), (c),
  (m), (q), (r), (s) and (v) give their text, (a) with no `/BaseEncoding` in the
  canonical font, (c) with `/BaseFont /Helvetica`, (m) without its program being
  read, (q) as `Hαβ` with `/BaseFont /K1`, (r) as `Hi` with `/BaseFont /K1` and
  `/FontName /K1`, (s) as `€•‚ƒ` with `/BaseEncoding /WinAnsiEncoding` and as
  U+0080–U+0083 with no `/BaseEncoding`, (v) with at most 1,000 + 16,383 bytes
  inflated, (x) and (y) give the text at B and are `LIMIT_EXCEEDED` at B + 1,
  (x) counting all 16,384 produced bytes, (n) gives the text of the last group,
  the canonical font carrying no `/BaseEncoding`, every shown code in
  `/Differences` and `Flags` with Nonsymbolic set and Symbolic clear, (d), (e),
  (i), (j), (k), (o), (t), (u), (w) and (aa) are `UNSUPPORTED_FORMAT`, (p) is
  `CONTENT_UNAVAILABLE`, (f), (g) and (h) give the text then `LIMIT_EXCEEDED`,
  (z) is `LIMIT_EXCEEDED`, and (l) holds. Verified by: `BR-420 AC-12 simple font
  encoding`.
- **AC-13** (BR-412–BR-420) — Given a valid file at each ceiling of the table
  "Ceilings added by F-034" not exercised by AC-02–AC-12 (at least the
  4,096-pair `/Index`, the 4,096-object object stream, the 32 inline dictionary
  pairs, the 256 built-in encoding groups, the 127-byte `BaseFont` and the
  64-byte `CIDSystemInfo` strings), and the same file one unit over, When page 1
  is read, Then the first gives the text and the second is `LIMIT_EXCEEDED`
  before PDF.js. Verified by: `BR-412 AC-13 ceilings at and over`.

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
  the reading stays deterministic. Hybrid sections follow ISO 32000-1
  §7.5.8.4: a hybrid file's table may list objects stored in object streams
  as free so that older readers skip them, and the `/XRefStm` gives them;
  a free table entry therefore never hides an in-use `/XRefStm` entry of
  the same section. Microsoft Word's "Save as PDF" output is publicly
  described as hybrid in this way; this was not checked on a Word file
  here, and the rule follows the standard either way. Rejected: requiring
  the strict F-009 rule that every byte between objects is whitespace
  (incremental files hold superseded objects); repair (PDF.js's repair
  interprets damaged files in ways the preflight cannot bound).
- **D-3 — Decode only what is needed (BR-414).** Images and font programs carry
  DCT, JBIG2, JPX or exotic filters that text never needs; framing them without
  decoding removes their decoder surface and their budget. FlateDecode with PNG
  predictors covers the cross-reference streams of every PDF 1.5+ generator and
  the content streams of almost all. ReportLab writes `[/ASCII85Decode
  /FlateDecode]` on every stream by default (Measurement 3), so both ASCII
  filters are admitted alone or before FlateDecode; each decoder is a few lines
  with no state beyond one group, and its output counts against B. Rejected: LZW
  and RunLength (rare on content and CMaps; each adds a decoder); other filter
  orders (no generator seen); TIFF predictor 2 (not used on these streams by
  common generators); ASCII filters on a Type 1 program (none seen; keeps the
  program path to one inflate).
- **D-4 — Inline Forms (BR-419; replaces v1's "Forms that show text refuse").**
  Spec review 1 showed text Forms in OCR layers, overlays, imposition, LaTeX
  figures and browser output (S21–S25); the owner chose to widen (option A).
  Inlining keeps PDF.js on one flat content stream per page, so every execution
  is visible to the static bound: the canonical stream holds each execution's
  tokens, BR-418 counts them, and the 4,096-execution ceiling stops exponential
  nesting before any output is built. Canonical font names solve the name clash
  of S22 and the inherited-font case of a Form that uses its caller's font;
  shown codes and `m` are taken per execution with the font in effect, so that
  case is counted under every font it is drawn with. The F-009 limit of 32
  nested `q` levels is counted on the canonical stream, wrappers and inlined
  Forms' `q`s included, because that stream is what PDF.js executes: a count per
  source stream would let 8 nested Forms reach about 8 × 33 levels in the stream
  PDF.js runs. A `/Matrix` becomes a `cm` operand, so it takes the `cm` check
  and its code. Rejected: emitting Forms as XObjects for PDF.js (PDF.js would
  execute them again per `Do` outside the preflight's count, and their resources
  would need a second projection); dropping text Forms silently (a page could
  return `NO_EXTRACTABLE_TEXT` or miss text with no sign); refusing them (v1;
  leaves the S21–S25 families unreadable).
- **D-5 — Fonts without programs (BR-417, BR-420).** Measurement finding 3 shows
  PDF.js extracts text from the encoding and `ToUnicode` without the program.
  Not parsing programs removes the TrueType/CFF parser, the largest attack
  surface, from untrusted input. Finding 5 shows that dropping the program
  changes PDF.js's choice of base encoding, so the projection resolves each
  shown code itself by the PDF rules, emits every shown code that `ToUnicode`
  does not map in `/Differences` under a glyph name PDF.js maps, keeps the
  source base encoding name only when PDF.js honours it (`WinAnsiEncoding`,
  `MacRomanEncoding`, `MacExpertEncoding`; it reads `Gxx`-style names at their
  own code through that base, finding 8), sets Nonsymbolic `Flags`, and refuses
  a shown code whose mapping can only come from the program or whose name PDF.js
  cannot map, as for Type0. Fonts are emitted under canonical names (finding 7):
  PDF.js reads source names as hints, so a Type0 font named `ArialMT` loses all
  but the first code point of each `ToUnicode` destination, a nonembedded
  `Symbol` reads Latin codes as Greek, and ten GBK names become composite fonts;
  a canonical name removes every such hint, and with it the symbol-name and GBK
  rules of the earlier draft. Only the 12 standard Latin names are kept, because
  PDF.js uses their standard metrics when `Widths` is absent. Type3 fonts are
  projected as program-less simple fonts with their widths scaled by
  `FontMatrix` (finding 9): text never needs their glyph procedures, and the
  projection gave the raw text on the LibreOffice and cairo shapes. Type0 needs
  `ToUnicode` for every shown code because, without the program, Identity codes
  have no text meaning. Rejected: passing font programs (parser surface,
  memory); predefined CMaps (need external CMap data, refused by BR-122);
  letting PDF.js fall back on `Flags` (S26 measured wrong text); keeping source
  names with a list of names PDF.js treats specially (version-dependent and
  open-ended: the Type0 fallback list was not in the earlier list); reading
  Type3 `CharProcs` (a content interpreter per glyph for no text).
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
  `CONTENT_UNAVAILABLE` misled users (finding 2). Each failing check has one
  class (ceiling, unsupported, inconsistent), and the first failing check
  in a fixed processing order decides, so a file with several defects has
  one deterministic code and the work done before a refusal is bounded by
  the checks already passed. No new code or text: the fallback to
  `kdrive_download` is documented instead (D-9). Rejected: a global ranking
  of classes (v1; forces every check to run before refusing, including on
  pages and fonts a ceiling has already ruled out).
- **D-9 — Document the rest.** README and `docs/development.md` list the
  admitted container, filters, fonts and operators, the refusals of
  "Out of scope", and say that a refused PDF can be fetched with
  `kdrive_download`. Rejected: a hint in the error text (changes fixed
  error strings, BR-120) or in the tool description (BR-060).
- **D-10 — Inline images skipped by a computed length (BR-416).** ReportLab and
  Ghostscript draw small images inline (S27, S28). The image is never needed,
  but its data must be skipped without reading it as operators. The length is
  taken from `/L`, from the ASCII filter's end marker, from the raw size of
  unfiltered data, or from the one inflate a lone Flate filter needs; otherwise
  the page refuses. That inflate is capped by the smaller of the computed size
  and the remaining B, because the computed size alone reaches 2^35 bytes and
  would let a small image inflate past B; it runs without
  `rejectGarbageAfterEnd`, since the rest of the content follows the data, and
  the data length is the input the inflate consumed (on Node 26,
  `inflateSync(input, { info: true })` reports it as `engine.bytesWritten`;
  measured 13 of 43 input bytes for a 13-byte zlib stream followed by content).
  Rejected: PDF.js's heuristic search for `EI` (S29 holds `EI Q` inside the
  data; a search-based end differs between readers and is a smuggling path);
  refusing all inline images (v1).
- **D-11 — Built-in Type 1 encodings from the cleartext only (BR-420).**
  pdfLaTeX's default Computer Modern fonts carry their only mapping in the
  program (S26). The built-in encoding lives in the program's cleartext part,
  plain PostScript tokens before `eexec`, so the projection reads that part
  alone, with an asynchronous inflate destroyed once `/Length1` bytes are held
  (Node 26 has no synchronous inflate that stops early; the overshoot is at most
  one 16 KiB chunk and counts against B), under a 64 KiB bound with a fixed
  grammar, and only when a shown code has no other mapping (pdfTeX fonts with a
  full `/Differences` never need it) and emits the result as `/Differences`; the
  encrypted part, the charstrings and the program itself never reach the parser
  or PDF.js. Rejected: keeping the program for that case (puts the Type 1 parser
  back on untrusted input for every LaTeX file); documenting a residual (LaTeX
  body text is the most common case in the review's list); CFF (`FontFile3`)
  built-in encodings (binary parser; refused, residual).

- **D-12 — Every use of decoded content is paid (BR-416, BR-419).** The decision
  pass showed that a `Contents` array naming one decoded stream 1,024 times, on
  each of 10 selected pages, made the preflight tokenize about 10,240 times that
  stream within B, since dropped operators emit no canonical token for BR-418 to
  count (about 160 GiB for a stream near 16 MiB). Each `Contents` reference and
  each Form execution therefore counts its stream's decoded length against B,
  before the content is joined or tokenized, while the decode and tokenization
  stay cached. Rejected: counting tokens instead (dropped operators would still
  cost nothing); refusing repeated references (overlay tools share streams
  between pages, AC-06 (h)).
- **D-13 — Text objects and `Tf` (BR-416).** `BT` inside a text object, text
  operators outside one and `q`, `Q` or `cm` inside one keep the F-009 refusal:
  ISO 32000-1 §8.2 forbids them, none of the surveyed generators writes them,
  and PDF.js runs them with rules of its own (its `q` also saves the text
  matrix) that the projection would have to model. The F-009 `Tf` size range
  1–512 is replaced by a measured one, a nonzero size of absolute value at most
  100,000. No bound of F-009 or F-034 depends on the size, since U and I count
  codes, bytes and operators, and within the range the projection gives the
  source text (Measurement 3: every nonzero size up to ±200,000, 0.0001
  included, gave `Hello modern world\nsecond line here\nend`). Size 0 drops
  every line end PDF.js reports, and from 250,000 a line of three words
  overflows the largest page the 1,000,000 numeric check admits, so PDF.js
  leaves out its last glyphs; 100,000 stays a factor of two below the first
  loss. Text placed outside its page is left out by PDF.js at any size (a
  120-character line at size 12 on a Letter page is cut at its edge), on the
  source as on the projection, and is not a projection loss. PDF.js also
  joins lines that overlap at any size, tiny sizes included (a `T*` advance
  of 1.2 times a size near the numeral limit vanishes in float64 rounding);
  this is the same residual on the source and is accepted. Rejected: keeping
  1–512 (refuses negative and fractional sizes measured exact); the numeric
  check alone (admits 0 and sizes whose text fits no admissible page, losing
  text silently); refusing text outside the page box (needs a model of PDF.js's
  glyph geometry); following PDF.js for nested text objects (state rules outside
  ISO, unmeasured).

## Open questions

None.

## Stress-test

Spec review 1 (`4-spec-review-1-reviewer`, changes):

1. major (scope: Forms, inline images, Computer Modern) — retained; owner
   option A (2026-11-14). Measurement 2 adds S21–S29 with before and after
   results; BR-419 inlines Forms with the bounds and resource scope asked
   (D-4); BR-416 skips inline images of computable length and refuses the
   rest (D-10); BR-420 resolves simple-font encodings, reading Computer
   Modern's built-in encoding from the cleartext part only, measured to
   restore S26's text exactly (D-11). Residuals: CFF built-in encodings,
   symbolic TrueType without mapping, `Symbol`/`ZapfDingbats` without
   mapping, inline images of unknown length.
2. major (BR-412 xref stream keys) — retained: direct keys, `W[1]` ≥ 1,
   `/Index` ascending, non-overlapping, at most 4,096 pairs and total count
   at most `/Size`, zero-width defaults; AC-02 (g)–(o).
3. major (hybrid free entries) — retained: a free table entry never hides
   an in-use `/XRefStm` entry of the same section (ISO 32000-1 §7.5.8.4,
   D-2; Word not verified here); AC-02 (b), (b2).
4. major (BR-417/418 encodings) — retained: BR-420 resolves every shown
   code, emits `/BaseEncoding /WinAnsiEncoding` and explicit
   `/Differences`, rewrites `Flags`, refuses codes whose mapping depends on
   the program, validates `/Encoding` always; BR-417 bounds and type-checks
   `W`, `DW`, `CIDSystemInfo` and `FontDescriptor` and keeps the
   descendant's `FontDescriptor`; BR-418 pins D from the canonical CMap and
   the glyph-name forms PDF.js 6.5.438 reads (`u` + 5 or 6 hex digits is
   the only form above U+FFFF).
5. major (ceiling ACs) — retained: AC-02–AC-12 give at and over rows for
   their ceilings, AC-13 covers the rest; `/W` 8 accepted, Columns 65,536
   with Colors 4 accepted, strings of 4,096 and 4,097 bytes.
6. minor (error order, one defect per sample, header) — retained:
   processing order in BR-114 v2 and AC-09 (g), (h); AC preamble; "at byte
   0 followed by an end of line" kept and synchronized into BR-114.md.
7. minor (BR-416 state and scope) — retained: text state persists across
   `BT`/`ET` and is kept outside them, no `/Contents` gives an empty stream,
   resource scope for `Do`, `gs` and `Tf` in Forms (BR-419), "shows text"
   defined by the four text-show operators, O counted on the canonical
   stream, kept tokens rebuilt by the canonical serializer.
8. minor (object streams, CMaps, AC-04) — retained: header parsed once,
   offsets strictly increasing, `/N` 1–4,096, distinct-object count;
   `bfrange` array length, last duplicate wins, `/ToUnicode` as a name
   refuses; AC-04 (a) counts inflated bytes against B.
9. minor (test names) — retained: ACs use `BR-NNN [vN] AC-NN ...` names as
   in F-033; the existing `TestBR114_pdf_producer_admission` keeps its name.

Spec review 2 (`4-spec-review-2-reviewer`, changes):

1. major (BR-416, BR-414: inline Flate bomb) — retained: the inline inflate
   is capped by min(computed size, remaining B); passing B is
   `LIMIT_EXCEEDED`, passing the computed size `CONTENT_UNAVAILABLE`; no
   `rejectGarbageAfterEnd`; the data length is the input consumed, verified
   on Node 26.13.0 in the dev container (`engine.bytesWritten` 13 for a
   13-byte zlib stream followed by 30 content bytes; a cap below the output
   gives `ERR_BUFFER_TOO_LARGE`; a 2^24-byte bomb stops at a 1 MiB cap).
   AC-06 (q), (r); ceiling table row; D-10.
2. major (when sums are checked) — retained: BR-418 checks canonical bytes,
   the 4,096-byte string, S, O, I and U with `m = 1` at each emitted token
   and refuses at the crossing token; only the final weighted U stays in
   the totals step; BR-114 v2 order updated. AC-11 (k).
3. minor (ASCII end markers, `BPC` of masks) — retained: `>` for `/AHx`,
   `~>` for `/A85`; `BPC` 1 when absent with `/IM true`. AC-06 (s), (u).
4. minor (ceiling codes) — retained: passing any bound of the ceiling table
   is `LIMIT_EXCEEDED`, stated in the table preamble, BR-114 v2 and each BR
   text (`W`/`H`, `/Differences` codes, glyph names, cleartext groups and
   names, `/Length1`, BR-417 bounds); `BaseFont` and `CIDSystemInfo` string
   bounds added to the table and AC-13; AC-06 (t).
5. minor (BR-419 `/Matrix`, `q` depth) — retained: `/Matrix` takes the
   F-009 `cm` check (finite, absolute value at most 1,000,000) and its code,
   `UNSUPPORTED_FORMAT` (`src/extraction-pdf-profile.ts`, `finite`); the
   32-level `q` limit is counted per canonical stream, Form wrappers and
   Forms' own `q`s included, since PDF.js executes that stream (D-4); the
   F-009 operand checks are declared not ceilings and keep their code.
   AC-11 (h), (l).
6. minor (BR-420 cleartext) — retained: the cleartext is read only at the
   first shown code that `ToUnicode` and `/Differences` leave unmapped;
   streaming inflate up to `/Length1`, shorter output `CONTENT_UNAVAILABLE`;
   a repeated `dup` code takes the last group; codes below `n`, `n` 1–256.
   AC-12 (m)–(p).
7. minor (per-execution codes) — retained: shown codes and `m` are taken
   per execution with the font in effect (BR-418, BR-419, BR-420). AC-11 (m).
8. minor (PDF.js base encodings) — retained and measured with PDF.js
   6.5.438 in the dev container on the canonical shape (`WinAnsiEncoding`
   base plus `/Differences`): nonembedded `Symbol`, `ZapfDingbats` and
   `Wingdings` gave the same text as Helvetica; `/#CB#CE#CC#E5` gave no
   text, `/#B7#41` and a subset-prefixed GBK name gave the text. D-5 and
   the hostile-input text reworded; BR-420 refuses the ten GBK names.
   AC-12 (q), (r).
9. minor (base branch, line width) — retained: base `feat/4-pdf-profile`;
   prose rewrapped to 80 columns (tables excepted).

Spec review 3 (`4-spec-review-3-reviewer`, changes, all minor):

1. minor (GBK check bypass through `FontName`) — retained: PDF.js 6.5.438
   uses the `FontDescriptor` `/FontName` when it differs from `BaseFont`, so
   the projection emits `FontName` equal to the projected `BaseFont` (BR-417)
   and the ten-name GBK check applies to that projected name (BR-420).
   AC-12 (s).
2. minor (inline Flate ceiling) — retained: the ceiling row is the remaining
   B; output over the computed size is a consistency check giving
   `CONTENT_UNAVAILABLE`, stated in BR-114 v2, BR-416 and the table
   preamble. AC-06 (r).
3. minor (object stream `/Length` row) — retained: the row is dropped; BR-413
   states that an indirect `/Length` needing more than one object stream, or
   an object stream whose own `/Length` is not direct or a type 1 integer
   object, refuses as `CONTENT_UNAVAILABLE`. AC-03 (f), (l).
4. minor (`Tf` size) — retained: `Tf` keeps the F-009 size check, 1–512
   (`src/extraction-pdf-profile.ts`), `UNSUPPORTED_FORMAT`.
5. minor (Type 1 `/DecodeParms`) — retained: refuses as `UNSUPPORTED_FORMAT`
   (BR-414). AC-12 (t).
6. minor (line width, symbol font names) — retained: ADR-012 rewrapped to 80
   columns; `Wingdings-Bold` and `Wingdings-Regular` added to the names whose
   `WinAnsiEncoding` base PDF.js drops (hostile input, D-5).

Spec decision pass (`4-spec-decision-1-fable`, changes):

1. major (content-stream reuse amplification) — retained: each `Contents`
   reference on each selected page and each Form execution counts its stream's
   decoded length against B, before joining or tokenizing; the decode and
   tokenization stay cached (BR-414, BR-416, BR-419, D-12). AC-06 (v), AC-11
   (n).
2. major (source font names reach PDF.js) — retained and measured (Measurement
   3): `BaseFont` and `FontName` are the canonical `K<n>` for every font except
   simple fonts whose source name is one of the 12 standard Latin names, kept
   for their metrics; `Symbol` and `ZapfDingbats` are renamed because PDF.js
   changes their encoding. The GBK and symbol-name rules are dropped as moot,
   measured: the GBK-named font renamed `K1` gives its WinAnsi text, a `Symbol`
   font renamed `K1` gives its `/Differences` text. BR-415, BR-417, BR-420, D-5.
   AC-07 (b), (s), (t); AC-12 (q), (r). Supersedes the GBK and symbol-name
   outcomes of spec review 2 item 8 and spec review 3 items 1 and 6.
3. major (coverage) — retained, orchestrator decision in line with owner option
   A: `/ASCII85Decode` and `/ASCIIHexDecode`, alone or before `/FlateDecode`, on
   every needed stream except a Type 1 program (BR-414, D-3); Type3 fonts
   projected as program-less simple fonts, widths scaled by `FontMatrix`,
   `CharProcs` and `Resources` never read (BR-417 (c), BR-420, D-5), measured
   equal to raw PDF.js on the LibreOffice and cairo shapes. S30–S33 are
   synthetic equivalents built by the test helper: the real samples embed
   third-party font subsets and cannot be regenerated in the dev container, so
   they are not committed. AC-01, AC-04 (j)–(n), AC-07 (e), (e2), (u), AC-12
   (w).
4. major (expected text) — retained: (a) AC-01 and AC-11 (a) pin the golden
   strings measured on the projections; S22–S24 give a line feed between their
   two parts where raw PDF.js on the source gives none (Measurement 3;
   Measurement 2 joined items without `hasEOL`); (b) AC-12 (j) uses code 0x01,
   which has no WinAnsi glyph in PDF.js, instead of 0x81, which PDF.js maps to a
   bullet.
5. minor (forced `WinAnsiEncoding` base) — retained and measured: the source
   base encoding name is emitted when PDF.js honours it (`WinAnsiEncoding`,
   `MacRomanEncoding`, `MacExpertEncoding`), none otherwise; a shown code whose
   name PDF.js cannot map (`/g17` returns the raw code) refuses as
   `UNSUPPORTED_FORMAT`, consistent with Type0, `c` names with hexadecimal
   digits included. BR-420. AC-12 (a), (n), (s), (u).
6. minor (Type 1 inflate) — retained and measured on Node 26.13.0: `inflateSync`
   cannot stop early, so the program is inflated with `createInflate`
   (`chunkSize` 16,384) destroyed once `/Length1` bytes are held; the overshoot
   of at most 16,383 bytes counts against B. BR-414, D-11. AC-12 (v).
7. minor (text objects, `Tf`, generations, Type0 I) — retained: `q`/`Q`/`cm`
   inside `BT`, nested `BT` and text operators outside `BT`/`ET` keep the F-009
   and ISO refusal (D-13); the `Tf` range 1–512 has no safety role under the
   projection and is dropped, the numeric operand check kept (measured sizes
   0.5, −12: source text); `n g R` matches the entry's generation and the
   canonical document uses generation 0 (BR-413, BR-415); S, and so I, counts
   Type0 codes rather than bytes (BR-418). AC-03 (m), (n); AC-06 (w), (x);
   AC-08. Supersedes spec review 3 item 4.

Spec review 4 (`4-spec-review-4-reviewer`, changes):

1. major (`Tf` size loses text) — retained, orchestrator decision, measured with
   PDF.js 6.5.438 in the dev container (Measurement 3, finding 10): a nonzero
   size of absolute value at most 100,000 is admitted, 0 and larger sizes refuse
   as `UNSUPPORTED_FORMAT`. Every nonzero size up to ±200,000 (0.0001, ±0.001,
   ±0.5, ±12, ±100,000 included) gave
   `Hello modern world\nsecond line here\nend` and `Hello modern PDF` when the
   text fits its page; size 0 dropped every line end; from 250,000 the
   three-word line no longer fits the largest admissible `MediaBox` and PDF.js
   left out its last glyphs. The reviewer's `Hwend` at 1,000,000 and the losses
   at 100–512 on a Letter page are PDF.js leaving out glyphs outside the page
   box and joining overlapping lines, which it also does at size 12 on a line
   longer than the page, on the source and the projection alike. BR-114 v2,
   BR-416, D-13, Contract details. AC-06 (x) pins ±100,000, −12, −0.5, 0.001 and
   0.5 at the exact string and 0, ±100,001 as `UNSUPPORTED_FORMAT`; AC-08 sizes
   −12, 0.5 and 100,000. ADR-012 does not mention `Tf` and is unchanged.
   Supersedes the `Tf` outcome of the spec decision pass item 7.
2. minor (BR-420 rationale) — retained: the GBK-named simple font is admitted,
   its canonical name removing the hint (D-5, Measurement 3);
   `business-rules/BR-420.md` rationale reworded.
3. minor (limit edge cases) — retained: AC-04 (o), (p) put the output of an
   `/ASCIIHexDecode` or `/ASCII85Decode` stage at B and B + 1, and at B + 1
   before `/FlateDecode` with no inflate run; AC-12 (x), (y) put a Type 1 Flate
   program at B and B + 1, (x) with a 16,384-byte chunk for a `/Length1` of
   1,000 (overshoot 15,384 bytes). BR-414 states that a byte the filter does not
   read or data without its end marker (`>` or `~>`) refuses as
   `CONTENT_UNAVAILABLE` for both ASCII filters; AC-04 (m) adds
   `/ASCIIHexDecode` data holding `G` and data without `>`.
4. minor (CHANGELOG wrap) — retained: the F-034 entry of `CHANGELOG.md`
   rewrapped to 80 columns.

Spec review 5 (`4-spec-review-5-reviewer`, approve; ready to freeze):

- (minor) Lines merging at tiny sizes were not stated in D-13. Retained:
  D-13 states the overlapping-lines residual, tiny sizes included.
- (minor) "above 200,000" overstated the measurement. Retained: "at
  250,000" in Measurement 3, BR-416 and its record.
- (minor) Grammar in BR-114 v2. Retained: fixed in the spec and its record.

Code reviews (4-code-review-1-reviewer, 4-code-decision-1-fable) — v2
amendment:

1. major (`ToUnicode` work not bounded; both reviews) — retained. BR-417 counts
   every code an entry assigns at its assignment (a `bfrange` its range size, a
   `bfchar` 1, repeats included) against 65,536 per CMap and 262,144 per
   invocation, refusing before the range that passes is expanded, and parses
   each `ToUnicode` stream once per invocation, fonts sharing it reusing that
   parse; the ceiling table and Hostile input follow. AC-07 (v) and (w) pin the
   count per assignment, (x) the shared parse. AC-07 (n) builds one stream per
   font, since a shared stream now counts once.
2. major (CIDFont `W` expansion in PDF.js; decision pass 2, contract-level) —
   retained: BR-417 refuses as `LIMIT_EXCEEDED` a `W` whose ranges and arrays
   cover more than 65,536 CIDs (`c1 c2 w` counting c2 − c1 + 1, none when c2 is
   below c1, `c [w …]` its array length). AC-07 (y) at and over, (z) the
   reviewer's 21,845 full-range triples.
3. major (heap; decision pass 3) — retained. (a) BR-419: a Form that emits
   nothing holds back at most one token more than the sum of I can still admit
   (a later text-show refuses at the same token as before), and a projection
   longer than that is not kept but rebuilt at each execution, which already
   pays its decoded length; AC-11 (o) is the reviewer's `q Q` × 2,000,000 Form,
   which gives the page text. (b) BR-412 already merges the chain; Hostile
   input states that sections merge into one table as they are read; AC-02 (p)
   is the reviewer's 31-section shape, counted by table insertions.
4. major (licence notices; review 1 finding 2) — retained, no contract change:
   the PDF.js and Adobe Glyph List notices go into the two table files and
   `NOTICE`.
5. minor (generation ignored on cache hits; both reviews) — retained, no rule
   change (BR-413 already requires `CONTENT_UNAVAILABLE`): AC-03 (o) for an
   indirect `/Length`, (p) for a font selected twice.
6. minor (resources of pages not selected; decision pass 4) — retained: BR-415
   states that a page that is not selected has its `/Resources` neither
   resolved nor type-checked. AC-05 (b).
7. minor (fonts selected only in text-free Forms; review 1 finding 4) —
   retained as a rule rather than a deviation: BR-415 writes only fonts that an
   emitted `Tf` names, numbered without gaps in the order of first emission, so
   "holds exactly" stays true; such fonts are still read and checked and count
   toward the 128 fonts. AC-05 (c).
8. minor (Type 1 cleartext glyph name over the tokenizer limit; review 1
   finding 5) — retained, no rule change (BR-420 already makes a name over 31
   bytes `LIMIT_EXCEEDED`): AC-12 (z).

Code review 2 (4-code-review-2-reviewer, changes):

1. major (Apache-2.0 §4(a): no copy of the licence shipped) — retained, no
   F-034 rule change: `LICENSES/Apache-2.0.txt` holds the Apache License 2.0
   text, verbatim from `pdfjs-dist/LICENSE`, ships in the npm package and the
   runtime image, and `NOTICE` refers to it. `NOTICE` and the two table files
   carry the copyright lines with years: PDF.js "Copyright 2024 Mozilla
   Foundation" and the Adobe Glyph List "Copyright 2002-2019 Adobe
   (http://www.adobe.com/).". BR-173, BR-226 and BR-392 list the file.
2. minor (a tokenizer `LIMIT_EXCEEDED` at the glyph position other than a
   name's) — retained, no rule change (BR-420 makes a malformed cleartext
   `UNSUPPORTED_FORMAT`, only a name over 31 bytes `LIMIT_EXCEEDED`): only a
   token starting with `/` keeps its `LIMIT_EXCEEDED`. AC-12 (aa).
3. minor (the refusal point of a Form's held-back tokens not pinned) —
   retained: AC-11 (p), 32,766 and 40,000 `0 Tc` refusing at the same
   emitted-token count.
4. (commit split) — not retained here: the deviation (tests and fix in one
   commit in code review 1) is recorded on the pull request; code review 2
   keeps its tests and its fix in separate commits.
