---
id: F-034
title: PDF text extraction for common generator output
ticket: "#4"
status: ready-for-freeze
version: 1
---

# F-034 — PDF text extraction for common generator output

Author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-14; revised
after spec reviews 1, 2 and 3 by fresh authors, Claude Opus 5.5 (effort
unknown), 2026-11-14.
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
| S22 | qpdf/pdftk overlay: `Contents` array, stamp page as a Form whose `/F1` is another font than the page's `/F1` | `Hello modern PDF` + `Overlay stamp` | `UNSUPPORTED_FORMAT` | `UNSUPPORTED_FORMAT` (text Form) | same as source |
| S23 | pdfjam/pdfpages 2-up: two page Forms, one with a rotating `/Matrix`, no page Font resource | `Hello modern PDF` + `Second page` | `UNSUPPORTED_FORMAT` | `UNSUPPORTED_FORMAT` (text Form) | same as source |
| S24 | pdfTeX page including a PDF figure Form (`PTEX.*`, `/Group`, `gs`) whose labels sit in a nested Form | `Hello modern PDF` + `Figure label` | `UNSUPPORTED_FORMAT` | `UNSUPPORTED_FORMAT` (text Form) | same as source |
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

## Scope

- **Container.** Cross-reference streams, hybrid files (`/XRefStm`),
  incremental updates and linearized files through a bounded `/Prev` chain;
  object streams; indirect `/Length`; `%PDF-2.0` headers (BR-412, BR-413).
- **Decoding.** Only the streams the projection needs are decoded: page and
  Form content, `ToUnicode` CMaps, object streams, cross-reference streams,
  the cleartext part of a Type 1 font program whose built-in encoding is
  needed, and FlateDecode inline images whose end must be found. Admitted
  filters: none, or FlateDecode (alone or as a one-element array) with PNG
  predictors 10–15 (BR-414).
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
- **Fonts.** Type 1, MMType1 and TrueType simple fonts whose shown codes all
  map through an explicit or determinable encoding or a `ToUnicode` CMap,
  including Type 1 fonts whose only mapping is the built-in encoding of their
  program (read from its cleartext part only); Type0 fonts with Identity-H or
  Identity-V and a `ToUnicode` CMap that maps every shown code (BR-417,
  BR-420).
- **Producer bound.** The F-009 static text-production bound extended to
  mapped fonts and inlined Forms (BR-418).
- **Errors.** Well-formed files outside the profile refuse as
  `UNSUPPORTED_FORMAT`; files inconsistent with their own structure refuse as
  `CONTENT_UNAVAILABLE`; the first failing check in processing order decides
  (BR-114 v2).
- **Docs.** README "Limits" bullet and the `docs/development.md` PDF section:
  what is extracted, what refuses and why, and `kdrive_download` as the
  fallback for a refused file; ADR-012.
- **Tests.** A synthetic corpus helper (`tests/helpers/pdf-corpus.ts`)
  that rebuilds S01–S29 and the hostile samples of the ACs, plus named BR
  tests.

### Out of scope

- Encryption of any kind, including an empty user password (refuses as
  `UNSUPPORTED_FORMAT`).
- Type3 fonts; predefined or embedded CMaps other than Identity-H/V; Type 1
  fonts in `FontFile3` (CFF) or TrueType fonts whose shown codes have no mapping
  outside the program; `Symbol` and `ZapfDingbats` without `/Differences` or
  `ToUnicode` for their shown codes; simple fonts named with one of the ten GBK
  names PDF.js reads as a composite font; `LZWDecode`, `ASCIIHexDecode`,
  `ASCII85Decode`, `RunLengthDecode` and TIFF predictor 2 on a stream the
  projection needs; inline images whose length is neither given nor computable
  (DCT, CCITT, JBIG2, LZW or run-length data without `/L`) (D-3, D-5, D-10,
  D-11).
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
  content tokens in order, where a `Do` of a Form runs that Form's checks at
  that token (BR-419), the first `Tf` that selects a font runs that font's
  checks at that token (BR-417, BR-420), the first shown code that needs a Type
  1 built-in encoding reads it at that token (BR-420), and each emitted
  canonical token runs the running checks of BR-418 at that token; then the
  final weighted U of BR-418. An object, stream or CMap is checked when the step
  that needs it first resolves it. A failing check refuses with `LIMIT_EXCEEDED`
  when it is a declared or computed ceiling of F-009 or F-034, every bound of
  the table "Ceilings added by F-034" included, whatever the wording of the BR
  that states it (the count or size that passes the ceiling fails); the
  computed size of a Flate inline image is a consistency check, not a ceiling,
  and Flate output over it refuses as `CONTENT_UNAVAILABLE` (BR-416); with
  `UNSUPPORTED_FORMAT` when the file is well-formed but uses a feature outside
  the profile (encryption, an unadmitted filter, font, encoding or operator, an
  inline image of unknown length) or fails an F-009 operand check (arity, type,
  the 1,000,000 numeric bound, the 32-level `q` nesting of BR-416), which keeps
  its F-009 code and is not a ceiling; and with `CONTENT_UNAVAILABLE` when the
  file contradicts its own structure (an offset that does not hold the object it
  names, a cycle, a length that overruns its data, a missing required object or
  resource). Verified by: AC-01, AC-09, AC-10.
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
  table. A type 1 object is parsed at its offset as
  `<number> <generation> obj`, one value, an optional stream framed by its
  `/Length`, and `endobj`; its number and generation equal the entry's. A
  type 2 object is read from the object stream named by the entry, which
  is itself a type 1 object with `/Type /ObjStm`, a direct `/N` of 1–4,096
  and a direct `/First`. The header of an object stream is parsed once per
  invocation: `/N` pairs of object number and offset, offsets strictly
  increasing from 0 and each below the decoded length minus `/First`. The
  pair at the entry's index names the same object number; the object is
  the one value between its offset and the next (or the end), has
  generation 0 and is not a stream; `/Extends` is ignored. An indirect
  `/Length` resolves to a nonnegative integer object; resolving it never
  requires framing the stream it measures and opens at most one object
  stream, whose own `/Length` is direct or a type 1 integer object; an
  indirect `/Length` that needs more than one object stream, or an object
  stream whose own `/Length` is neither (a type 2 object, one living inside
  that object stream itself included), refuses as `CONTENT_UNAVAILABLE`. A
  reference to a free, absent or mismatched object in a role the projection
  needs refuses. At most 4,096 distinct objects are resolved per invocation
  (the F-009 indirect-object ceiling); an object resolved again is served
  from the cache and not counted again. Verified by: AC-03.
- **BR-414** — Only the streams BR-412, BR-413, BR-416, BR-417, BR-419 and
  BR-420 need are decoded; any other stream is framed by its `/Length` and never
  decoded, whatever its filter. A needed stream has no filter, or `/FlateDecode`
  given as a name or a one-element array, with optional `/DecodeParms` (a
  dictionary, or a one-element array holding one) whose `/Predictor` is 1 or
  10–15, `/Colors` 1–4, `/BitsPerComponent` 8 and `/Columns` 1–65,536; PNG rows
  are undone with each row's own tag and the predicted data is a whole number of
  rows. Each needed stream is decoded once per invocation and its decoded length
  counts once against B with the F-009 inflate rules (`maxOutputLength` set to
  the remaining B, `rejectGarbageAfterEnd`), with two exceptions. A Flate inline
  image (BR-416) is inflated from the rest of its content stream with
  `maxOutputLength` set to the smaller of its computed size and the remaining B
  and without `rejectGarbageAfterEnd`, since the content after its data is not
  garbage; its data length is the number of input bytes the inflate consumed up
  to the end of the zlib stream. A Type 1 program (BR-420) with `/DecodeParms`
  refuses as `UNSUPPORTED_FORMAT`; one without is inflated by a streaming
  inflate that stops as soon as it has produced `/Length1` bytes and reads no
  further input; a `/Length1` over the remaining B refuses as `LIMIT_EXCEEDED`
  before inflating, a program whose output (or unfiltered data) ends before
  `/Length1` bytes refuses as `CONTENT_UNAVAILABLE`, and the `/Length1` bytes
  count against B. Verified by: AC-04.
- **BR-415** — The canonical document holds exactly: a Catalog with `Type`
  and `Pages`; every Pages node with `Type`, `Kids`, `Count` and `Parent`
  except at the root; every page with `Type`, `Parent`, its `MediaBox`
  (its own, or the nearest inherited one) and `Resources` and `Contents`;
  a trailer with `Size` and `Root`. A selected page's `Resources` holds only
  `Font`, with the fonts BR-417 admits under canonical names `/K1`, `/K2`,
  … numbered in the order of first selection in the invocation (one name
  per indirect font object, or per direct font dictionary at its place,
  whatever resource name or Form selected it), and its
  `Contents` is the one stream BR-416 builds, with no filter. A selected
  page with no `/Contents` gets an empty content stream. A page that is not
  selected gets empty `Resources` and an empty content stream, and its
  content and resources are not read. Every other key, object and stream of
  the source, XObjects included, is left out. The page tree keeps its
  source order and count, so `total_pages` is unchanged. Verified by: AC-05.
- **BR-416** — A selected page's content is its `Contents` stream, or the
  streams of a `Contents` array of at most 1,024 references joined with one line
  feed, tokenized once in order, with the page's `Resources` (own or inherited)
  as resource scope. Kept, with the F-009 operand checks: `q`, `Q`, `cm`, `BT`,
  `ET`, the text state operators `Tf`, `Tc`, `Tw`, `Tz`, `TL`, `Ts` and `Tr`
  (integer 0–7), and inside `BT`/`ET` only `Td`, `TD`, `Tm`, `T*`, `Tj`, `TJ`,
  `'` and `"`. The F-009 limit of 32 nested `q` levels is counted on the
  canonical stream of the page, the `q` that wraps each inlined Form and the
  Forms' own `q`s included (BR-419); the `q` that opens a 33rd level refuses as
  `UNSUPPORTED_FORMAT`. String bytes are not restricted to 0x20–0xFF and `Tf`
  takes a font name of the resource scope and a size of 1–512, the F-009 `Tf`
  size check (another size refuses as `UNSUPPORTED_FORMAT`). Text state is part
  of the graphics state: it persists across `BT`/`ET`, is saved and restored by
  `q`/`Q`, `BT` resets only the text matrices, and text state operators are kept
  inside or outside `BT`/`ET`. A text-show operator with no font set refuses as
  `CONTENT_UNAVAILABLE`. Dropped, operands included: path construction and
  painting, clipping, colour and colour space, line and rendering state, `sh`,
  marked content (`BMC`, `BDC`, `EMC`, `MP`, `DP`), `BX`/`EX`, `gs` (refused
  when the ExtGState it names in the resource scope holds `/Font`), `Do` of an
  Image or PostScript XObject, and inline images whose data is framed as
  follows: after `BI`, at most 32 key/value pairs up to `ID`, with direct values
  only, and one white-space byte; the data length is `/L` (or `/Length`) when
  present, else, when the first filter of `/F` (or `/Filter`) is `/AHx` (or
  `/ASCIIHexDecode`), the bytes up to and including the first `>`, else, when it
  is `/A85` (or `/ASCII85Decode`), the bytes up to and including the first `~>`,
  else, with no filter, the computed size, else, when the only filter is `/Fl`
  (or `/FlateDecode`) with no `/DP` (or `/DecodeParms`), the input bytes that
  one inflate of BR-414 consumes (`maxOutputLength` the smaller of the computed
  size and the remaining B). The computed size is `H` × ceil(`W` × `BPC` ×
  components / 8), where `W` and `H` are 1–65,536, `BPC` is 1, 2, 4, 8 or 16 and
  is 1 when absent with `/IM true`, and components are 1 for `/G`, `/I`, an
  indexed space or `/IM true`, 3 for `/RGB` and 4 for `/CMYK`, long names
  included; a `W` or `H` over 65,536 refuses as `LIMIT_EXCEEDED`. After the data
  come optional white space and `EI` followed by white space, a delimiter or the
  end. An inline image whose length is none of these refuses as
  `UNSUPPORTED_FORMAT`; framing that overruns the content or is not followed by
  `EI` refuses as `CONTENT_UNAVAILABLE`; an inflate whose output passes the
  remaining B refuses as `LIMIT_EXCEEDED`; one whose output passes the computed
  size first, a consistency check and not a ceiling, refuses as
  `CONTENT_UNAVAILABLE`, as does a zlib stream that does not end within the
  content; inflated inline bytes count against B. `Do` of a Form
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
  `CONTENT_UNAVAILABLE`. Every key the projection keeps is type-checked, and a
  wrong type refuses as `CONTENT_UNAVAILABLE`. Admitted: (a) `Type1`, `MMType1`
  or `TrueType` simple fonts whose encoding BR-420 resolves; (b) `Type0` with
  `/Encoding` the name `Identity-H` or `Identity-V`, one `CIDFontType0` or
  `CIDFontType2` descendant with a `FontDescriptor`, and a `ToUnicode` stream
  that maps every code the font's kept strings show (a shown code it does not
  map refuses as `UNSUPPORTED_FORMAT`; a string of odd length shown with it
  refuses as `CONTENT_UNAVAILABLE`). A `ToUnicode` given as a name, such as
  `/Identity-H`, refuses as `UNSUPPORTED_FORMAT`. The projected simple font
  keeps `Type`, `Subtype`, `BaseFont` (a name of at most 127 bytes),
  `FirstChar`, `LastChar` (integers 0–255), `Widths` (at most 256 finite
  numbers), `ToUnicode` and the `Encoding` of BR-420; the projected Type0 font
  keeps `Type`, `Subtype`, `BaseFont`, `Encoding`, `ToUnicode` and one
  descendant with `Type`, `Subtype`, `BaseFont`, `DW` (a finite number), `W` (an
  array of at most 65,536 numbers in total, in the `c [w …]` and `c1 c2 w`
  forms, codes 0–65,535), its `FontDescriptor`, and a `CIDSystemInfo` emitted as
  `<< /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>` after the source
  value is checked (a dictionary with `Registry` and `Ordering` strings of at
  most 64 bytes and an integer `Supplement`). A kept `FontDescriptor` holds
  `Type`, `FontName` (emitted equal to the projected `BaseFont` of the font that
  holds it, whatever its source value, since PDF.js 6.5.438 uses `FontName` when
  it differs from `BaseFont`), `FontBBox` (four finite numbers), `ItalicAngle`,
  `Ascent`, `Descent`, `CapHeight`, `StemV` and `MissingWidth` (finite numbers,
  each optional except `FontName`), and `Flags` set to the source `Flags` with
  the Symbolic flag (value 4) cleared and the Nonsymbolic flag (value 32) set; a
  simple font without a source `FontDescriptor` gets none. `FontFile`,
  `FontFile2`, `FontFile3` and a stream `CIDToGIDMap` are never emitted. A
  `ToUnicode` CMap is parsed with the bounded tokenizer: only code space ranges,
  `bfchar` and `bfrange` entries count; codes are 1 or 2 bytes and keyed by
  their numeric value; a `bfrange` has a low and high code of the same length
  that differ only in the last byte, low not above high, and either one
  destination string, incremented over the range as PDF.js 6.5.438 does, or an
  array whose length equals the range size; destinations are UTF-16BE strings of
  2–64 bytes; when a code is mapped twice the last entry wins; `usecmap` refuses
  as `UNSUPPORTED_FORMAT`; a CMap has at most 65,536 entries and all admitted
  CMaps together map at most 262,144 codes. Each admitted CMap is re-emitted
  canonically as one `bfchar` entry per mapped code in ascending order. Passing
  a bound of this rule (128 fonts, a 127-byte `BaseFont`, 256 `Widths` numbers,
  65,536 `W` numbers, 64-byte `CIDSystemInfo` strings, 64-byte destinations, the
  CMap entry and code counts) refuses as `LIMIT_EXCEEDED`. Every other font
  refuses as `UNSUPPORTED_FORMAT`. Verified by: AC-07.
- **BR-418** — The F-009 text-production admission holds with weighted string
  bytes, counted on the canonical content stream of each selected page, so every
  Form execution counts its strings and operators again: N is the sum over
  text-show strings of the string's bytes times `m` of the font in effect at
  that point of the canonical stream (for a Form that shows text before its own
  `Tf`, the font its caller set, at each execution), where `m = max(1, ceil(D /
  3))`; S is the unweighted string bytes; O is the number of operators in the
  canonical content stream. D of a font is the largest of: the UTF-8 length of
  each canonical `ToUnicode` destination (an unpaired surrogate counts 3 bytes);
  for each glyph name in the font's canonical `/Differences`, 4 when the name
  starts with `u` and has 6 characters, or 7 characters without the prefix
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
  its decoded stream, decoded and tokenized once per invocation and checked with
  BR-416, starting outside `BT` with the caller's graphics state and font;
  content that ends inside `BT`/`ET` refuses as `CONTENT_UNAVAILABLE`. Its
  resource scope is its own `/Resources`, or, when it has none, the resource
  scope of the content that invoked it; its `Tf`, `gs` and `Do` names resolve in
  that scope, and fonts it selects take the canonical names of BR-415. The
  projection of a Form is built once per pair of Form and resource scope and
  reused for later executions with that scope, its nested executions counted
  again each time; at each execution, its text-show strings are counted (BR-418)
  and their codes collected (BR-417, BR-420) with the font in effect at that
  point of the canonical stream, so a Form that shows text with its caller's
  font adds its codes to that font, once for each font it is drawn with. An
  inlined Form whose projected tokens, nested Forms included, hold no text-show
  operator (`Tj`, `TJ`, `'`, `"`) emits nothing; one that shows text before its
  own first `Tf` needs a font set by its caller (BR-416). Bounds per invocation:
  at most 256 distinct Forms, nesting at most 8 Forms deep, and at most 4,096
  Form executions in total (every `Do` of a Form counts, with or without text);
  a Form reached again on its own `Do` path is a cycle and refuses as
  `CONTENT_UNAVAILABLE`; an XObject of another subtype than `Form`, `Image` or
  `PS` refuses as `UNSUPPORTED_FORMAT`. Verified by: AC-11.
- **BR-420** — A simple font's encoding is resolved per shown code, and the
  projection emits it as `/Encoding << /Type /Encoding /BaseEncoding
  /WinAnsiEncoding /Differences [...] >>` listing every code the font's kept
  strings show that the `ToUnicode` CMap does not map, with its resolved glyph
  name; codes are collected at every execution with the font in effect (BR-419).
  A source `/Encoding` is checked in every case, even when a `ToUnicode` CMap
  exists: a name `StandardEncoding`, `WinAnsiEncoding`, `MacRomanEncoding` or
  `MacExpertEncoding`, or a dictionary with optional `/Type /Encoding`, one of
  those names as optional `/BaseEncoding` and optional `/Differences` of codes
  (integers 0–255) and glyph names; any other value refuses as
  `UNSUPPORTED_FORMAT`, and more than 256 codes or a glyph name over 31 bytes
  refuses as `LIMIT_EXCEEDED`. The base table is the named one, else (no
  `/Encoding`, or no `/BaseEncoding`): StandardEncoding for a font with no font
  program whose `BaseFont`, without a subset prefix, is one of the 12 standard
  Latin fonts (Times, Helvetica and Courier families) or whose `Flags` have
  Nonsymbolic set and Symbolic clear; StandardEncoding for a `TrueType` font
  with a `FontFile2` and Nonsymbolic set; for a `Type1` or `MMType1` font with a
  `FontFile`, the built-in encoding of its program; otherwise no base table.
  `/Differences` entries override the base table. The built-in encoding is read
  only at the first shown code that the `ToUnicode` CMap does not map and that
  has no `/Differences` entry, so the program of a font whose `/Differences` and
  `ToUnicode` cover every shown code is never read. It is read from the
  program's cleartext part only: a direct integer `/Length1` of 1–65,536 bytes
  (over 65,536 refuses as `LIMIT_EXCEEDED`), decoded by the streaming inflate of
  BR-414 up to that length, tokenized with the bounded tokenizer up to its first
  `/Encoding` name, which is followed either by `StandardEncoding def` or by
  `<n> array` with `n` 1–256, optionally `0 1 255 {1 index exch /.notdef put}
  for`, `dup <code> /<name> put` groups with each code below `n`, and `readonly
  def` or `def`; when a code is put twice, the last group wins; more than 256
  groups or a name over 31 bytes refuses as `LIMIT_EXCEEDED`; anything else, or
  no `/Encoding` in that part, refuses as `UNSUPPORTED_FORMAT`, and the
  encrypted part is never read. The tables are those of PDF.js 6.5.438. A shown
  code that the `ToUnicode` CMap does not map and that resolves to no glyph name
  or to `.notdef` refuses as `UNSUPPORTED_FORMAT`. A simple font whose
  projected `BaseFont`, which the kept `FontName` equals (BR-417), is one of
  the ten GBK font names that PDF.js 6.5.438 turns into a
  composite `GBK-EUC-H` font when it has no program and a `WinAnsiEncoding` base
  (its `chineseFontNames` list, such as `/#CB#CE#CC#E5`) refuses as
  `UNSUPPORTED_FORMAT`, since PDF.js would return none of its text. Verified by:
  AC-12.

## Contract details

### Ceilings added by F-034

All are per invocation, cumulative under BR-117 (equality permitted), and
passing any of them refuses as `LIMIT_EXCEEDED`, in the BR texts and here alike;
a value below a lower bound or of the wrong type refuses as its BR says. Flate
inline image output over its computed size is a consistency check, not a
ceiling, and refuses as `CONTENT_UNAVAILABLE` (BR-416). The F-009 operand checks
(arity, type, the 1,000,000 numeric bound, 32 nested `q` levels) are not
ceilings and keep their F-009 code, `UNSUPPORTED_FORMAT`. F-009 ceilings are
unchanged. AC-13 covers one example on each side of every ceiling not covered by
AC-02–AC-12.

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
| Distinct fonts read | 128 |
| `Widths` numbers; `Differences` codes; glyph name | 256; 256; 31 bytes |
| CIDFont `W` numbers | 65,536 |
| `BaseFont` name; `CIDSystemInfo` strings | 127 bytes; 64 bytes each |
| Type 1 cleartext `/Length1`; built-in encoding groups | 65,536 bytes; 256 |
| `ToUnicode` entries per CMap; codes mapped in all CMaps | 65,536; 262,144 |
| `ToUnicode` destination | 64 bytes UTF-16BE |
| Text-show string (F-009) | 4,096 bytes |

Decoded bytes of cross-reference streams, object streams, content streams,
Form streams, `ToUnicode` streams, Type 1 cleartext parts and inflated
inline images all count against B once each; the canonical document, with
its re-serialized content and CMaps, stays at most B, checked at each
emitted token (BR-418). Streams that are never decoded add nothing.

### Hostile input

- Decompression bombs: every inflate runs under the remaining B (F-009); object
  and cross-reference streams share that budget; a Flate inline image inflates
  under the smaller of its computed size and the remaining B, so a computed size
  of up to 2^35 bytes never raises the cap; a Type 1 program is inflated by a
  streaming inflate that stops at `/Length1`; nothing is decoded speculatively.
- Cross-reference loops and floods: a repeated section offset is a cycle;
  32 sections, `/Size` 65,536 and 4,096 `/Index` pairs bound the table.
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
  canonically, so PDF.js never parses a source CMap; every shown code that
  `ToUnicode` does not map is listed in `/Differences`, so the base table PDF.js
  picks (from `Flags` or the font name, as when it drops the `WinAnsiEncoding`
  base of a nonembedded `Symbol`, `ZapfDingbats`, `Dingbats`, `Wingdings`,
  `Wingdings-Bold` or `Wingdings-Regular` font) never decides a shown code; the
  GBK font names PDF.js turns into a composite font refuse.
- Repeated execution: every Form execution is inlined and counted, so a Form
  drawn many times or nested many ways costs its full output against B, the item
  ceiling and the 4,096-execution ceiling before PDF.js starts; the running
  checks of BR-418 stop the projection at the token that passes a ceiling, so
  the canonical stream is never built beyond the bounds; each Form is decoded
  and tokenized once.
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

- **AC-01** (BR-114 v2, BR-412–BR-420) — Given S01–S29 of the
  measurements,
  When page 1 is read, Then each returns the text raw PDF.js reads from its
  source file (the "Raw PDF.js" column; `Hello modern PDF` for S01–S20)
  with `total_pages` 1, and the bytes PDF.js receives contain no `/Filter`,
  `/XRef`, `/ObjStm`, `/FontFile`, `/Metadata`, `/Info`, `/ExtGState`,
  `/XObject` or `BI`. Verified by: `BR-114 v2 AC-01 synthetic producer
  corpus extracts`.
- **AC-02** (BR-412) — Given (a) a file whose second revision replaces page
  1's content, (b) a hybrid file whose table marks the content object free
  and whose `/XRefStm` lists it in use, (b2) the same file whose table lists
  the content object in use at the right offset and whose `/XRefStm` lists
  it in an object stream with other text, (c) a linearized-style file whose
  last `startxref` points at a first-page section with `/Prev` to the main
  section, (d) a `/Prev` chain A→B→A, (e) 32 and 33 sections, (f) `/Size`
  65,536 and 65,537, (g) `/W [1 8 2]` and `/W [1 9 2]`, (h) a
  cross-reference stream one byte short of its entry count, (i) an indirect
  `/W`, (j) `/W [1 0 2]`, (k) `/W [0 4 0]` listing every object, (l)
  `/Index [0 5 3 4]`, (m) `/Index [5 4 0 5]`, (n) `/Index` counts totalling
  `/Size` + 1, (o) 4,096 and 4,097 `/Index` pairs, When page 1 is read,
  Then (a) gives the second revision's text, (b), (c), (g) at 8 and (k)
  give the text, (b2) gives the table's text, (d) and (h) are
  `CONTENT_UNAVAILABLE`, (e) gives the text at 32 and `LIMIT_EXCEEDED` at
  33, (f) and (o) give the text then `LIMIT_EXCEEDED`, (g) at 9 is
  `LIMIT_EXCEEDED`, (i), (j), (l), (m) and (n) are `CONTENT_UNAVAILABLE`,
  each refusal before PDF.js. Verified by: `BR-412 AC-02 cross-reference
  chain`.
- **AC-03** (BR-413) — Given (a) all non-stream objects in one object
  stream, (b) a type 2 entry naming an object stream that is itself a
  type 2 object, (c) a header pair naming another object number, (d) a
  stream object inside an object stream, (e) indirect `/Length` objects,
  one of them inside an object stream, (f) an object stream whose `/Length`
  lives inside itself, (g) a generation mismatch on the page object, (h) a
  page tree that needs 4,096 and 4,097 distinct resolved objects, (i) a page
  tree that resolves the same 4,000 objects twice, (j) header offsets
  `0 10 10`, (k) `/N` 4,096 and 4,097, (l) an object stream whose `/Length`
  is a type 2 object of another object stream, When page 1 is read, Then (a),
  (e) and (i) give the text, (b), (c), (d), (f), (g), (j) and (l) are
  `CONTENT_UNAVAILABLE`, and (h) and (k) give the text then
  `LIMIT_EXCEEDED`, each refusal before PDF.js. Verified by: `BR-413 AC-03
  object resolution`.
- **AC-04** (BR-414, BR-117) — Given budget B and (a) Flate content with
  predictor 12 whose inflated bytes, counted against B with everything
  else the file decodes, reach exactly B and B + 1, (b) an object stream
  and (c) a cross-reference stream that each inflate one byte over the
  remaining B, (d) `/Columns` 65,536 with `/Colors` 4 and `/Columns`
  65,537, (e) predictor 2, (f) predicted data that is not a whole number of
  rows, (g) `LZWDecode` content, (h) a page that also draws a `DCTDecode`
  image whose data is not a JPEG, (i) a `/Length` past the end of the
  file, When page 1 is read, Then (a) gives the text at B and
  `LIMIT_EXCEEDED` at B + 1, (b) and (c) are `LIMIT_EXCEEDED`, (d) gives the
  text at 65,536 and `LIMIT_EXCEEDED` at 65,537, (e) and (g) are
  `UNSUPPORTED_FORMAT`, (f) and (i) are `CONTENT_UNAVAILABLE`, and (h)
  gives the text with the image never decoded. Verified by: `BR-414 AC-04
  stream decoding`.
- **AC-05** (BR-415) — Given a three-page file with `/OpenAction`
  JavaScript, a link annotation with a URI action, `/AcroForm`,
  `/Names /EmbeddedFiles`, `/Outlines`, `/StructTreeRoot`, `/Metadata`, a
  `MediaBox` and `Resources` inherited from the root Pages node, a page 2
  with no `/Contents`, and a Type3 font on page 3, When pages `[1, 2]` are
  read, Then page 1's text returns with `total_pages` 3, the canonical
  bytes contain none of those keys nor `/S /JavaScript`, page 1's font is
  `/K1`, page 2 has an empty content stream, page 3 has empty `Resources`
  and content, and reading page `[3]` is `UNSUPPORTED_FORMAT`. Verified by:
  `BR-415 AC-05 canonical projection`.
- **AC-06** (BR-416) — Given pages with (a) every dropped operator family
  between text objects, (b) `Tf` and `Tc` before `BT` and a second `BT` that
  shows text without `Tf`, (c) a text-show with no font set, (d) `gs` naming an
  ExtGState with `/Font`, (e) an unknown operator, (f) a stray `Q` and two
  unclosed `q`, (g) a `Contents` array splitting `BT ... ET` across two streams,
  (h) one content stream shared by pages 1 and 2, (i) 1,024 and 1,025 `Contents`
  references, (j) inline images framed by `/L`, by `/A85`, by `/AHx`, by size
  with no filter (S29), and by one `/Fl` inflate, (k) an inline image with `/F
  /DCT` and no `/L`, (l) an inline image with `/F /Fl` and `/DP`, (m) an inline
  image whose computed size overruns the content, (n) 32 and 33 inline
  dictionary pairs, (o) `Do` inside `BT`, (p) a font name with bytes outside
  0x21–0x7E, (q) a Flate inline image with `W` and `H` 65,536, `BPC` 16 and
  `/CMYK` (computed size 2^35 bytes) whose data inflates to more than the
  remaining B, (r) a Flate inline image whose data inflates to one byte more
  than its computed size, below the remaining B, (s) an unfiltered image mask
  with `/IM true` and no `/BPC`, framed by size, (t) an unfiltered `/G` image
  with `BPC` 1, `H` 1 and `W` 65,536 and 65,537, (u) `/A85` data holding `>`
  before its `~>`, When the page(s) are read, Then (a), (b), (f), (g), (h), (j),
  (p), (s) and (u) give the text (h for pages `[1, 2]`) and the canonical
  content holds only kept operators, hexadecimal strings and `#`-escaped names,
  (c), (m) and (r) are `CONTENT_UNAVAILABLE`, (q) is `LIMIT_EXCEEDED` with no
  more than the remaining B inflated, (d), (e), (k), (l) and (o) are
  `UNSUPPORTED_FORMAT`, (i), (n) and (t) give the text then `LIMIT_EXCEEDED`,
  each refusal before PDF.js. Verified by: `BR-416 AC-06 content projection`.
- **AC-07** (BR-417) — Given (a) a TrueType font in WinAnsiEncoding whose
  `FontFile2` holds random bytes, (b) a Type0 Identity-H font whose
  `ToUnicode` maps one code to `ffi`, (c) a Type0 font without `ToUnicode`,
  (d) a Type0 font with `/Encoding /UniJIS-UCS2-H`, (e) a Type3 font
  selected by `Tf`, (f) a CMap with `usecmap`, (g) CMaps of 65,536 and
  65,537 entries, (h) destinations of 64 and 66 bytes, (i) 128 and 129
  distinct fonts, (j) a Type0 font whose `ToUnicode` misses one shown code,
  (k) `/ToUnicode /Identity-H`, (l) a `bfrange` with an array one element
  short, (m) a code mapped by two entries, (n) CMaps mapping 262,144 and
  262,145 codes in total, (o) `Widths` of 256 and 257 numbers, (p) a
  descendant `W` of 65,536 and 65,537 numbers, (q) a descendant without
  `FontDescriptor`, (r) a `Flags` value that is a string, When page 1 is
  read, Then (a), (b) and (m) give their text (the last entry for (m)) and
  the canonical bytes hold no font program and no source CMap, (c), (d),
  (e), (f), (j) and (k) are `UNSUPPORTED_FORMAT`, (l), (q) and (r) are
  `CONTENT_UNAVAILABLE`, and (g), (h), (i), (n), (o) and (p) give the text
  then `LIMIT_EXCEEDED`. Verified by: `BR-417 AC-07 fonts`.
- **AC-08** (BR-418) — Given a `ToUnicode` font whose largest destination
  is 48 UTF-8 bytes (`m` 16) and a page repeating one string so that the
  sum of U is exactly B and B + 1; a Differences font whose names include
  `u1F600` (D 4, `m` 2) at the same two sums; a Form holding that string
  drawn so that the sum of U is B and B + 1; strings of 4,096 and 4,097
  bytes; and a page whose sum of I is 65,536 and 65,537, When the page is
  read, Then each first case gives its text and each second case is
  `LIMIT_EXCEEDED` before PDF.js; and the exact-pin dependency stress of
  `TestBR114_pdf_producer_admission` passes for Type0/`ToUnicode`,
  Differences and Form-inlined text with produced bytes and items never
  above the admitted U and I. Verified by: `BR-418 AC-08 producer
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
  maps its codes, When page 1 is read, Then (a), (b) and (c) give the text with
  the canonical content holding `q`, the `/Matrix` as `cm` and `Q` around each
  inlined Form and one canonical name per font object, (d) gives the text at 8
  and `LIMIT_EXCEEDED` at 9 with no output for the text-free Form, (f) and (g)
  give the text then `LIMIT_EXCEEDED`, (e) and (j) are `CONTENT_UNAVAILABLE`,
  (h) and (i) are `UNSUPPORTED_FORMAT`, (k) is `LIMIT_EXCEEDED` at the token
  whose operator makes the sum of I pass 65,536, with no token emitted after it
  (read through the emitted-token count the test observes), (l) gives the text
  with one `q` and is `UNSUPPORTED_FORMAT` with two, and (m) gives both texts
  with the Form's codes in the simple font's canonical `/Differences`, each
  refusal before PDF.js. Verified by: `BR-419 AC-11 Form inlining`.
- **AC-12** (BR-420) — Given (a) S26, (b) a Type1 font with `/Differences`
  mapping codes below 0x20, (c) nonembedded Helvetica with no `/Encoding`, (d) a
  symbolic TrueType font with a `FontFile2`, no `/Encoding` and no `ToUnicode`,
  (e) a font whose `/Encoding` is `/Foo` while a `ToUnicode` maps every shown
  code, (f) `/Differences` of 256 and 257 codes, (g) glyph names of 31 and 32
  bytes, (h) a cleartext `/Length1` of 65,536 and 65,537, (i) a cleartext whose
  `/Encoding` array uses another procedure than the admitted loop, (j) a WinAnsi
  font showing code 0x81 with no `ToUnicode`, (k) a `Symbol` font with no
  `/Encoding` and no `ToUnicode`, (l) an equality test of the four base tables
  against the pinned PDF.js tables, (m) a pdfTeX-style `Type1` font with a
  `FontFile` whose `/Length1` is 70,000, full `/Differences` for its shown codes
  and no `/BaseEncoding`, (n) a cleartext that puts code 65 twice, (o) a
  cleartext `10 array` that puts code 12, (p) a `FontFile` that inflates to
  fewer than `/Length1` bytes, (q) a nonembedded `Symbol` font with
  `/Differences` for its shown codes, (r) fonts whose `BaseFont` is
  `/#CB#CE#CC#E5` and `/#B7#41`, (s) a nonembedded font with `BaseFont /Foo`, a
  `FontDescriptor` with `FontName /#CB#CE#CC#E5`, a `WinAnsiEncoding` base and
  `/Differences` for its shown codes, (t) a `Type1` font whose `FontFile` has
  `/DecodeParms` and a shown code that needs its built-in encoding, When page 1
  is read, Then (a), (b), (c), (m), (q) and (s) give their text, (s) with
  `FontName /Foo` in the canonical font, (m) without its program being read, (n)
  gives the text of the last group, the canonical font carries `/BaseEncoding
  /WinAnsiEncoding` with every shown code in `/Differences` and `Flags` with
  Nonsymbolic set and Symbolic clear, (d), (e), (i), (j), (k), (o), (t) and (r)
  at `/#CB#CE#CC#E5` are `UNSUPPORTED_FORMAT` while (r) at `/#B7#41` gives the
  text, (p) is `CONTENT_UNAVAILABLE`, (f), (g) and (h) give the text then
  `LIMIT_EXCEEDED`, and (l) holds. Verified by: `BR-420 AC-12 simple font
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
- **D-3 — Decode only what is needed (BR-414).** Images and font programs
  carry DCT, JBIG2, JPX or exotic filters that text never needs; framing
  them without decoding removes their decoder surface and their budget.
  FlateDecode with PNG predictors covers the cross-reference streams of
  every PDF 1.5+ generator and the content streams of almost all.
  Rejected: other filters (rare on content and CMaps; each adds a decoder);
  TIFF predictor 2 (not used on these streams by common generators).
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
  does not map in `/Differences` over a `WinAnsiEncoding` base (PDF.js ignores a
  `StandardEncoding` name) with Nonsymbolic `Flags`, and refuses a shown code
  whose mapping can only come from the program. The base table PDF.js ends up
  with therefore never decides a shown code: PDF.js 6.5.438 drops the
  `WinAnsiEncoding` base of a nonembedded font named `Symbol`, `ZapfDingbats`,
  `Dingbats`, `Wingdings`, `Wingdings-Bold` or `Wingdings-Regular` (measured:
  such fonts with `/Differences` still give their text), and turns a nonembedded
  font with a `WinAnsiEncoding` base and one of ten GBK names into a composite
  `GBK-EUC-H` font (measured: no text), so those names refuse. Type0 needs
  `ToUnicode` for every shown code because, without the program, Identity codes
  have no text meaning. Rejected: passing font programs (parser surface,
  memory); predefined CMaps (need external CMap data, refused by BR-122);
  letting PDF.js fall back on `Flags` (S26 measured wrong text).
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
  alone, with a streaming inflate that stops at `/Length1`, under a 64 KiB bound
  with a fixed grammar, and only when a shown code has no other mapping (pdfTeX
  fonts with a full `/Differences` never need it) and emits the result as
  `/Differences`; the encrypted part, the charstrings and the program itself
  never reach the parser or PDF.js. Rejected: keeping the program for that case
  (puts the Type 1 parser back on untrusted input for every LaTeX file);
  documenting a residual (LaTeX body text is the most common case in the
  review's list); CFF (`FontFile3`) built-in encodings (binary parser; refused,
  residual).

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
