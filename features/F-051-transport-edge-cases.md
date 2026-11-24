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
BR-266 v2, BR-267 v1 and BR-269 v1 remain applicable; BR-268 v2 is
clarified as v3 below. Existing
coverage is in `tests/kdrive-mutation-port.test.ts` (`TestBR267_*`,
`TestBR268_*`, including v2 terminal 429 cases) and
`tests/kdrive/adapter-origin.test.ts` (`TestBR216_*`, including observer
exceptions, read retries and redirect hops). There is no `test/` directory or
`features/README.md` index. This phase writes only this draft; no BR or code
changes, execution, review or freeze is claimed.

## Scope

1. Keep a permanent, payload-free socket `error` listener on each mutation
   socket immediately when `connect` returns, never removed, including
   the handshake-to-request handoff and destruction cleanup. It neither logs
   nor exposes the error payload. Errors still settle the mutation: before
   handshake completion as branded `NotSent`, from completion onward as an
   unbranded `Error("MUTATION_UNKNOWN")`, even when no request listener exists
   yet. On its first error the listener records the error and destroys the
   socket; `exchange()` writes no request once an error is recorded.
   Prepare BR-438 v1 in the implementation phase.
2. Settle a mutation exchange immediately on request `close` if no `response`
   event has been received: reject with `MUTATION_UNKNOWN`, destroy its socket
   and release its limiter slot without waiting for abort or replaying. A 101
   upgrade without a normal `response` event counts as no response here;
   bytes arriving on the wire alone do not establish the raw-port result.
   A close after a final non-1xx `response` retains BR-268's status/body
   handling, including truncated bodies. Prepare BR-439 v1 and BR-268 v3
   in the implementation phase; BR-267 v1 owns the failure classification.
3. Version BR-216 to v3 to clarify observer counting while preserving its
   other provisions and existing read/mutation timing. An attempt is each
   entry into `hop()` (every read hop, retries and the redirect hop included)
   and each `mutate()` network phase after limiter admission and its abort
   check. Queue refusal or cancellation is not an attempt. `record()` has no
   pre-network abort check; its counting point is entry into `hop()`.
   DNS/address-policy, connect
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
- The 2026-11-16 item on #77: whether to change the 5,000 ms read deadline.
  This owner decision stays open on #77; #77 stays open after this PR merges.
- New transport seams, error-payload logging, report-schema changes, releases
  or unrelated fixes. BR records and implementation belong to a later phase.

## Business rules

- **BR-438 v1** — Every mutation socket retains a payload-free permanent
  `error` listener attached when `connect` returns and never removed. On the
  first error it records the error and destroys the socket; `exchange()`
  writes no request once an error is recorded. A pending mutation settles
  under BR-267 v1 (`NotSent` before handshake completion, `MUTATION_UNKNOWN`
  from completion onward). Verified by: AC-01–AC-02.
- **BR-439 v1** — A mutation request closing before any `response` event
  settles immediately under BR-267 v1 as `MUTATION_UNKNOWN` with its socket
  destroyed and limiter slot released, without replay or waiting for abort.
  Verified by: AC-03.
- **BR-268 v3** — The v2 rule applies only to a final non-1xx status line and
  headers delivered as a `response` event. A 101 upgrade with both
  `Connection: Upgrade` and `Upgrade:` is not such a response. Body validation,
  header bounds and terminal 429 handling remain unchanged. Verified by: AC-03.
- **BR-216 v3** — The v2 rule with only “once per outgoing HTTP request”
  replaced by “once per request attempt”. An attempt means each entry into
  `hop()` (every read hop, retries and the redirect hop included) and each
  `mutate()` network phase after limiter admission and its abort check.
  Queue refusal or cancellation is not an attempt. Pre-send DNS/address-policy,
  connection and TLS failures count, so counts may exceed requests sent.
  Verified by: AC-04–AC-05.

## Acceptance criteria

The names below are implementation targets, not passing-test claims. Preserve
the existing BR-216/267/268/269 characterization tests on the unchanged base;
exercise the new cases before implementation, then run `make check` and CI
through the orchestrator. Use injected transports and bounded synthetic tests,
not a real account. A test watchdog may fail a hanging test; it must not abort
the operation to obtain the expected settlement.

Expected base results: AC-01 is red if the hypothesized listener gap is real;
AC-03a is expected red for settlement/slot release before abort. AC-02,
AC-03b/c/d, AC-04 and AC-05 only pin current behavior. These are expectations,
not execution evidence; the orchestrator records the actual base results.

- **AC-01 (BR-438 v1, BR-267 v1)** — Given `connect` returning a loopback TLS
  socket and adding a `secureConnect` listener that schedules
  `process.nextTick(() => socket.destroy(new Error("x")))`, when TLS completes,
  this destroys the socket before the `await handshake` continuation. Then no
  uncaught exception occurs, the port rejects with unbranded `MUTATION_UNKNOWN`, and
  the gate returns `uncertain` / `UPSTREAM_UNCERTAIN`, `attempts:1`, without
  replay, and the server receives zero request bytes. Assert the permanent
  listener remains present through the handoff and cleanup and that a later
  cleanup error is handled without resettlement
  or error-payload output. Capture a crash with a test-scoped
  `process.prependOnceListener("uncaughtException", …)` removed in `finally`,
  or run the fixture in a child process to isolate it from the test runner.
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
- **AC-03 (BR-439 v1, BR-267 v1, BR-268 v3)** — Given all nine mutations
  using one transport instance, with seven held mutations
  occupying seven of the eight slots, an eighth sent mutation, and a ninth
  queued mutation, when the eighth receives either (a) HTTP 101 with both
  `Connection: Upgrade` and `Upgrade:` headers and no normal `response` event
  or (b) socket closure after its
  request is received with zero response bytes, then each case settles before
  any abort: the port rejects with unbranded `MUTATION_UNKNOWN`, the gate
  returns `uncertain` / `UPSTREAM_UNCERTAIN`, `attempts:1`, its socket is
  destroyed, and the ninth mutation proceeds and completes while the other
  seven remain held. Assert exactly one request for the eighth operation and
  no replay. Case (b) is pinning-only: base already settles through
  `socket hang up` and the request `error` handler. In (c), given a final
  non-1xx `response` followed by request close, when the exchange completes,
  then its known status and BR-268 v3 body handling remain intact, including
  a truncated body. In (d), given a bare 101 without either upgrade header,
  followed by close, then the gate returns `uncertain` / `UPSTREAM_UNCERTAIN`,
  `attempts:1`, without replay, and the socket and slot are released before
  abort as above. No final non-1xx response establishes a BR-268 v3 raw result.
  Its runtime event shape is unverified: pin the uncertain outcome, whether
  the port rejects as unknown or the parser exposes status 101 (which the gate's
  `classify()` in `src/mutation-gate.ts` also maps to uncertain).
  Verified by: `tests/kdrive-mutation-port.test.ts`,
  `TestBR439_v1_101_close_releases_slot_without_abort`,
  `TestBR439_v1_zero_byte_close_releases_slot_without_abort`,
  `TestBR268_v3_close_after_response_preserves_status`,
  `TestBR268_v3_bare_101_is_uncertain_without_replay`.
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

- Keep BR-439 for settlement timing and slot release, and version BR-268 to
  v3 for the final-response boundary. Reject BR-267 v2: BR-267 v1 already owns
  “close after handshake → MUTATION_UNKNOWN”; BR-439 only adds the timing
  rule. BR-438 separately covers continuous error handling.
- Plan History lines in the implementation phase (using its actual date):
  `v3 — YYYY-MM-DD — F-051 v1 (#77) — BR-268 raw-port results require a final
  non-1xx response event; 101 upgrades are excluded`; and
  `v3 — YYYY-MM-DD — F-051 v1 (#77) — BR-216 counts request attempts rather
  than outgoing HTTP requests; observation timing and other provisions unchanged`.
- BR-266 v2's “BR-216 v2 connect” reference need not move to v3: the `connect`
  provision is unchanged and that versioned reference remains accurate.
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

- **77-spec-review-1-opus / 1 — major — retained.** Separate timing from
  BR-267 v1 classification and version BR-268's response boundary; its
  former status-line wording also covered 101 upgrades.
- **77-spec-review-1-opus / 2 — major — retained.** Use the loopback TLS
  next-tick destruction ordering, scoped crash capture and zero-byte assertion
  so AC-01 exercises the handoff deterministically.
- **77-spec-review-1-opus / 3 — minor — retained.** Define listener lifetime,
  first-error recording/destruction and the no-write guard explicitly.
- **77-spec-review-1-opus / 4 — minor — retained.** Require both upgrade
  headers, distinguish zero-byte pinning, cover bare 101 conservatively and
  share one transport for all nine mutations to prove slot release.
- **77-spec-review-1-opus / 5 — minor — retained.** Limit BR-216 v3's change
  to attempt wording, define actual counting points without inventing a
  `record()` abort check, plan its History line and retain BR-266's valid reference.
- **77-spec-review-1-opus / 6 — minor — retained.** Name the dated read-deadline
  owner decision and keep #77 open after merge.
