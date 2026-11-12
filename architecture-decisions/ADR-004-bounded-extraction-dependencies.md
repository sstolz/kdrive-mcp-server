# ADR-004 — Pure-JavaScript bounded content extraction

Design accepted by independently frozen [F-009 v1](../features/F-009-bounded-content-reading.md),
ticket #14, reviewed SHA3fe07d92b75776fbfb4091b887a4c7839b5295ca on2026-11-03.
Implementation and actual-main acceptance remain pending.

## Context

Injected MCP clients need readable text, selected PDF text and complete resized
images. Native tools/codecs complicate reproducible Docker/package behavior.
A file-size cap alone cannot bound PDF/PNG decompression, parser CPU or base64
output. The existing raw content contract requires qualified strong source
versions, exact bounded readers and fresh policy; extraction cannot weaken it.

On2026-11-03, primary npm registry metadata queried through Docker dev/Make
reported `pdfjs-dist`6.5.438 and `@jimp/core`, `@jimp/js-png`, `@jimp/js-jpeg`,
`@jimp/plugin-resize`1.6.1. These exact versions are the proposed pins. PDF.js
supports the pinned Node26 runtime but declares optional `@napi-rs/canvas`;
installation omits optional native dependencies for the isolated runtime proof; extraction must not use
canvas, rendering or WASM. No dependency installation or runtime proof is claimed
by this proposal. A bounded exact-pin feasibility probe subsequently imported
`pdfjs-dist/build/pdf.mjs` and extracted `Hello bounded PDF €é` through its
streaming API without native canvas and with external factories trapped; see
author2 (archived evidence `runs/14-spec-author-2.md`). This is feasibility evidence, not product
implementation or acceptance.

## Decision

Use Node's strict TextDecoder plus explicit BOM/UTF-16 validation for text;
Mozilla PDF.js for text from a conservative completely preflighted PDF profile;
and minimal Jimp core, PNG/JPEG formats and resize modules for image decode,
nearest-neighbor resize and complete PNG encode. Pin exact versions and lock
transitives. Prove the executed runtime with dev/optional dependencies omitted;
preserve existing development npm-ci semantics, which can install inactive
optional canvas. Never import/use that native dependency in extraction. Do not register Jimp's URL
reader or unused formats/plugins. Output code points and complete images under
the full serialized MCP result ceilings.

Run all decode/preflight/extraction/encoding in an owned disposable worker with
parent-controlled deadline and termination. Explicit downloaded, UTF-8 decoded,
stream expansion, pixel, object, page and item bounds are primary controls;
worker V8 resource limits are secondary and do not bound external buffers.
Preflight every admitted PDF stream with length-framed classic-xref structure
and bounded Node inflate, then serialize the validated graph into a separately
capped canonical uncompressed PDF before calling PDF.js. Reject content arrays,
reused page streams, Forms and font mapping/embedding; admit simple Helvetica/
WinAnsi text operators with conservative production bounds and consume
streamTextContent rather than an accumulated whole page. Logical decoded bytes,
canonical bytes and finite scratch have distinct accounting; the configured
extract ceiling is not a total allocator/RSS guarantee. Reject unsupported
structures rather than invoking PDF.js repair. Preflight PNG scanlines/dimensions and JPEG
baseline dimensions/memory before invoking codecs. No external resources,
JavaScript, eval, OCR, rendering or WASM participates.

## Options rejected (and why)

- Native Poppler/ImageMagick/sharp or WASM codecs: outside the pure-JavaScript
  dependency requirement and unnecessary for this bounded injected feature.
- A broad convenience PDF wrapper: obscures PDF.js switches, lifecycle and
  optional dependencies without providing a public aggregate decompression cap.
- PDF.js alone with a timeout/heap cap: time/heap limits do not enforce decoded
  stream bytes, and worker external buffers are not covered by V8 limits.
- General PDF repair or regex stream scanning: alternate interpretations and
  delimiter-like binary content prevent credible pre-parser expansion admission.
- Full Jimp/default codecs: unnecessary format surface and decoder dependencies.
- Byte-sliced/base64-truncated image output: not a complete decodable MCP image.
- Retained extracted content/cursors: introduces confidential session state;
  explicit ETag/selection plus full bounded re-extraction keeps continuation clear.

## Consequences

Common PDFs with object/xref streams, indirect stream lengths, incremental
updates, encryption, predictor/filter chains, content arrays/reuse, Forms or non-profile font requirements
can refuse explicitly even when another PDF reader opens them. Only baseline
JPEG and noninterlaced8-bit RGB/RGBA PNG without ancillary chunks are admitted.
Compatibility is intentionally narrower than the dependencies' capabilities and
must be documented. Further compatibility requires reviewed contract versioning.
Every character continuation repeats complete download and extraction. No
production adapter, provider version qualification, release or publication follows.

Primary evidence read2026-11-03:

- [PDF.js initialization options](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)
  describe in-memory data, external resource factories, text-related options and
  disabled rendering features; no aggregate stream-expansion cap is exposed.
- [Jimp repository](https://github.com/jimp-dev/jimp) describes its JavaScript
  implementation and maintained modular project.
- [JPEG module source](https://raw.githubusercontent.com/jimp-dev/jimp/main/plugins/js-jpeg/src/index.ts)
  exposes resolution/memory and strict-decode options through jpeg-js.
- [PNG module source](https://raw.githubusercontent.com/jimp-dev/jimp/main/plugins/js-png/src/index.ts)
  delegates to pngjs and permits explicit CRC checks.
- [Node26 zlib options](https://nodejs.org/api/zlib.html#class-options) expose
  `maxOutputLength` for convenience methods and `rejectGarbageAfterEnd`.
- [Node26 worker options](https://nodejs.org/api/worker_threads.html#new-workerfilename-options)
  distinguish JavaScript-engine resource limits from external ArrayBuffers;
  termination enables a parent deadline during synchronous work.

Dependency audit and the scoped nested-Zod nonreachability assessment, including
its limitations, are recorded in development evidence (archived evidence `runs/14-development-2.md`).
No clean-audit or universal dependency-safety claim is made.
