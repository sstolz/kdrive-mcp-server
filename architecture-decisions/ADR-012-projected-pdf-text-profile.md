# ADR-012 — Projected PDF text profile

Status: proposed (2026-11-14). Design of
[F-034 v1](../features/F-034-pdf-extraction-profile.md), ticket #4, ready for
freeze; implementation and acceptance pending. Supersedes, once accepted, the
PDF admission profile of
[ADR-004](ADR-004-bounded-extraction-dependencies.md) (the closed
classic-xref, Helvetica/WinAnsi, fixed-key profile of its Decision and the
matching Consequences); the rest of ADR-004 stands, as amended by
[ADR-010](ADR-010-direct-image-codecs.md) for images. ADR-004 keeps its text
unchanged (AGENTS.md §7); this ADR and `docs/spec-index.md` record the
supersession.

## Context

ADR-004 admits PDF text only from one classic cross-reference section with fixed
dictionary keys, one nonembedded Helvetica font in WinAnsiEncoding and a fixed
operator list, then gives PDF.js a canonical uncompressed copy of the whole
validated graph. A synthetic measurement (F-034 Context) refused 18 of 20 files,
each carrying one feature that common generators emit, and showed that the
closed key, font and operator lists, not only the container, refuse modern
output. A probe showed that PDF.js 6.5.438 with the production options extracts
text from nonembedded TrueType and Type0/`ToUnicode` fonts without their
programs. Spec review 1 added text Form XObjects (OCR layers, overlays,
imposition, LaTeX figures, browser transparency groups), inline images and
pdfLaTeX Computer Modern fonts; the owner chose to admit them (2026-11-14), and
a second measurement (F-034 S21–S29) showed a canonical projection reproducing
the source text for each, while PDF.js given a Computer Modern font without its
program lost characters. The spec decision pass added a third measurement (F-034
Measurement 3): inlining a Form moves PDF.js's line ends, PDF.js reads source
font names as hints that lose text (a Type0 font named `ArialMT` keeps one code
point per `ToUnicode` destination), and Type3 fonts and the ASCII filters are
common generator output (LibreOffice and cairo emoji, every ReportLab stream)
that a program-less projection and a small decoder read.

## Decision

Keep PDF.js 6.5.438 as the only PDF dependency and keep giving it a bounded
canonical document built by the preflight, but build that document as a
projection: read cross-reference tables and streams through a bounded `/Prev`
chain, object streams and indirect lengths by offset, with no scanning or
repair; decode only the streams text needs (page and Form content, `ToUnicode`,
object and cross-reference streams, the cleartext part of a Type 1 program whose
built-in encoding is needed, and Flate inline images whose end must be found)
with FlateDecode, PNG predictors and the ASCII85 and ASCIIHex filters under the
existing budget, counting a content or Form stream's decoded length again at
every reference and execution; emit only the page tree, resolved `MediaBox`, and
for the selected pages the fonts their content selects under canonical names,
used also as `BaseFont` except for the 12 standard Latin fonts (without font
programs, Type3 fonts as program-less simple fonts, every shown code mapped
explicitly through a glyph name PDF.js maps, the source base encoding name kept
only where PDF.js honours it, `ToUnicode` re-emitted canonically) and one
re-serialized content stream holding only text operators, with every Form
execution inlined and counted and inline images skipped by a computed length (a
Flate inline image inflated under the smaller of that length and the remaining
budget). Every bound is checked at the canonical token that crosses it, before
the projection goes further. Everything else is left out. Fonts whose shown
codes have no mapping that PDF.js reads outside their program, encryption,
inline images of unknown length and other filters on needed streams refuse.

## Options rejected (and why)

- Wider closed key lists: open-ended per generator; keeps refusing on keys
  text does not read.
- Passing source bytes to PDF.js after container checks: loses the static
  decoded-byte and text-production bounds; runs PDF.js filters, font parsers
  and repair on untrusted input.
- Parsing font programs, or keeping a Type 1 program for its built-in
  encoding: the largest parser surface for no text benefit once the
  cleartext encoding, an encoding dictionary or `ToUnicode` gives the
  mapping.
- Keeping source font names with a list of the names PDF.js treats
  specially: version-dependent and open-ended.
- Reading Type3 glyph procedures: a content interpreter per glyph for no
  text.
- Emitting Form XObjects for PDF.js to execute: repeated executions would
  escape the static bound and their resources would need a second
  projection.
- Finding inline image ends by searching for `EI`: reader-dependent and a
  smuggling path.
- Another PDF library or native tools: the ADR-004 reasons hold.

## Consequences

Files from common generators (cross-reference and object streams, incremental
updates, metadata, structure, embedded subset fonts with `ToUnicode`, pdfLaTeX
Computer Modern fonts, Type3 fonts, ASCII-filtered streams, text Forms, inline
images of known length, graphics around the text) become readable within the
unchanged F-009 ceilings plus the F-034 ceilings. Encrypted files, predefined
CMaps, CFF or symbolic TrueType fonts without a mapping outside their program,
glyph names PDF.js cannot map, inline images of unknown length, damaged offsets
and LZW, run-length or other filter chains on text streams still refuse; the
documentation points to `kdrive_download`. The preflight grows (cross-reference
streams, object streams, a CMap reader, a Type 1 cleartext reader, encoding
tables copied from PDF.js and pinned by a test, Form inlining, a content
re-serializer) and remains security-sensitive code under the F-034 bounds. The
expected text of a projected file is its own measured string, since inlining
moves PDF.js's line ends; a Type 1 program inflate is asynchronous, with its
one-chunk overshoot counted. A legacy file that names a GBK font but declares
`WinAnsiEncoding` now gives the declared WinAnsi reading instead of raw PDF.js's
composite-font guess. Text from fonts whose only mapping is their program, other
than a Type 1 cleartext encoding, is refused rather than guessed.
