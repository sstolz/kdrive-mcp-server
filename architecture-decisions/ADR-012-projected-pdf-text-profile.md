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

ADR-004 admits PDF text only from one classic cross-reference section with
fixed dictionary keys, one nonembedded Helvetica font in WinAnsiEncoding and a
fixed operator list, then gives PDF.js a canonical uncompressed copy of the
whole validated graph. A synthetic measurement (F-034 Context) refused 18 of
20 files, each carrying one feature that common generators emit, and showed
that the closed key, font and operator lists, not only the container, refuse
modern output. A probe showed that PDF.js 6.5.438 with the production options
extracts text from nonembedded TrueType and Type0/`ToUnicode` fonts without
their programs. Spec review 1 added text Form XObjects (OCR layers,
overlays, imposition, LaTeX figures, browser transparency groups), inline
images and pdfLaTeX Computer Modern fonts; the owner chose to admit them
(2026-11-14), and a second measurement (F-034 S21–S29) showed a canonical
projection reproducing the source text for each, while PDF.js given a
Computer Modern font without its program lost characters.

## Decision

Keep PDF.js 6.5.438 as the only PDF dependency and keep giving it a bounded
canonical document built by the preflight, but build that document as a
projection: read cross-reference tables and streams through a bounded `/Prev`
chain, object streams and indirect lengths by offset, with no scanning or
repair; decode only the streams text needs (page and Form content,
`ToUnicode`, object and cross-reference streams, the cleartext part of a
Type 1 program whose built-in encoding is needed, and Flate inline images
whose end must be found) with FlateDecode and PNG predictors under the
existing budget; emit only the page tree, resolved `MediaBox`, and for the
selected pages the fonts their content selects under canonical names
(without font programs, every shown code mapped explicitly, `ToUnicode`
re-emitted canonically) and one re-serialized content stream holding only
text operators, with every Form execution inlined and counted and inline
images skipped by a computed length (a Flate inline image inflated under the
smaller of that length and the remaining budget). Every bound is checked at
the canonical token that crosses it, before the projection goes further.
Everything else is left out. Type3
fonts, fonts whose shown codes have no mapping outside their program,
encryption, inline images of unknown length and other filters on needed
streams refuse.

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
- Emitting Form XObjects for PDF.js to execute: repeated executions would
  escape the static bound and their resources would need a second
  projection.
- Finding inline image ends by searching for `EI`: reader-dependent and a
  smuggling path.
- Another PDF library or native tools: the ADR-004 reasons hold.

## Consequences

Files from common generators (cross-reference and object streams,
incremental updates, metadata, structure, embedded subset fonts with
`ToUnicode`, pdfLaTeX Computer Modern fonts, text Forms, inline images of
known length, graphics around the text) become readable within the unchanged
F-009 ceilings plus the F-034 ceilings. Encrypted files, Type3 fonts,
predefined CMaps, CFF or symbolic TrueType fonts without a mapping outside
their program, simple fonts with a GBK name that PDF.js reads as composite, inline images of unknown length, damaged offsets and non-Flate
filters on text streams still refuse; the documentation points to
`kdrive_download`. The preflight grows (cross-reference streams, object
streams, a CMap reader, a Type 1 cleartext reader, encoding tables copied
from PDF.js and pinned by a test, Form inlining, a content re-serializer) and
remains security-sensitive code under the F-034 bounds. Text from fonts whose
only mapping is their program, other than a Type 1 cleartext encoding, is
refused rather than guessed.
