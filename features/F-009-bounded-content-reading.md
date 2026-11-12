---
id: F-009
title: Bounded text, selected PDF text and complete MCP images
ticket: "#14"
status: done
version: 1
---

## Context

Autonomously frozen by the orchestrator on 2026-11-03 at 00:39:59 UTC,
exact reviewed SHA `3fe07d92b75776fbfb4091b887a4c7839b5295ca`, after fresh
independent round 2 approval (archived evidence `runs/14-spec-review-2.md`). The ticket is ready,
no question remains, and the owner was notified of this SHA, the decisions and
the deliberately limited PDF/image compatibility. See the
freeze record (archived evidence `runs/14-freeze-1.md`). Implementation and acceptance are pending.

#14 (archive issue 14) extends the injected
content composition accepted by #10 on actual main
`4f84e4bb5343274d779ff43061effb60aa3cb64b`. Clients need readable text and
complete resized images instead of raw base64 bytes. The users affected are
consumers of the injected SDK server; the packaged production CLI still reports
its existing unavailable-runtime diagnostic. No provider adapter exists.

F-007 requires qualified strong version binding. The #5 observations in
[read evidence](../docs/kdrive-read-evidence.md) establish neither conditional
semantics nor atomic version binding. Equal opaque provider tags are insufficient.
#6 AC-19/20 and #7 AC-14/15 remain mandatory and blocked. These synthetic ACs do
not replace them. No account, credential or private fixture is accessed.

The user expressly authorized #14 concurrently with #11, which separately owns
F-008 / BR-094–108. This branch starts from actual main, is not stacked on #11,
and has one independently reviewed PR; the orchestrator merges sequentially.
F-009 reserves BR-109–123 and ADR-004. BR-060 becomes v4 for its same-purpose
registration contract. Existing F-007 byte/resource semantics remain unchanged.

## Scope

- `kdrive_read` in every operation mode: complete bounded source download,
  strict text decoding, selected PDF page text and complete resized PNG/JPEG
  image output, all sharing the existing immediate private content policy path.
- Maintained pure-JavaScript PDF/image dependencies, pinned exact versions and
  lockfile, ADR-004 and README rationale/limitations. Standard Node APIs require
  no external executable, native add-on or WASM codec.
- Tests first; named BR unit tests, representative actual SDK wire checks,
  package checks and the full Docker/Make gate.
- Synchronize accepted #10 markers and carry unchanged `runs/10-pr46-review-3.md`,
  `runs/10-acceptance-1.md`, `runs/10-usage-summary-1.md` and the initial
  `runs/14-orchestration-1.md`. Reconcile any same-marker changes from #11 with
  latest main before merging; do not overwrite later accepted evidence.

### Out of scope

OCR, office/archive extraction (#15), HTML rendering, network/URL/font fetching,
PDF rendering, encrypted PDF/password arguments, arbitrary PDF compatibility,
animation, SVG/GIF/WebP/TIFF/HEIC, EXIF rotation, MIME or charset guessing from
provider-controlled filenames, content caches, resource representation changes,
provider qualification/probes, production wiring, configuration additions,
HTTP/auth changes, writes, releases, VERSION bumps and publication.

## Business rules

BR-109–123 are new v1 definitions; canonical records follow reviewed freeze.

- **BR-060 v4** — Every operation mode registers exactly ten declared cumulative
  read tools and the single existing complete-binary resource template, with no
  mutation tool, prompt or enumerated resource. Verified by: AC-01.
- **BR-109** — Each read download attempt and each final publication passes the
  existing fresh owner-drive/file read policy, with no protected content call
  or content disclosure after denial. Verified by: AC-02.
- **BR-110** — Every extracted continuation uses Unicode code-point offsets in
  one qualified strong source version and exactly the declared selection.
  Verified by: AC-03, AC-04.
- **BR-111** — Every extraction downloads one entire bounded source version
  through exact F-007 range/body evidence before decoding any source bytes.
  Verified by: AC-05.
- **BR-112** — Text decoding accepts only the declared encodings with strict
  validation, preserves text after one leading BOM removal and never silently
  substitutes malformed input. Verified by: AC-06.
- **BR-113** — Text/selected-page output truncates only at code-point boundaries
  and reports exact progress while counting the entire serialized output budget.
  Verified by: AC-07.
- **BR-114** — PDF extraction accepts only the bounded preflight profile and
  never starts PDF.js on unsupported, malformed or over-budget containers.
  Verified by: AC-08, AC-09.
- **BR-115** — PDF text contains only the requested ordered pages with declared
  separators, and a selection without extractable non-whitespace text returns
  an explicit no-text result without OCR. Verified by: AC-10.
- **BR-116** — Image decoding starts only after bounded format/dimension/
  decompression admission and publishes exactly one complete valid resized PNG
  with metadata, or an explicit refusal. Verified by: AC-11, AC-12.
- **BR-117** — All input, decoded/decompressed, structural, processing-time and
  serialized-output ceilings are cumulative within one invocation and equality
  is permitted. Verified by: AC-05, AC-09, AC-12, AC-13.
- **BR-118** — Cancellation, deadline and close terminate owned extraction work
  before the invocation slot is released and suppress late publication.
  Verified by: AC-13.
- **BR-119** — Unsupported binary and unsupported containers return declared
  fixed results and never fall back to lossy text or a different representation.
  Verified by: AC-14.
- **BR-120** — Content/worker errors and diagnostics serialize only declared
  fixed strings and never dependency messages, content, URLs or credentials.
  Verified by: AC-15.
- **BR-121** — Source envelopes and worker outputs are validated from own data
  properties and copied into declared projections without invoking hooks.
  Verified by: AC-15.
- **BR-122** — Extraction/image dependencies execute without external requests,
  optional native/WASM codecs, eval or document-supplied JavaScript.
  Verified by: AC-16.
- **BR-123** — Missing qualified content dependencies refuse authorized reads
  explicitly while existing raw/resources/navigation and the production
  diagnostic retain their accepted contracts. Verified by: AC-01, AC-16.

## Contract details

### Tool schema and representation

The strict `kdrive_read` schema contains required positive safe numeric `file_id`,
optional same `drive_id` default as other tools, required `format` enum
`text|pdf|image`, optional nonnegative safe numeric `offset` default0, optional
positive safe numeric `length` maximum characters, optional qualified strong
`etag` with F-007 grammar, optional `encoding` enum
`utf-8|utf-16le|utf-16be|windows-1252`, and optional `pages` array.
`pages` has 1–10 strictly increasing unique positive safe integers. PDF defaults
to `[1]`; `pages` is PDF-only and `encoding` is text-only. Images forbid offset,
length, encoding and pages, even explicit offset0. Positive text/PDF offset
requires etag; etag at offset0 is allowed. Reject null, unknown fields, coercion,
invalid cross-field combinations or unsafe arithmetic as `INVALID_ARGUMENTS`
before protected calls. No MIME, extension or bytes-to-characters guess is made.

Text/PDF success has one MCP text block containing JSON with exactly
`{drive_id,file_id,format,etag,size_bytes,offset,characters_read,total_characters,text,has_more,next_offset?}`
plus `encoding` for text or `pages,total_pages` for PDF. `format` is the requested
literal. Numbers count Unicode code points (including separate combining marks),
not UTF-16 code units, UTF-8 bytes or grapheme clusters. `next_offset` exists iff
`has_more` and equals offset+characters_read. It is never a byte offset.
`total_characters` refers to the complete decoded text or selected-page joined
text before output truncation. EOF offset succeeds empty/terminal; beyond EOF
returns `INVALID_RANGE`. Nonempty remaining text must make positive progress.
No normalization, newline conversion, JSON/CSV parsing or syntax highlighting
changes the decoded text. JSON, CSV, Markdown and code are ordinary text.

Image success has exactly two blocks: metadata JSON text containing
`{drive_id,file_id,format:"image",etag,size_bytes,width,height,mime_type:"image/png"}`
and one `{type:"image",mimeType:"image/png",data}` block. `data` is canonical
padded standard base64 of one complete PNG, not JSON-embedded base64 or a slice.
Images have no continuation. Every successful image must decode independently
and have the advertised dimensions; source type is PNG or JPEG, output is PNG.

### Shared download, version and policy boundary

Refactor F-007 only mechanically to reuse a private bounded complete-bytes
consumer, with no serialization/base64 intermediate, exposed grant or raw port.
The refactor retains its unit/wire contracts. It authorizes before descriptor,
each retried open/describe and publication. Read the entire admitted file from
byte0 to size-1 in one exact qualified range (empty files open nothing), bounded
16384-byte reader pulls plus the exact EOF probe. Reuse own-data validation,
strong ETag/version_bound, exact206 identity/bounds/length, cleanup, branded
pre-body retry helper, shared512 calls/five list calls, busy slot and10000ms
invocation deadline. No body retry, partial-file fallback or parser starts before
the entire source passes validation. Reauthorize after extraction immediately
before publication, including received-proof freshness. Directory reads deny.

Any supplied etag is compared to a fresh qualified descriptor before body open;
a mismatch is `VERSION_CHANGED`. Unqualified tags are `VERSION_UNAVAILABLE`.
Every continuation redownloads and reextracts the entire source; no content or
parser state is retained. Clients repeat exact drive/file, format, encoding and
page selection with returned etag and next_offset. Offsets are interpreted only
within that explicit selection; changing pages/encoding defines a different
representation and is not a continuation. Documentation explains full repeated
bandwidth/CPU cost; clients can use raw byte download when appropriate.

### Fixed ceilings and execution ownership

Existing configuration fields are used, with smaller hard ceilings:

| Work | Ceiling per invocation |
| --- | --- |
| Complete source bytes | min(maxReadBytes, 8388608) |
| Logical decoded PDF stream bytes, aggregate across all objects | B = min(maxExtractBytes, 16777216) |
| Canonical uncompressed PDF bytes / pre-admitted PDF text-production bound | each <= B |
| Decoded text UTF-8 bytes | min(maxExtractBytes, 16777216) |
| PDF indirect objects / dictionary/array nesting / pages | 4096 / 32 / 256 |
| PDF selected pages / emitted text items across selection | 10 / 65536 |
| Image source pixels / source edge | 1048576 / 8192 |
| Image RGBA bytes and PNG inflated scanline bytes | each <= min(maxExtractBytes, 16777216) |
| Output image bounding box | 512 by512, never upscale |
| Image encode attempts | at most10 complete encodes |
| Processing deadline from worker start | min(extractTimeoutMs, remaining invocation deadline) |
| Final serialized CallToolResult | <=262144 UTF-8 bytes and <=maxOutputChars UTF-16 code units |

The worker starts only after complete-byte admission; all decoding, preflight,
inflate, extraction, resize and encode occurs in one invocation-owned Node
worker. No concurrent pipeline or waiting queue is introduced. Set worker
resourceLimits old generation128MiB, young16MiB, stack4MiB as secondary guards;
they do not cap ArrayBuffer/external memory. The configured extract budget caps
logical expanded document bytes, canonical PDF bytes and admitted text output,
not total process memory or every dependency scratch allocation. Explicit
byte/pixel/preflight checks and the accounting below bound document-derived
external buffers; structural limits and V8 limits bound dependency object work.
Transfer only invocation-owned dedicated ArrayBuffers,
never a pooled Buffer. Worker startup/options are server-owned; no environment
selector or user script/path participates. No worker has policy/provider ports.

Worker stdout/stderr are captured, bounded/drained/discarded, never inherited by
MCP stdout or diagnostics. Parent only accepts one bounded validated terminal
message. Parent timer/cancellation terminates the worker even during synchronous
CPU work, awaits worker exit before releasing the slot, then discards buffers.
Worker heap/abnormal exit is `LIMIT_EXCEEDED`; deadline is `REQUEST_TIMEOUT`;
cancellation/close keeps existing `ACCESS_DENIED`. No retry of extraction.
Parent liveness/policy/output checks follow worker completion. Workers do not
constitute a general hostile-code security sandbox; only trusted pinned code
processes untrusted document data.

### Encoding-aware text and truncation

Default is strict UTF-8 except a leading UTF-8/UTF-16LE/UTF-16BE BOM selects that
encoding when encoding is omitted. An explicit encoding must agree with any
recognized BOM; mismatch or malformed sequence uses `INVALID_ENCODING`. Strip
one matching leading BOM, preserve every other code point including subsequent
U+FEFF and CR/LF. UTF-16 rejects odd bytes/unpaired surrogates; UTF-8 rejects
invalid/overlong/truncated sequences. Windows-1252 is explicit-only, with the
WHATWG mapping. Reject decoded U+0000 or C0 controls except TAB/LF/CR as
`UNSUPPORTED_FORMAT`; C1 and printable Unicode are preserved. This prevents
ordinary unlabelled binary fallback while supporting explicit legacy text.

Compute decoded UTF-8 byte size before retaining text beyond the ceiling;
multibyte decode tests distinguish source bytes, code points, UTF-16 output
units and escaped JSON bytes. Select the largest prefix fitting requested length,
remaining code points and the complete actual CallToolResult ceilings, including
all JSON escapes, metadata, MCP block overhead and continuation fields. Validate
the actual serialization again. No split surrogate, partial JSON/base64,
zero-progress truncation, elision marker or silent tail loss is permitted.
An empty complete text source is a successful terminal result.

### Conservative PDF admission and selected-page extraction

Use maintained Mozilla `pdfjs-dist` pure-JavaScript text extraction after a
small fail-closed framing preflight, not a general recovery parser. The supported
profile is a single PDF1.0–1.7 classic-xref revision with a canonical trailer,
finite indirect objects, no encryption, no incremental update (`Prev`), no hybrid
xref (`XRefStm`), no object/xref streams, no linearized dictionary, no external
streams/files, no embedded files, no XFA, no JavaScript/actions and no filters
except one direct `/FlateDecode` or no filter. `/DecodeParms` and filter arrays
are unsupported. All stream lengths are direct nonnegative integer `/Length`
values; indirect lengths are unsupported. All object generations are0 except
xref object0, which is the required free entry. Do not render image/font streams.

Preflight tokenizes comments, escaped names, literal/hex strings, arrays and
dictionaries with nesting/size limits. It never regex-searches binary payloads
for `obj` or `endstream`. Read the final `startxref`/`%%EOF` framing (trailing PDF
whitespace only), validate one classic xref and trailer, then use its offsets and
direct stream lengths to frame every object. Every nonfree entry maps exactly to
its declared object header, each object has one nonoverlapping complete extent,
all bytes between framed objects are PDF whitespace/comments, and every stream
ends at its exact length followed by the declared delimiter/endobj. Reject
missing/duplicate object IDs or dictionary keys, overlapping offsets/extents,
unindexed object data, extra revisions/trailing data, unsafe lengths/references,
unbalanced syntax or ambiguous framing. Reference resolution is finite and
cycle-aware; no repair/fallback or partial page parsing is allowed.

Before invoking PDF.js, inspect every framed stream, including unreachable ones.
Let B=min(maxExtractBytes,16777216), and count each unique decoded stream's exact
length once against B. Retain preflight-decoded bytes only within that aggregate.
Inflate Flate streams with Node zlib `maxOutputLength` set to the remaining B and
`rejectGarbageAfterEnd:true`; one-byte-over expansion fails inside the inflater.
A zero allowance admits only a provably empty stream; do not pass0 as an
unbounded/default inflater option. No filter/predictor chain is permitted.

The admitted object graph consists only of one Catalog, a finite Pages tree,
Page objects, their content streams, the simple font below and optional bounded
Image XObjects. Exact allowed keys by role are: Catalog Type/Pages; Pages
Type/Parent/Kids/Count (Parent absent only at root); Page
Type/Parent/MediaBox/Resources/Contents; Font Type/Subtype/BaseFont/Encoding;
content stream Length/Filter; Image
Type/Subtype/Width/Height/ColorSpace/BitsPerComponent/Length/Filter; trailer
Size/Root. Filter is optional and other listed keys are required where applicable.
Resources permits only Font and XObject; Font contains only F1, XObject has at
most256 unique Im1–Im256 names referring to Image objects. Empty Resources is
valid for a blank page. MediaBox has four finite bounded numbers and positive
width/height; tree Counts match actual unique leaves and only Parent edges may
point backward. Indirect roles use references, never inline alternative objects.
Reject unknown object roles or dictionary keys, embedded/Type3/
CID fonts, FontDescriptor/FontFile/ToUnicode/Encoding dictionaries, CMaps,
Differences, Forms, patterns, shadings, ExtGState, annotations, marked content and
resource inheritance. Each page has an explicit MediaBox and Resources and
exactly one direct reference to its own content stream (an empty stream is
allowed). Content arrays and reuse of one content stream by multiple pages are
unsupported; this removes sequence-buffer concatenation and repeated expansion.
The sole text font is nonembedded `/Subtype /Type1 /BaseFont /Helvetica` with
explicit `/Encoding /WinAnsiEncoding`, named `/F1`; no supplied font widths,
metrics or alternate mappings. Text strings contain only bytes0x20–0xff after
literal/hex-string unescaping. This includes accented WinAnsi text and Euro.
Image XObjects have only the direct supported raw8-bit DeviceRGB/DeviceGray
shape, no mask/alternate/ICC/interpolation/decode parameters; preflight verifies
positive bounded dimensions, pixel ceilings and decoded length exactly
width*height*channels. They are not decoded/rendered by text extraction.

Preflight tokenizes each decoded content stream, not only its framing. Admit
only q/Q, finite bounded cm, BT/ET, `/F1` Tf with size1–512, finite bounded
Tm/Td/TD/T*, Tj/TJ and the two standard quote text-show operators. Numeric
operands have at most32 source bytes and absolute value<=1000000; validate each
operator's exact arity/type and balanced text/graphics state. Do is allowed only
for a declared supported Image XObject, never a Form. Reject every other
operator, inline images, resource lookup fallback, repeated/nested execution
and unknown operands. There is no interpreter loop: source order executes once.
All text-show string occurrences count with multiplicity, including TJ entries;
all operator occurrences count, including repositioning and image draws.

Before starting PDF.js, for each selected page let N be the sum of decoded
text-show string bytes and O its operator count. Define U=8*(N+O+1) UTF-8 bytes and
I=2*(N+O+1) items, using safe arithmetic. Require the sum of U plus3 bytes per
interpage separator<=B and the sum of I<=65536. A declared single
string >4096 bytes also refuses before PDF.js. The simple single-byte WinAnsi
font has one fixed Unicode scalar per glyph (at most3 UTF-8 bytes), and
`disableNormalization:true` prevents text normalization expansion. With no
Forms/mappings/reexecution, each glyph/position operation can contribute only
its glyph, fixed whitespace/EOL and a bounded item split; U conservatively
bounds the entire page's producer strings and any single item; I bounds
its item count,
including dependency-side buffering before a consumer sees a chunk. This is a
pinned-profile bound, not a property of arbitrary PDF.js input. Exact-pin source
checks and real-dependency tests must establish this invariant; an unproved path
blocks implementation rather than widening this profile.

Feed PDF.js a bounded canonical uncompressed serialization of these already
validated objects. Preserve object identities, page order/selection, dictionaries
and decoded content bytes; remove only each stream's admitted Filter and replace
Length with its exact decoded length; emit fresh exact offsets/xref/trailer.
Reject if the canonical size exceeds B before allocating its buffer. The
serializer performs two bounded passes over the existing finite parsed model,
first exact length calculation then one allocation/write; no general repair,
normalization, graph cloning or PDF-rewriter framework. It must preserve admitted
text semantics, proved by paired direct/decompressed fixtures. Original bytes
are never passed to PDF.js, so no Flate DecodeStream, predictor, image decompression
or StreamsSequenceStream growth path can run. One unfiltered Stream views the
admitted canonical source; no power-of-two decoded buffer is inferred from a
logical length. Never return the canonical PDF to clients.

Accounting distinguishes logical bytes from storage: the input buffer<=8MiB;
all retained decoded stream payloads together<=B; canonical buffer<=B; admitted
text producer/result payloads each<=B, with their number bounded by page/stream
lifecycle; preflight releases decoded stream buffers after canonical transfer.
Node inflate output chunks and final concatenation each have at most the
remaining B payload; they may coexist transiently (up to twice that payload),
plus at most one16384-byte output-chunk slack before refusal. Only one inflater
is active, with fixed default window/state scratch; no custom window/chunk
options or concurrent inflate multiplies it. The project never labels B a total-allocator or
RSS limit. PDF.js font tables, glyph/style objects and parser bookkeeping are
trusted dependency scratch, constrained by the restricted graph, one built-in
font,4096 objects, text bounds and V8 worker limits, rather than falsely counted
as decoded source bytes. Record observed resource traces for small-limit bombs
and reject before PDF.js when any static admission budget fails. This profile
still refuses many common valid PDFs and makes no general compatibility claim.

Pass only canonical in-memory bytes to `pdfjs-dist/build/pdf.mjs`6.5.438 with `isEvalSupported:false`,
`useWasm:false`, `useSystemFonts:false`, `disableFontFace:true`,
`isOffscreenCanvasSupported:false`, `isImageDecoderSupported:false`,
`enableXfa:false`, `useWorkerFetch:false`, `disableAutoFetch:true`,
`disableStream:true`, `disableRange:true`, `stopAtErrors:true`, `verbosity:0`.
Do not supply URL/font/CMap/ICC factories that fetch external data. Disable
external factory fetches explicitly; missing required fonts/CMaps fail fixed.
Use getPage/streamTextContent only, with `disableNormalization:true`, never
getTextContent, render/operator-list/attachment/script APIs. The modern entrypoint
was imported and extracted WinAnsi text without native canvas in the bounded
exact-pin feasibility probe (archived evidence `runs/14-spec-author-2.md`); its fixed Node-build
recommendation warning is captured/discarded by worker stream ownership.
Validate total_pages<=256 before getPage, and all selected pages<=total_pages
before extracting any page; an out-of-range selection is `INVALID_RANGE`.

Consume one selected page at a time with a stream reader. Validate each chunk,
item count, string UTF-8 bytes and running U/B bounds immediately; cancel the
reader and destroy the task on the first violation. Do not accumulate a
dependency-side whole-page item array. Streaming/backpressure alone is not a
byte guard: the static U admission bounds even the first produced chunk/item.
Within each selected page, append text-item strings in PDF.js reported order;
append LF after each item with `hasEOL:true`; join selected page texts with
`\n\f\n`. Empty strings remain valid items; nontext marked-content records are
ignored. Check item count and cumulative UTF-8 text bytes before append. Do not
claim visual reading order, table reconstruction or semantic layout. Destroy
loading/document tasks and terminate owned worker on every path.

If all selected pages lack non-whitespace text (ignoring separators), return
`NO_EXTRACTABLE_TEXT` as a fixed isError result, including empty-page and scanned
image-only PDFs. The result states no OCR occurred; it does not claim to
identify scanned versus intentionally blank pages. An empty zero-byte source
requested as PDF is `UNSUPPORTED_FORMAT`, not a valid empty PDF.

### Complete images

Use a minimal Jimp composition with only core, PNG/JPEG format modules and resize
plugin; do not register other decoders or URL loaders. Sniff exact magic bytes,
never MIME/extension. PNG preflight validates signature, bounded chunk framing,
CRC, one IHDR first, legal dimensions/depth/color combination, IDAT ordering,
zero-length IEND last and no trailing bytes. Accept only noninterlaced8-bit
RGB/RGBA PNG; palette/grayscale/16-bit/interlaced/APNG are explicit unsupported.
Allow only IHDR/IDAT/IEND; ancillary metadata is unsupported to exclude hidden
compressed text/profile expansion. Compute exact inflated `(1 + width*channels)
* height` scanline bytes safely, check ceilings before inflate/decode, and
bounded-inflate concatenated IDAT to exactly that length with no trailing
compressed input. Mismatched length/refused CRC/malformed chunks fail fixed.

JPEG preflight walks length-framed marker segments, validates one baseline SOF0
with8-bit precision,1 or3 components, positive admitted dimensions and one
complete EOI with no trailing bytes; reject progressive/arithmetic/lossless,
multiple frames, malformed marker lengths, oversized declared dimensions and
unknown unsupported structure. Skip APP/COM segments without decompressing or
honoring metadata. Call the format decoder directly, then construct a bitmap;
never use Jimp fromBuffer/read paths that automatically rotate EXIF. Decode with
tolerantDecoding:false, maxResolutionInMP:1048576/1000000 (jpeg-js uses decimal
megapixels) and maxMemoryUsageInMB:32. Validate returned bitmap dimensions
and exact RGBA byte count against admission before resize.

Fit aspect ratio into512x512 without upscaling, positive integer dimensions
floor-rounded with min1, using a fixed nearest-neighbor resize. Encode complete
PNG; if the full result exceeds either output ceiling, halve both dimensions
(min1) and re-encode, at most10 attempts down to1x1. Test full serialization
including base64 `4*ceil(n/3)` expansion and both blocks/metadata. Never crop,
slice an encoded image/base64, truncate a block or silently emit raw bytes.
If even1x1 cannot fit, return `LIMIT_EXCEEDED`. Exact source and encoded payload
buffers remain worker-local and are discarded on completion.

### Errors, dependencies and compatibility

Retain existing fixed content errors, add `INVALID_ENCODING`,
`UNSUPPORTED_FORMAT`, `NO_EXTRACTABLE_TEXT` to tool fixed errors only. Use
`UNSUPPORTED_FORMAT` for unsupported signatures/profiles/container features;
`CONTENT_UNAVAILABLE` for admitted-format corruption/parser failure; bounds use
`LIMIT_EXCEEDED`. Structural limits take precedence over unsupported profiles
when a safely decoded declared length already exceeds a ceiling. Unauthorized
objects expose only policy denial; syntax errors precede protected calls. Errors
have isError:true and one fixed text block; no error.data or content snippets.
Unexpected errors use only the existing `NAVIGATION_FAILED\n` diagnostic.

ADR-004 documents PDF.js/Jimp choice, exact pinned package versions, licenses,
optional/native dependency exclusion and known format limitations. README lists
supported formats/encodings, complete-download costs, code-point semantics,
explicit refusals and injected-only production blockers. Optional native PDF.js
canvas dependencies are omitted from installation/lockfile where possible and
must never be imported or used; package verification proves extraction without
them. If the selected current pure-JS package version cannot meet these switches
or the profile, stop before implementation rather than silently widening scope.

## Acceptance criteria

- **AC-01 (BR-060 v4, BR-123)** — Given each mode and present/absent content ports,
  When SDK initialization/tools/resources lists run, Then ten cumulative reads,
  unchanged binary template and annotations/notices exist, and no production
  runtime appears. Verified by `TestBR060_v4_registration`, actual SDK tests.
- **AC-02 (BR-109)** — Given configured/received allowed and denied files,
  directory, same IDs on different drives, expiry/revocation during extraction
  and retries, When reads run, Then exact fresh traces allow only current owner
  policy and never publish denied content. Verified by `TestBR109_fresh_policy`.
- **AC-03 (BR-110)** — Given `A😀é\r\n` and selected PDF text, When bounded
  continuations reconstruct at every code-point boundary, Then output equals the
  original with exact totals, EOF, next offsets and repeated-download traces.
  Verified by `TestBR110_code_point_continuation`, bounded SDK reconstruction.
- **AC-04 (BR-110)** — Given changed same-size ETag, missing/unqualified tags,
  malformed offsets and changed selections, When continuing, Then tags bind the
  exact source, invalid syntax/version refuses before open, and each explicit
  selection defines its own offsets. Verified by `TestBR110_version_selection`.
- **AC-05 (BR-111, BR-117)** — Given source sizes just below/at/above each byte
  cap, malformed exact ranges, body bombs and premature EOF, When reading, Then
  oversized descriptors open nothing, every pull/close/call is bounded and no
  parser sees partial/unvalidated input. Verified by `TestBR111_complete_source`.
- **AC-06 (BR-112)** — Given UTF-8/16 BOM/no-BOM/explicit encodings, Windows1252,
  malformed multibytes/surrogates, BOM disagreement, controls and empty text,
  When decoding, Then exact valid text succeeds and fixed refusals replace no
  invalid bytes. Verified by `TestBR112_strict_decoding`.
- **AC-07 (BR-113)** — Given escaped JSON, astral/combining text and length/output
  ceilings just below/at/above, When truncating, Then code points stay whole,
  envelope overhead counts, progress is positive and no content silently drops.
  Verified by `TestBR113_complete_output_budget`.
- **AC-08 (BR-114)** — Given minimal uncompressed/Flate classic WinAnsi text PDFs
  and bounded raw image-only PDF, plus object/xref streams, encryption, indirect
  length, duplicate keys/IDs, strings containing delimiters, overlap, incremental
  and trailing-data variants, When preflight runs, Then only a bounded canonical
  serialization of the supported profile reaches PDF.js, preserving paired
  uncompressed/Flate text semantics. Verified by `TestBR114_pdf_framing`,
  `TestBR114_canonical_equivalence`, parser-start spy.
- **AC-09 (BR-114, BR-117)** — Given small configurable B at exact/one-over
  boundaries, Flate bombs, aggregate hidden/unreachable streams, canonical-size
  expansion, content arrays/repeated references, Form/font-map expansions, too
  many small show operations and one oversized string, When preflight runs,
  Then over-budget/unsupported work refuses before PDF.js or page production;
  valid U equality and paired uncompressed/Flate inputs stay within explicit
  logical/canonical/scratch accounting. Verified by `TestBR114_pdf_bombs`,
  `TestBR114_pdf_producer_admission`, exact-pin allocation/source traces; these
  tests distinguish early refusal from eventual worker termination.
- **AC-10 (BR-115)** — Given3-page text PDF, selected pages[1,3], blank and
  image-only PDFs, repeated WinAnsi show operations, invalid page selection and
  corrupt PDF, When extracting through the exact pinned streaming API, Then
  text order/separators/page totals are exact, blank/scanned selections use
  NO_EXTRACTABLE_TEXT without OCR, and corruption/range failures are fixed.
  Verified by `TestBR115_selected_pdf_text`, actual dependency fixtures.
- **AC-11 (BR-116)** — Given small valid RGB/RGBA PNG and baseline JPEG, When
  SDK image reads run, Then exactly one independent decodable complete PNG and
  metadata match, aspect ratio fits and small images never upscale. Verified by
  `TestBR116_complete_images`, independent PNG decode and actual wire blocks.
- **AC-12 (BR-116, BR-117)** — Given pixel/scanline/memory bombs, bad CRC/markers,
  progressive JPEG, animated/metadata PNG and output ceilings around base64
  boundaries, When decoding/encoding, Then unsafe inputs never reach decoder,
  full-image downscaling stays <=10 encodes and minimum failures emit no image.
  Verified by `TestBR116_image_budgets`, exact serialization checks.
- **AC-13 (BR-117, BR-118)** — Given CPU-bound and never-settling worker tasks,
  short extract timeout, invocation deadline, cancel/close and concurrent calls,
  When limits trigger, Then worker exit precedes slot release, busy/refusal is
  fixed, buffers are dropped and no late result publishes. Verified by
  `TestBR118_worker_lifecycle`, bounded SDK/worker watchdog tests.
- **AC-14 (BR-119)** — Given arbitrary binary, ZIP/office, wrong requested format,
  unsupported PDF/image features and no content port, When read runs, Then fixed
  explicit refusals occur with no alternate extraction/OCR. Verified by
  `TestBR119_explicit_refusals`.
- **AC-15 (BR-120, BR-121)** — Given getters/toJSON, extra fields, hostile worker
  messages/errors and canary content/URLs/tokens, When projection/errors/logs run,
  Then hooks never execute, exact output keys hold and no canary is reflected
  outside authorized success. Verified by `TestBR120_redaction`,
  `TestBR121_own_data_projection`, captured SDK/worker streams.
- **AC-16 (BR-122, BR-123)** — Given actual pinned PDF/image packages without
  optional native modules and trapped external loaders, When representative
  extraction, all existing raw/resource/navigation tests and packed CLI run,
  Then text/images work with zero external fetch/eval/WASM/OCR and old contracts
  remain intact. Verified by `TestBR122_pure_js_dependencies`, existing regression
  suites, package checks and full `make check` on actual main after merge.

Implementation records exact commands/results. Acceptance repeats all ACs on
actual main and records its SHA in #14 before closure. This establishes only
the declared injected scope; production blockers remain mandatory.

## Decisions

1. Use Unicode code points for extracted offsets; preserve combining marks and
   line endings. Reject UTF-16 offsets, byte offsets and grapheme segmentation
   whose locale/Unicode-version behavior complicates deterministic continuation.
2. Redownload/reextract complete small sources rather than retaining content or
   introducing cursors. Qualified ETags preserve source version; costs are explicit.
3. Select text/PDF/image explicitly, with strict encoding and binary controls;
   reject filename/MIME guessing, silent replacement and JSON/CSV reformatting.
4. Use PDF.js after conservative framing, simple WinAnsi operator admission and
   bounded canonical uncompressed serialization. Retain single Flate support;
   reject content arrays/reuse, Forms and font-map expansion before production.
   Logical extract bytes and finite scratch are different accounting units;
   heap limits are secondary. Broader compatibility needs a new version.
5. Use a minimal Jimp composition for baseline JPEG and constrained PNG and emit
   complete PNG only. Reject sharp/native codecs, WASM, broad auto-codec loading,
   animation, EXIF transforms and byte-sliced image output.
6. Reuse configured extract ceilings plus smaller fixed safety limits and a
   dedicated worker; cap full serialized MCP results including block overhead.
   Existing raw/resource wire contracts and binary-only resources remain unchanged.
7. Keep the injected-only delivery boundary and production diagnostic. Neither
   PDF/image dependency success nor opaque provider equality qualifies a provider.

## Open questions

None for this injected scope. Package-version resolution and implementation
verification are evidence tasks, not authorization to weaken the contract.

## Stress-test

- **Round1 — changes, all retained.** Fresh independent gpt-6-astra/high review
  of `1f46c6875b63a54b9ee74cde44691b00c1eb10de` reported2 major and2 minor
  findings in review1 (archived evidence `runs/14-spec-review-1.md`).
- **R1 retained:** logical unique stream size does not bound PDF.js concatenated
  or power-of-two buffers. Reject content arrays/reuse and non-profile expansion;
  canonicalize admitted streams to a separately capped uncompressed buffer before
  PDF.js. Define logical payloads, canonical bytes and finite scratch separately;
  remove the false universal configurable-allocation-cap implication.
- **R2 retained:** getTextContent accumulates before caller checks. Use the
  streaming API plus static conservative glyph/operator production admission for
  simple WinAnsi text, no Forms/CMaps/font overrides, with actual-pin tests for
  repeated operations, oversized strings and small-limit early refusal. Streaming
  itself is explicitly not a hard allocation cap.
- **R3 retained:** align JPEG's decimal-megapixel option with1048576 source pixels
  and require exact-boundary real-codec tests. Direct format decode avoids the
  review's additional EXIF auto-rotation implementation risk.
- **R4 retained:** ledger records proposed ADR-004 and next-unused ADR-005.
- Exact-pin modern PDF.js import and WinAnsi streaming succeeded without native
  canvas, external factories or WASM; details/failure correction are in
  author2 (archived evidence `runs/14-spec-author-2.md`). Fresh independent review of this corrected
  draft is pending; no implementation is authorized before autonomous freeze.
