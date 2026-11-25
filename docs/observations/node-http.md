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
- Evidence: PR #140 verdict 73-spec-v2-decision-2-fable and the
  orchestrator note on PR #140; F-053 v2 Context item 6.

### `maxHeaderSize` counts names and values, not separators

- Date: 2026-11-25.
- Method: requests of empty-value `x:` header lines against a server with
  `maxHeadersCount` 0 and `maxHeaderSize` 16,384 bytes.
- Result: 16,000 and 16,300 lines reached the handler; 17,000 got Node's 431. Conclusion drawn from those runs (not measured directly): the limit
  counts name and value bytes, not the `:` and line terminators.
- Evidence: PR #140 verdict 73-spec-v2-review-1-opus; F-053 v2 Context
  item 6.

### With `maxHeadersCount` 0, unterminated headers cost heap

- Date: 2026-11-25.
- Method: 250 concurrent connections, each holding an unterminated request
  head, with heap measured before and after.
- Result: with `maxHeadersCount` 0 (no limit), 250 connections holding about
  16,300 unterminated lines each cost about +84.7 MB of heap. With 2,000
  lines the cost is about +12 MB (empty values) to +23 MB (6-byte values).
- Evidence: PR #140 verdicts 73-spec-v2-decision-1-fable (+84.7 MB) and
  73-spec-v2-decision-2-fable (+12.0 MB and +23.1 MB); F-053 v2 D-5.

## Requests and abort signals

### A derived `Request` signal does not follow a dropped parent

- Date: 2026-11-25.
- Method: a `new Request(..., {signal})` built from another `Request`, run
  with `node --expose-gc`; the parent dropped and `gc()` run five times, then
  the original controller aborted.
- Result: the derived request's signal did not abort; a `Request` given the
  signal directly and kept referenced did abort. F-053 therefore passes the
  disconnect signal explicitly (design consequence, not a measurement).
- Evidence: F-053 v2 D-4.
