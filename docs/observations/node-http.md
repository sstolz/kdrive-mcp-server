# Node HTTP observations

Durable knowledge about Node's `node:http` server, measured while building the
HTTP lifecycle hardening of this server (F-053). Each entry gives its date,
the method, the result and where its evidence is kept. These are observations
of one runtime version, not guarantees.

## Header limits

Method for every entry below: standalone `node:http` scripts, run in the dev
container on Node v26.13.0, with synthetic requests on the loopback interface.

### Header lines beyond `maxHeadersCount` are refused, not truncated

- Date: 2026-11-25.
- Method: a server with `maxHeadersCount` set to 2,000, and requests carrying
  2,000 and 2,001 header lines (`Host` included).
- Result: Node v26.13.0 does not truncate the extra lines. A request with
  2,000 lines reaches the request handler; a request with 2,001 lines gets
  Node's own 431 with an empty body, before the handler runs.
- Evidence: PR #140 verdicts 73-spec-v2-review-1-opus,
  73-spec-v2-decision-1-fable and 73-spec-v2-decision-2-fable; F-053 v2
  Context item 6 and D-4.

### `maxHeaderSize` counts names and values, not separators

- Date: 2026-11-25.
- Method: requests of empty-value header lines against a server with
  `maxHeaderSize` 16,384 bytes.
- Result: the limit counts name and value bytes only, not the `: ` and line
  terminators. About 16,300 empty-value lines fit in 16,384 bytes.
- Evidence: PR #140 verdict 73-spec-v2-decision-1-fable; F-053 v2 Context
  item 6.

### With `maxHeadersCount` 0, unterminated headers cost heap

- Date: 2026-11-25.
- Method: 250 concurrent connections, each holding an unterminated request
  head, with heap measured before and after.
- Result: with `maxHeadersCount` 0 (no limit), 250 connections holding about
  16,300 unterminated lines each cost about +84.7 MB of heap. With 2,000
  lines the cost is about +12 MB (empty values) to +23 MB (6-byte values).
- Evidence: PR #140 verdict 73-spec-v2-decision-2-fable; F-053 v2 D-4.

## Requests and abort signals

### A derived `Request` signal does not follow a dropped parent

- Date: 2026-11-25.
- Method: a `new Request(..., {signal})` built from another `Request`, the
  parent dropped and garbage-collected, then the original controller aborted.
- Result: the derived request's signal does not abort after the parent is
  dropped and garbage-collected; a disconnect signal must be passed
  explicitly rather than read from a derived `Request`.
- Evidence: PR #140 verdict 73-spec-v2-review-1-opus; F-053 v2 D-4.
