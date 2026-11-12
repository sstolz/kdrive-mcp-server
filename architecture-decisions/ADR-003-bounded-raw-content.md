# ADR-003 — Bounded version-bound raw content

Design accepted by the frozen [F-007 v1](../features/F-007-bounded-downloads.md)
contract; implementation and actual-main acceptance remain pending #10.

## Context

Raw binary continuation and MCP resources need a reusable content contract
before extraction arrives. Public #5 range observations do not qualify atomic
strong-version semantics, and byte slices cannot represent complete images or
arbitrary extracted text. The current runtime has trusted injected dependencies
and no qualified production adapter.

## Decision

Use stateless byte offsets and a qualified normalized strong ETag for raw chunks.
Decode complete per-chunk base64 before concatenating bytes. Use one complete
application/octet-stream resource blob, sharing the same fresh read policy and
bounded reader. Require exact range/version evidence, precompute full output
overhead and refuse unsupported representations. Read retries are centralized,
pre-body only and cumulative with all invocation budgets.

## Options rejected (and why)

- Equal opaque observed tags: equality alone establishes no atomic version bound.
- Resource truncation or implicit text/image rendering: clients would receive an
  incomplete or ambiguous representation and could bypass later extraction limits.
- Buffered files/session content cursors: unnecessary retained content and state;
  explicit byte offset/version arguments suffice for raw continuation.
- Per-port independent retries: they multiply attempts and obscure shared bounds.

## Consequences

The production adapter must separately qualify its version and bounded streaming
assertions. Resources can refuse files that the raw tool can read over several
calls. Later extraction must explicitly extend/version the representation and
use character offsets without changing these byte semantics. This ADR proves no
provider access, production qualification, release or publication.
