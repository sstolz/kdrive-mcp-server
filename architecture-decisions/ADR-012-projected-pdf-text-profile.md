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
their programs.

## Decision

Keep PDF.js 6.5.438 as the only PDF dependency and keep giving it a bounded
canonical document built by the preflight, but build that document as a
projection: read cross-reference tables and streams through a bounded `/Prev`
chain, object streams and indirect lengths by offset, with no scanning or
repair; decode only the streams text needs (content, text-free Form check,
`ToUnicode`, object and cross-reference streams) with FlateDecode and PNG
predictors under the existing budget; emit only the page tree, resolved
`MediaBox`, and for the selected pages the fonts their content selects
(without font programs, `ToUnicode` re-emitted canonically) and a
re-serialized content stream holding only text operators. Everything else is
left out. Forms that show text, Type3 fonts, encryption and other filters on
needed streams refuse.

## Options rejected (and why)

- Wider closed key lists: open-ended per generator; keeps refusing on keys
  text does not read.
- Passing source bytes to PDF.js after container checks: loses the static
  decoded-byte and text-production bounds; runs PDF.js filters, font parsers
  and repair on untrusted input.
- Parsing font programs: the largest parser surface for no text benefit when
  an encoding or `ToUnicode` exists.
- Another PDF library or native tools: the ADR-004 reasons hold.

## Consequences

Files from common generators (cross-reference and object streams,
incremental updates, metadata, structure, embedded subset fonts with
`ToUnicode`, graphics around the text) become readable within the unchanged
F-009 ceilings. Encrypted files, text in Forms, Type3 fonts, predefined
CMaps, inline images, damaged offsets and non-Flate filters on text streams
still refuse; the documentation points to `kdrive_download`. The preflight
grows (cross-reference streams, object streams, a CMap reader, a content
re-serializer) and remains security-sensitive code under the F-034 bounds.
Text from fonts whose only mapping is their program is refused rather than
guessed.
