---
id: F-051
title: Transport edge cases
ticket: "#77"
status: draft
version: 1
---

## Context

Mutation callers need socket failures to produce a bounded settlement rather
than a process crash or a retained concurrency slot. Code reading of
`src/kdrive/transport.ts` suggests an error-listener gap: `handshake()` removes
its listener during `secureConnect`, before the awaited continuation invokes
`exchange()` and the HTTP request attaches its listener. This is a hypothesis,
not a reproduced crash. `exchange()` also has no request `close` handler;
an HTTP 101 without upgrade handling can close without a `response` or `error`
event and leave settlement dependent on the caller's abort.

`observe()` already runs before DNS and `connect` in both `hop()` and
`mutate()`. BR-216 v2's phrase “outgoing HTTP request” can therefore overstate
requests actually sent. The owner decided on 2026-11-24 to preserve that timing
and define the count as attempts, including failures before any bytes are sent.

This is full-path transport-contract work, not security-sensitive: it changes
neither authority nor credential, origin, address-policy or TLS admission.
BR-266 v2, BR-267 v1, BR-268 v2 and BR-269 v1 remain applicable. Existing
coverage is in `tests/kdrive-mutation-port.test.ts` (`TestBR267_*`,
`TestBR268_*`, including v2 terminal 429 cases) and
`tests/kdrive/adapter-origin.test.ts` (`TestBR216_*`, including observer
exceptions, read retries and redirect hops). There is no `test/` directory or
`features/README.md` index. This phase writes only this draft; no BR or code
changes, execution, review or freeze is claimed.

## Scope

1. Keep a permanent, payload-free socket `error` listener on each mutation
   socket immediately when `connect` returns and until destruction, including
   the handshake-to-request handoff and destruction cleanup. It neither logs
   nor exposes the error payload. Errors still settle the mutation: before
   handshake completion as branded `NotSent`, from completion onward as an
   unbranded `Error("MUTATION_UNKNOWN")`, even when no request listener exists
   yet. Prepare BR-438 v1 in the implementation phase.
2. Settle a mutation exchange immediately on request `close` if no `response`
   event has been received: reject with `MUTATION_UNKNOWN`, destroy its socket
   and release its limiter slot without waiting for abort or replaying. A 101
   upgrade without a normal `response` event counts as no response here;
   bytes arriving on the wire alone do not establish the raw-port result.
   A close after `response` retains BR-268 v2's status/body handling, including
   truncated bodies. Prepare BR-439 v1 in the implementation phase.
3. Version BR-216 to v3 to clarify observer counting while preserving its
   other provisions and existing read/mutation timing. A request attempt here
   begins when the transport enters its network phase after limiter admission
   and the existing pre-network abort check; queue refusal or cancellation
   before that point creates no request attempt. DNS/address-policy, connect
   and TLS failures after that point count even when classified `NotSent`.
   Clarify the count/bound comments and report documentation in
   `scripts/kdrive-acceptance.ts`, `scripts/kdrive-write-acceptance.ts`,
   `scripts/kdrive-upload-acceptance.ts` and `scripts/kdrive-info-acceptance.ts`
   as **request attempts**, including per-template/method counts. The first
   three currently say “request counts”; the info script exposes `requests`.
   Clarify the reporting instructions' “request count” in
   `docs/kdrive-read-probe-plan.md` and `docs/kdrive-write-probe-plan.md` to
   “attempt count”. No literal “requests sent” was found in the acceptance
   scripts or docs. Preserve report keys (`requests`, `requestsWithinBound`,
   `requests_within_bound`, `byTemplate`, `byRoute`) and numerical bounds;
   document them as attempt counts, which may over-count requests sent.
   Preserve historical observations and recorded totals.

### Out of scope

- Retries, new deadlines, BR-269 deadline semantics and any read-path behavior
  change; existing read retries and redirects are regression coverage only.
- New transport seams, error-payload logging, report-schema changes, releases
  or unrelated fixes. BR records and implementation belong to a later phase.

## Business rules

- **BR-438 v1** — Every mutation socket retains a payload-free permanent
  `error` listener from `connect` return through destruction so that every
  socket error is handled and settles a still-pending mutation under the
  BR-267 handshake boundary (`NotSent` before completion, `MUTATION_UNKNOWN`
  from completion onward). Verified by: AC-01–AC-02.
- **BR-439 v1** — A mutation request closing before any `response` event
  settles immediately as `MUTATION_UNKNOWN` with its socket destroyed and
  limiter slot released, without replay or waiting for abort.
  Verified by: AC-03.
- **BR-216 v3** — For reads and mutations, `onRequest(method, routeTemplate)`
  is called exactly once per request attempt before DNS and `connect`,
  including attempts ending before any byte is sent through DNS,
  address-policy, connection or TLS failure (`NotSent` for mutations), so its
  count may exceed requests sent. Verified by: AC-04–AC-05.

## Acceptance criteria

The names below are implementation targets, not passing-test claims. Preserve
the existing BR-216/267/268/269 characterization tests on the unchanged base;
exercise the new cases before implementation, then run `make check` and CI
through the orchestrator. Use injected transports and bounded synthetic tests,
not a real account. A test watchdog may fail a hanging test; it must not abort
the operation to obtain the expected settlement.

- **AC-01 (BR-438 v1)** — Given an injected mutation socket, when it emits
  `secureConnect` and immediately emits `error` in the same tick, before the
  handshake continuation can attach the request listener, then no uncaught
  exception occurs, the port rejects with unbranded `MUTATION_UNKNOWN`, and
  the gate returns `uncertain` / `UPSTREAM_UNCERTAIN`, `attempts:1`, without
  replay. Assert the permanent listener remains present through the handoff
  and cleanup and that a later cleanup error is handled without resettlement
  or error-payload output. Isolate crash detection from the test runner.
  This test must fail on current code if the hypothesized gap is real. If the
  crash cannot be reproduced, record that result without claiming a proven
  crash; the permanent listener is still required, and the test pins the
  absence of a crash and the unknown outcome. Verified by:
  `tests/kdrive-mutation-port.test.ts`,
  `TestBR438_v1_same_tick_secureConnect_error_is_unknown_without_crash`.
- **AC-02 (BR-438 v1)** — Given an injected socket before handshake completion,
  when it emits `error`, then the listener handles it without an uncaught
  exception or payload output, the port rejects with branded `NotSent`, the
  gate returns `failed` / `NOT_SENT`, and cleanup destroys the socket and
  releases the slot. Verified by: `tests/kdrive-mutation-port.test.ts`,
  `TestBR438_v1_pre_handshake_error_is_NotSent_without_crash`.
- **AC-03 (BR-439 v1)** — Given an injected transport with seven held mutations
  occupying seven of the eight slots, an eighth sent mutation, and a ninth
  queued mutation, when the eighth receives either (a) HTTP 101 with upgrade
  headers and no normal `response` event or (b) socket closure after its
  request is received with zero response bytes, then each case settles before
  any abort: the port rejects with unbranded `MUTATION_UNKNOWN`, the gate
  returns `uncertain` / `UPSTREAM_UNCERTAIN`, `attempts:1`, its socket is
  destroyed, and the ninth mutation proceeds and completes while the other
  seven remain held. Assert exactly one request for the eighth operation and
  no replay. Given instead a normal `response` followed by request close,
  when the exchange completes, then its known status and BR-268 v2 body
  handling remain intact. Verified by: `tests/kdrive-mutation-port.test.ts`,
  `TestBR439_v1_101_close_releases_slot_without_abort`,
  `TestBR439_v1_zero_byte_close_releases_slot_without_abort`,
  `TestBR439_v1_close_after_response_preserves_status`.
- **AC-04 (BR-216 v3)** — Given injected mutation attempts ending in DNS
  failure, address-policy refusal, connection failure or TLS handshake failure,
  when each attempt runs, then the observer is called once before lookup and
  any connect, receives only the method/template, and the port ends `NotSent`
  with zero request bytes sent; the gate returns `failed` / `NOT_SENT`.
  Given refusal or cancellation while queued before the network phase, when
  it ends, then no observer call occurs. Verified by:
  `tests/kdrive-mutation-port.test.ts`,
  `TestBR216_v3_pre_send_failures_observed_once_and_NotSent`,
  `TestBR216_v3_queued_refusal_or_abort_is_not_a_request_attempt`.
- **AC-05 (BR-216 v3)** — Given the existing read retry, redirect and throwing
  observer fixtures plus a DNS-failing read, when they run, then each entered
  request attempt is observed once before DNS/connect, including each existing
  retry and redirect hop, and observer exceptions leave results unchanged.
  Verified by: `tests/kdrive/adapter-origin.test.ts`,
  `TestBR216_v3_read_attempts_keep_pre_DNS_observation_and_results`.
  Also inspect Scope 3's script/docs wording: reported observer counts and
  bounds mean attempts, legacy keys and numerical bounds stay unchanged, and
  historical evidence is not rewritten.

## Decisions

- Allocate BR-439 rather than BR-268 v3: close without a response is a
  lifecycle/settlement rule, whereas BR-268 governs a received response's raw
  result and validation ownership. This preserves its purpose and accepted
  v2 contract; BR-439 supplies the missing terminal event under unchanged
  BR-267 classification. BR-438 separately covers continuous error handling.
- Keep observation before connect and DNS for both reads and mutations, per
  the owner decision of 2026-11-24; version BR-216 to v3 because its counting
  definition changes while its purpose remains. Reject observation after the
  handshake: it contradicts “before connect”, creates read/mutation asymmetry
  and risks under-counting attempts. Clarify wording rather than rename report
  fields or move the observer. Other BR-216 provisions remain unchanged.
- Retain the permanent listener even if the crash hypothesis is not reproduced;
  absence of a reproduction does not establish continuous listener coverage.
  Settlement on terminal events adds no deadline and never authorizes replay.
- Reserve F-051, BR-438 v1 and BR-439 v1 for this draft; recheck free IDs on
  main before freeze and PR creation. No ADR is needed for these local fixes.

## Open questions

## Stress-test
