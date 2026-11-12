---
id: F-022
title: Quality Gate failure summary in the Sonar CI log
ticket: "#114"
status: done
version: 2
---

Author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-12.
Base: branch `claude/beautiful-maxwell-8mdk2w` from main `af31e99`; drafted
at `5c15db3`, reviewed through the Stress-test rounds below. IDs: F-022,
BR-328–BR-340, BR-146 v2; no ADR. Re-check before the PR.

## Context

When the Sonar Quality Gate fails, the `sonar` (main) and `sonar-pr` jobs log
only the scanner's `QUALITY GATE STATUS: FAILED`. Agents read CI logs but not
the dashboard: the host and the tokens are GitHub secrets (BR-145, BR-146), so
a failed gate cannot be diagnosed without the owner (#113: a literal U+202E in
fixtures failed the main gate and took an owner round trip to identify).

Users affected: agents and maintainers reading the `sonar` and `sonar-pr` job
logs. Product behaviour, the MCP server and its users are unaffected.

Owner decision 2026-11-12: reuse the existing analysis tokens, add no secret,
accept a degraded mode. A Project analysis token (Execute Analysis) can read
`api/ce/task` and `api/qualitygates/project_status`; `api/issues/search` needs
Browse, so issues may be unavailable until the owner replaces the tokens with a
user token holding Browse, which needs no code change.

### Server assumption

Assumed: SonarQube Server, edition and version unknown (not exposed to the
orchestrator); the v1 real run showed MQR-mode metric keys
(`software_quality_*`). The Web API usage is limited to parameters and fields
accepted by older and current servers, with tolerant fallbacks (BR-335,
BR-336); v2 adds `impactSoftwareQualities`, which only newer servers know,
and a server that ignores it gives the v1 unfiltered behaviour; a server that
rejects it answers 400, which prints the fixed issues stage line (BR-333,
residual risk accepted in D-13).

### Threat model

- T1 token exfiltration: a redirect or a non-validated host would carry the
  `Authorization` header elsewhere (BR-331).
- T2 secret disclosure in the log: host, token or a response body echoed in a
  failure line (BR-332, BR-146 v2).
- T3 log injection: issue messages and other server fields carrying controls,
  bidirectional overrides or line separators that spoof log lines or fail a
  later gate (BR-337).
- T4 resource exhaustion: oversized responses or a hanging server delaying the
  job or exhausting memory (BR-331, BR-332).
- T5 changed outcome: the summary turning a failure into a pass or altering
  CI wiring (BR-338, BR-339).

## Scope

1. A summary step in `scripts/sonar.ts` itself (no new module), so the
   existing BR-147 literal check over `scripts/sonar.ts` also covers the new
   code; it runs inside the existing analysis container after the scanner
   exits nonzero (BR-328–BR-338).
2. `scanOfficial` reads the scanner's task metadata file
   `<work>/runs/<runId>.txt` (`scripts/sonar.ts`, `metadataFilePath`) on a
   nonzero exit too (BR-329); `runAnalysis` calls the summary before returning
   the scanner code.
3. Unit tests in `tests/sonar-summary.test.ts` with an injected fake `fetch`.
4. `docs/development.md`, section "Conditional remote analysis": how to read
   the summary and the degraded mode (BR-340).
5. BR-146 v2 (redaction extended to the summary).

### Out of scope

- Any change to `.github/workflows/ci.yml`, `compose.yaml`, BR-015, BR-149,
  BR-150 or BR-151 (BR-339).
- New secrets, tokens or Sonar permissions; replacing the tokens (owner
  action, outside the repository).
- Printing source excerpts, code snippets, security hotspots, duplications or
  coverage details.
- A summary on a passing gate, or on the dashboard of local `make sonar` runs
  beyond what the same code path prints.

## Business rules

- **BR-328** — The summary runs only when the scanner exits nonzero and the
  analysis deadline has not expired; when the scanner exits 0, no summary line
  is printed and no request beyond the scanner's own is made. Verified by:
  AC-01, AC-02.
- **BR-329** — On a nonzero scanner exit, the task metadata is the content of
  `<work>/runs/<runId>.txt` (the scanner's `metadataFilePath`) when `lstat`
  reports a regular file (not a symbolic link) of at most 64 KiB, opened with
  `O_NOFOLLOW`, confirmed by `fstat` on the open handle as a regular file of
  at most 64 KiB, and read up to 64 KiB + 1 bytes (a read returning more than
  64 KiB is treated as absent), otherwise empty; the summary proceeds only when `verifyTaskMetadata(text, mode, host)`
  accepts it, else it prints exactly `Quality Gate summary unavailable: no
  verified task metadata.` and makes no request. `<projectKey>` and
  `<ceTaskId>` used below come only from the verified metadata. Verified by:
  AC-03.
- **BR-330** — The summary makes at most three requests, in order and each only
  after the previous one succeeded: `GET api/ce/task?id=<ceTaskId>` (success
  requires `task.status` = `SUCCESS` and a non-empty `task.analysisId`),
  `GET api/qualitygates/project_status?analysisId=<analysisId>`, then
  `GET api/issues/search`. Verified by: AC-04, AC-05.
- **BR-331** — Every request URL is built as `new URL("api/<fixed path>",
  base)`, where `base` is the URL accepted by `validHost` with a trailing `/`
  ensured and the fixed path is relative (no leading `/`), so a host path
  prefix such as `/sonar` is preserved; query values are encoded only through
  `URLSearchParams`. Each request uses `redirect: "error"`, sends
  `Authorization: Basic base64(token + ":")` and no other credential, and has
  its own 15 s timer that covers the headers and the whole body. Verified by:
  AC-06, AC-07, AC-20.
- **BR-332** — A response body is read as a stream with a byte counter and the
  read is cancelled as soon as the count exceeds 1 MiB; `Content-Length` is
  never trusted and `res.text()`/`res.json()` are never used on the raw
  response. Each request's abort controller is aborted when its stage ends,
  whatever the outcome, so no unread body keeps a socket open. A stage fails on a network error, abort or per-request timeout, a
  redirect, a non-2xx status, a body over 1 MiB, invalid JSON, or a missing or
  mistyped required field. Required fields: `task` stage — `task.status`
  (string) and, when it is `SUCCESS`, a non-empty string `task.analysisId`;
  `conditions` stage — `projectStatus.status` (string) and
  `projectStatus.conditions` (array whose items have string `status` and
  `metricKey`); `issues` stage — `issues` (array whose items have string
  `rule`, `component` and `message`). A failed stage prints exactly one fixed
  line `Quality Gate summary unavailable: <stage> stage failed.` or, when the
  response status is non-2xx, `Quality Gate summary unavailable: <stage> stage
  failed (HTTP <status>).`, with `<stage>` in `task`, `conditions`, `issues`; a
  missing or mistyped required field prints `Quality Gate summary unavailable:
  <stage> stage failed (unexpected response).`; a `task.status` other than
  `SUCCESS` (for example `PENDING`) prints the plain `task stage failed.`
  line, and a `SUCCESS` without a non-empty `analysisId` prints the
  `(unexpected response)` line. A 2xx response with an oversized body or
  invalid JSON prints the plain line. No such line contains a
  response body, URL, host or token. Exactly one line is printed per failed
  stage. Verified by: AC-05, AC-07, AC-17, AC-20.
- **BR-333** — When the issues request answers 401 or 403, the summary prints
  exactly `Quality Gate issues unavailable (HTTP <status>): the token may lack
  Browse permission on the project.` after the conditions already printed;
  this line replaces the BR-332 issues stage line, so exactly one line is
  printed for that stage. Any other non-2xx status on issues, including HTTP
  400 (for example a server rejecting `s=SEVERITY`), prints the BR-332 issues
  stage line. Verified by: AC-08, AC-17.
- **BR-334** — After a successful conditions stage, the summary prints
  `Quality Gate summary: <projectKey> status <projectStatus.status>`, then one
  line `- condition <metricKey> <comparator> <errorThreshold>: actual
  <actualValue>` per condition whose status is `ERROR`, at most 20, in server
  order, followed by `- <N> more conditions not shown` when more exist. The
  optional fields `comparator`, `errorThreshold` and `actualValue` print `-`
  when absent or not a string. Verified by: AC-04, AC-18.
- **BR-335** — The issues stage runs only when at least one condition has
  status `ERROR`; otherwise no issues request is made and no issues line
  prints. The issues request sends `componentKeys=<projectKey>`,
  `resolved=false`, `s=SEVERITY`, `asc=false`, `ps=20`, and adds
  `inNewCodePeriod=true` only when at least one condition failed and every
  failed condition's `metricKey` starts with `new_`. v2: it also adds a
  quality filter derived from the failed conditions. For each failed
  condition, the `metricKey` with a leading `new_` removed maps as follows:
  `software_quality_reliability_*` → impact `RELIABILITY`,
  `software_quality_security_*` → impact `SECURITY`,
  `software_quality_maintainability_*` → impact `MAINTAINABILITY`;
  `reliability_*` or `bugs` → type `BUG`; `security_rating`,
  `security_remediation_effort` or `vulnerabilities` → type `VULNERABILITY`;
  `maintainability_rating`, `technical_debt`, `sqale_*` or `code_smells` →
  type `CODE_SMELL`; any other key is unmapped.
  When every failed condition maps to an impact, the request adds
  `impactSoftwareQualities=<values>`; when every one maps to a type, it adds
  `types=<values>`; `<values>` are the distinct mapped values sorted and
  joined by `,`. When any failed condition is unmapped, or impacts and types
  are mixed, no quality filter is added. Issues are not bound to
  the analysed task: they are the project's current open issues, which for
  `kdrive-mcp-server-pr` may come from another pull request's latest analysis.
  Verified by: AC-09, AC-21.
- **BR-336** — After every successful issues stage, even with zero issues,
  the summary prints exactly
  `Quality Gate issues: current open issues of <projectKey> (may include
  another analysis of this project).`. The returned issues are first filtered:
  only those whose `component` equals `<projectKey>` or starts with
  `<projectKey>:` are kept, the others are dropped. Then the first 20 kept
  issues (even when the server returns more) each print as `- issue <severity> <type>
  <rule> <file>:<line> <message>`, where `<file>` is the `component` with a
  leading `<projectKey>:` removed, `:<line>` is omitted when `line` is absent
  or not a positive integer; when `severity` or `type` is absent, the pair
  `<severity> <type>` is replaced by the first 3 `impacts` items whose
  `softwareQuality` and `severity` are both strings, printed as
  `<softwareQuality>:<severity>` joined by `,`, or by `-` when there is none. The total is `paging.total`, falling back to `total`,
  else the number of kept issues; a total is used only when it is a
  non-negative integer number, otherwise the next source applies; when it exceeds the number of
  printed issues, the summary adds `- <total − printed> more issues not shown`. Verified by:
  AC-04, AC-10, AC-18.
- **BR-337** — Every server-supplied field is sanitized before printing, in
  this order: (1) escape — `\` becomes `\\`, and every `Cc` code point (C0, U+007F
  and C1),
  U+061C, U+200E–U+200F, U+202A–U+202E, U+2066–U+2069, U+2028, U+2029, every
  other Unicode `Cf`, `Zl` or `Zp` code point and every lone surrogate (`Cs`)
  becomes `\uXXXX` (four uppercase hex digits) when at most U+FFFF, else
  `\u{X…}` (uppercase hex, no padding); (2) redact — `redact(text, token,
  hostname)`; (3) truncate — `message` to 200 code points and any other field
  to 100, where the cut never splits an escape sequence or a `[REDACTED]`
  marker: if the limit falls inside one, the cut moves to its start. The
  output is unambiguous: a literal backslash is always `\\`. Verified by:
  AC-11, AC-16, AC-18.
- **BR-338** — The summary runs with its own timer of min(60 s, remaining time
  before the 900 s analysis deadline − 5 s), is not run under the outer
  analysis deadline abort path, and the process exit code after a summary
  always equals the scanner's nonzero exit code, returned by the summary path
  itself. Any exception inside the summary is caught and prints exactly
  `Quality Gate summary unavailable: internal error.`; a `fetch` that throws
  (synchronously or not) is a network error of its stage (BR-332), not an
  internal error. The timer is computed after the BR-329 metadata check: with
  unverified metadata only the no-metadata line prints; with verified metadata
  and a computed timer of 0 or less, the summary prints the time-limit line
  once, makes no request and returns the scanner code. When
  the summary timer
  expires, exactly one terminal line `Quality Gate summary unavailable: time
  limit reached.` prints; it takes precedence over the stage line of the
  aborted stage, which is then not printed. Verified by: AC-12, AC-19.
- **BR-339** — The feature changes neither `.github/workflows/ci.yml` nor
  `compose.yaml` (scope statement): both are byte-identical to the base, and
  the existing CI and Compose policy tests (`tests/ci-policy.test.ts`) pass
  unchanged. Verified by: AC-13.
- **BR-340** — `docs/development.md`, "Conditional remote analysis", lists the
  summary line formats, the degraded issues line, the token upgrade path (user
  token with Browse, no code change), and states that issue lines reflect the
  project's current open issues, which for `kdrive-mcp-server-pr` may include
  another pull request's latest analysis. Verified by: AC-14 and the unit
  test `BR-340 development docs`.

### Versioned rules

- **BR-146 v2** — BR-146 v1 holds unchanged, and in addition every line the
  Quality Gate summary prints passes through `redact(text, token, hostname)`,
  and its fixed messages never contain the host, the host file content, the
  token or a response body. Verified by: AC-07, AC-11, AC-15 (wiring only).

## Acceptance criteria

Unit tests live in `tests/sonar-summary.test.ts`, named `BR-3NN …`, with an
injected fake `fetch` and no network.

- **AC-01** (BR-328) — Given a scanner fake exiting 0 with valid metadata,
  When `runAnalysis` runs, Then it returns 0, the fake `fetch` records zero
  calls and no `Quality Gate summary` line appears. Verified by: `BR-328 no
  summary on a passing gate`.
- **AC-02** (BR-328) — Given a scanner fake exiting 2, When `runAnalysis`
  runs, Then the summary runs. Verified by: `BR-328 summary on nonzero exit`.
- **AC-03** (BR-329) — Given a nonzero exit and metadata missing, over 64 KiB,
  a symbolic link to a valid metadata file, a directory, with a wrong
  `projectKey`, a different `serverUrl` or an empty `ceTaskId`,
  When the summary runs, Then the only summary line is the no-metadata line
  and `fetch` records zero calls; the same holds when an injected file reader
  returns 64 KiB + 1 bytes after `lstat` and `fstat` reported at most 64 KiB.
  Verified by: `BR-329 unverified metadata`.
- **AC-04** (BR-330, BR-334, BR-336) — Given fakes answering a SUCCESS task,
  a project status with 2 `ERROR` and 1 `OK` conditions and 3 issues of
  total 25, When the summary runs, Then calls follow ce/task → project_status
  → issues, the header and 2 condition lines print, then the issues header
  line, 3 issue lines and `- 22 more issues not shown` follow.
  Verified by: `BR-334 conditions`, `BR-336 issues`.
- **AC-05** (BR-330, BR-332) — Given a task answering `PENDING`, When the
  summary runs, Then it prints exactly `Quality Gate summary unavailable: task
  stage failed.` and makes no further call; Given `SUCCESS` without
  `analysisId`, Then it prints exactly `Quality Gate summary unavailable: task
  stage failed (unexpected response).` and makes no further call. Verified by: `BR-330 incomplete task stops`.
- **AC-06** (BR-331) — Given hosts `https://sonar.example` and
  `https://example.test/sonar` (no trailing slash), When the fake inspects each
  call, Then the URL is the validated host with its path prefix preserved
  (`https://example.test/sonar/api/ce/task?…`) plus a fixed path, `redirect`
  is `"error"`, the only credential is the Basic header, and an injected
  `ceTaskId` containing `&`, `#` or `/` stays inside the `id` value. Verified
  by: `BR-331 request shape`.
- **AC-07** (BR-331, BR-332, BR-146 v2) — Given fakes returning 500 with a body
  naming the host and token, a redirect error, a `fetch` that throws
  synchronously (prints exactly `Quality Gate summary unavailable: task stage
  failed.` and no internal-error line), a streamed 1 MiB + 1 byte body
  with a falsely small `Content-Length`, invalid JSON, a wrong shape, and a
  request that never resolves, When each runs, Then exactly one fixed stage
  line prints (with `(HTTP 500)` only for the 500, `(unexpected response)` for
  the wrong shape), the oversized stream is cancelled after at most 1 MiB + one
  chunk, the hanging case ends within its 15 s timeout using fake timers, and
  no output contains the body, URL, host or token; after each stage ends, on
  success and on failure, the fake `fetch` records `signal.aborted === true`
  (success: the task and conditions stages that succeed before a failing
  issues stage, and a fully successful run).
  Verified by: `BR-332 stage failures`.
- **AC-08** (BR-333) — Given the issues fake answering 403 (and 401), When the
  summary runs, Then conditions print and are followed by the Browse
  permission line with the status, and no BR-332 issues stage line. Verified
  by: `BR-333 degraded issues`.
- **AC-09** (BR-335) — Given failed conditions all `new_*`, then one
  `new_reliability_rating` plus one `coverage`, When the issues request is
  built, Then `inNewCodePeriod=true` is present only in the first case and the
  other parameters equal BR-335; Given a project status with no `ERROR`
  condition, Then no issues request is made and no issues line prints.
  Verified by: `BR-335 issue query`.
- **AC-21** (BR-335 v2) — Given failed conditions
  (a) `software_quality_reliability_rating`;
  (b) `new_software_quality_security_rating` and
  `software_quality_reliability_rating`;
  (c) `new_reliability_rating` and `bugs`; (d) `sqale_rating` and
  `security_rating`; (e) `software_quality_reliability_rating` and
  `coverage`; (f) `reliability_rating` and
  `software_quality_reliability_rating`; (g) `security_hotspots_reviewed`;
  (h) `new_reliability_rating` and `new_bugs`; (i)
  `new_maintainability_rating` and `new_reliability_rating`,
  When the issues request is built, Then it carries
  (a) `impactSoftwareQualities=RELIABILITY`;
  (b) `impactSoftwareQualities=RELIABILITY,SECURITY`; (c) `types=BUG` and
  `inNewCodePeriod` absent; (d) `types=CODE_SMELL,VULNERABILITY`; (e), (f) and
  (g) neither `impactSoftwareQualities` nor `types`; (h) `types=BUG` and
  `inNewCodePeriod=true`; (i) `types=BUG,CODE_SMELL` and
  `inNewCodePeriod=true`; in every case the other parameters equal BR-335.
  Verified by: `BR-335 v2 quality filter`.
- **AC-10** (BR-336) — Given an issue without `line`, one whose component
  belongs to another project in a response of 2 issues with no `paging.total`
  or `total` (dropped, not printed; total falls back to 1 kept issue, so no
  `more issues not shown` line), a response of 25 issues whose first 5 belong
  to another project with no `paging.total` or `total` (20 issue lines, no
  `more issues not shown` line), one without `severity` and `type` but with
  `impacts` `[{softwareQuality: "MAINTAINABILITY", severity: "HIGH"},
  {softwareQuality: "RELIABILITY", severity: "LOW"}]`, one with neither
  `severity`/`type` nor `impacts`, one with 5 valid `impacts` items (only the
  first 3 print), one whose `impacts` items have non-string fields (`-`), a response with only `paging.total`, and
  one with only `total`, one with string `paging.total` "5" and `total` 7, and
  a response with zero issues, When printed, Then each follows BR-336, with
  these expected outputs: `MAINTAINABILITY:HIGH,RELIABILITY:LOW`; `-`; the
  string total is ignored and 7 is used; the zero-issue response prints the
  issues header and no issue line. Verified by: `BR-336 issue
  fields`.
- **AC-11** (BR-337, BR-146 v2) — Given a message containing U+007F, U+202E,
  U+2028,
  U+0085, `\n`, ESC, U+FEFF, a lone surrogate U+D800, U+E0001, a literal
  backslash followed by `u202E`, the host name in mixed case and the token,
  and a 250-code-point message, When printed, Then each listed BMP code point
  appears as `\uXXXX`, U+E0001 as `\u{E0001}`, the literal backslash as
  `\\`, the line holds no raw control, format or surrogate code point, host
  and token read `[REDACTED]`, U+007F appears as `\u007F`, and the message is
  cut to 200 code points. Verified by: `BR-337 sanitization`, `BR-146 v2
  summary redaction`.
- **AC-12** (BR-338) — (a) Given a scanner exit of 3, valid metadata, a
  `PENDING` task and a log sink that throws on the first summary line only,
  When `runAnalysis` runs, Then it returns 3, the internal-error line prints
  and no `task stage failed.` line is recorded. (b) Given a scanner exit of 3,
  valid metadata, 12 s left before the 900 s deadline (summary timer 7 s,
  below the 15 s per-request timer) and a ce/task `fetch` that never
  resolves, When `runAnalysis` runs (fake timers), Then it returns 3 and
  exactly one time-limit line prints, and no `task stage failed.` line. Verified by: `BR-338 exit code
  preserved`.
- **AC-13** (BR-339) — Given the PR diff, When `git diff --exit-code <base> --
  .github/workflows/ci.yml compose.yaml` and `make check` run, Then the diff
  is empty and the existing CI/Compose policy tests pass unmodified. Verified
  by: those commands, quoted in the PR.
- **AC-14** (BR-340) — Given the PR, When the reviewer reads `docs/
  development.md`, Then the section describes the formats, the degraded line
  and the upgrade path, and the test `BR-340 development docs` asserts the
  fixed line prefixes, the degraded-issues line and the Browse upgrade path
  appear in that section. Verified by: review and that test.
- **AC-15** (BR-328–BR-338, BR-146 v2) — Redaction and sanitization are proven
  by the unit tests (AC-07, AC-11, AC-16); the real run proves only the wiring,
  since GitHub already masks secrets as `***`. Rehearsal first: the
  AC-04/AC-08 fake run reproduces the expected log. Then, in the feature PR,
  Given a temporary commit adding one `String#charCodeAt` use in a `src/`
  file (rule S7758, learnings 2026-11-10), When `sonar-pr` runs, Then the
  job fails and its log shows the header, the failed conditions and either issue lines or the 403
  line, and neither host nor token; Given a following revert commit (no
  history rewrite), When `sonar-pr` runs, Then it passes and the log has no
  summary line. Verified by: the two job log links in the PR.
- **AC-16** (BR-337) — Given a message whose 200-code-point limit falls inside
  the token (which becomes `[REDACTED]`) and, separately, inside a `\u202E`
  escape, When printed, Then the cut moves to the start of the `[REDACTED]`
  marker (resp. the escape), no part of the token or a partial escape
  appears, and the output never exceeds 200 code points. Verified by:
  `BR-337 truncation boundaries`.
- **AC-17** (BR-332, BR-333) — Given the issues fake answering HTTP 400, When
  the summary runs, Then the conditions print followed by exactly
  `Quality Gate summary unavailable: issues stage failed (HTTP 400).` and no
  Browse line. Verified by: `BR-333 issues HTTP 400`.
- **AC-18** (BR-334, BR-336, BR-337) — Given 21 `ERROR` conditions, When
  printed, Then 20 condition lines and `- 1 more conditions not shown` print;
  given a server ignoring `ps` and returning 25 issues with `paging.total` 25,
  Then 20 issue lines and `- 5 more issues not shown` print; given a `rule`
  of 150 code points and a condition without `comparator`, Then the rule is
  cut to 100 code points and the comparator prints `-`. Verified by:
  `BR-334 caps`, `BR-336 caps`.
- **AC-19** (BR-338) — Given a scanner exit of 2 with 30 s left before the
  900 s analysis deadline, so the summary timer is 25 s, and a conditions
  request still pending when it expires (fake timers),
  When `runAnalysis` runs, Then it returns 2, exactly one line
  `Quality Gate summary unavailable: time limit reached.` prints, and no
  `conditions` stage line prints; Given 4 s left (timer 0 or less) and valid
  metadata, Then it returns 2, prints the time-limit line once and makes no
  request; Given 4 s left and unverified metadata, Then only the no-metadata
  line prints, no time-limit line, and `fetch` records zero calls. Verified
  by: `BR-338 deadline during summary`.
- **AC-20** (BR-331, BR-332) — Given a chunked body that sends one chunk and
  never ends, When the summary reads it, Then the per-request 15 s timer
  aborts the read and the stage line prints (fake timers). Verified by:
  `BR-332 endless body`.

## Decisions

- **D-1 — Same tokens, degraded issues.** Chosen (owner, 2026-11-12): no new
  secret; 401/403 on issues prints a fixed line. Rejected: a new Browse
  token secret (more secrets, owner provisioning first); skipping issues
  (loses the most useful part once a Browse token exists).
- **D-2 — In the analysis container, after the scanner.** Chosen: TypeScript
  in `scripts/`, reusing `validHost`, `verifyTaskMetadata` and `redact`, so
  the token and host stay inside the existing env allowlist. Rejected: a new
  workflow step or service (changes BR-015/BR-149–BR-151 and puts the token
  in another process); `curl` in shell (no shared redaction or sanitization).
- **D-3 — Only on a nonzero exit.** Keeps green logs and API traffic
  unchanged. Rejected: always printing (noise, extra calls on every run).
- **D-4 — Task, then conditions by `analysisId`.** Ties the conditions to the
  analysed task, not to whatever analysis is latest. Rejected:
  `project_status?projectKey=` (may report another run's analysis). Issues
  cannot be bound to an analysis; the header line and the docs say so
  (BR-335, BR-336, BR-340).
- **D-5 — Issue scope.** All unresolved issues sorted by severity; new-code
  only when every failed metric is `new_*`. v1 rejected mapping metrics to
  issue filters (fragile across server versions); v2 adopts a bounded mapping
  with an unfiltered fallback instead (D-13).
- **D-6 — Caps 20/20, 200/100 code points, 1 MiB, 15 s/60 s.** Bounds the
  log and the job time; `total` tells the reader what was cut.
- **D-7 — Escape, redact, then truncate on safe boundaries.** Escaping first
  neutralizes T3 and the #113 failure mode and makes the output unambiguous;
  redacting before truncation guarantees a token cut by the limit cannot
  survive as an unredacted fragment; truncation never splits an escape or a
  `[REDACTED]` marker. Rejected: truncate before redact (a cut token prefix
  escapes `redact`); dropping characters (hides evidence).
- **D-9 — `componentKeys`, not `components`.** `componentKeys` is accepted by
  older and current servers (deprecated, not removed); `components` is
  rejected because older servers lack it. `s=SEVERITY&asc=false` is kept; a
  server rejecting it answers 400, which prints the fixed issues stage line
  (BR-333, AC-17). Severity falls back to `impacts` for servers without
  `severity`/`type`.
- **D-13 — Quality filter on issues (v2).** The v1 real run (AC-15, PR #116,
  job 131024019873) printed 20 critical/major code smells under a failed
  `software_quality_reliability_rating` condition, while the seeded
  Reliability issue (S7758) was not among them: severity order alone does not
  show the issues behind the condition. Mapping each failed metric to its
  software quality (MQR) or legacy type narrows the list. Rejected: sending
  both `impactSoftwareQualities` and `types` (they combine with AND and the
  legacy type of a rule can differ from its impact); one request per
  condition (more requests and a longer log for a rare case). An unmapped or
  mixed set keeps the v1 unfiltered query, so no failure becomes silent.
- **D-10 — Own summary timer, outside the outer deadline abort.** The summary
  must return the scanner's code itself and print one terminal line; running
  under the outer abort path would let it end as a generic deadline failure.
  The 5 s margin keeps the summary inside the 900 s deadline. Residual risk,
  accepted: the host watchdog of `scripts/sonar-entry.sh` and the job's
  `timeout-minutes: 15` start earlier than `startedAt`, so in the last ~65 s
  either can pre-empt the summary; the job still fails (exit 1 or cancelled).
- **D-11 — Streamed body with a byte counter.** `Content-Length` can lie and
  `res.text()` buffers without bound; the 15 s timer covers the body so an
  endless chunked response cannot hang the stage.
- **D-12 — All code in `scripts/sonar.ts`.** Keeps the BR-147 literal check
  over that file applicable to the summary. Rejected: a new module (outside
  the existing check).
- **D-8 — No HTTP body in failure lines.** Only the numeric status; bodies may
  echo URLs or hosts.

## Open questions

## Stress-test

### Round 1 — reviewed SHA `5c15db3` (reviewer Opus 5.5, `114-spec-review-1-reviewer`)

1. Deadline interaction — retained: own timer min(60 s, remaining − 5 s),
   outside the outer abort path, scanner code always returned, one terminal
   time-limit line with precedence (BR-338, D-10, AC-19).
2. Truncation before redaction leaks token fragments — retained: order is
   escape → redact → truncate on escape/`[REDACTED]` boundaries (BR-337, D-7,
   AC-16).
3. Web API version assumptions — retained: server assumption recorded;
   `componentKeys` kept (`components` rejected, missing on older servers);
   total from `paging.total` then `total`; `impacts` fallback; HTTP 400 on
   issues prints the stage line (BR-333, BR-336, D-9, AC-10, AC-17).
4. Issues not bound to `analysisId` — retained: stated in BR-335, the issues
   header line (BR-336) and the docs (BR-340).
5. Body size and hang not enforced by `res.text()`/`Content-Length` —
   retained: streamed byte counter cancelled at 1 MiB, 15 s timer covers body
   (BR-332, BR-331, D-11, AC-07, AC-20).
6. Stage line ambiguity and undefined shape — retained: 401/403 line replaces
   the BR-332 line, required fields per stage listed, `(unexpected response)`
   line, optional fields print `-`, `<projectKey>` from verified metadata
   (BR-329, BR-332–BR-334).
7. Caps untested — retained: AC-18 (21 conditions, 25 issues ignoring `ps`,
   100-code-point non-message field).
8. Escape format ambiguous for astral code points, surrogates and backslash —
   retained: `\uXXXX` / `\u{X…}`, `Cs` escaped, `\` → `\\` (BR-337, AC-11).
9. Metadata path and symlink, host path prefix — retained: `runs/<runId>.txt`
   read via `lstat`, regular non-symlink ≤ 64 KiB; URLs built relative to a
   slash-terminated base, `/sonar` prefix tested (BR-329, BR-331, AC-03,
   AC-06).
10. New module escapes BR-147 literal check — retained: all code stays in
    `scripts/sonar.ts` (Scope 1, D-12).
11. AC-15 overclaims redaction proof — retained: unit tests prove redaction,
    the real run proves wiring only (GitHub masks secrets as `***`).

### Round 2 — reviewed SHA `f9b841d` (reviewer Opus 5.5, `114-spec-review-2-reviewer`, diff-only)

1. "(HTTP <status>)" also covered 2xx failures; PENDING/missing `analysisId`
   lines unspecified — retained: non-2xx only; exact lines in BR-332, AC-05.
2. Timer 0 or less undefined — retained: one time-limit line, no request
   (BR-338, AC-19).
3. Synchronous `fetch` throw is a stage network error, not internal — retained:
   BR-338 says so; AC-12 triggers the internal error with a throwing log sink.
4. Zero-issue output undefined — retained: header always prints after a
   successful issues stage (BR-336, AC-10).
5. `paging.total` type unchecked — retained: non-negative integer only, else
   fall back (BR-336, AC-10).
6. `lstat`-then-read race — retained: `O_NOFOLLOW`, `fstat`, bounded read
   (BR-329).

### Round 3 — reviewed SHA `623f694` (reviewer Opus 5.5, `114-spec-review-3-reviewer`, diff-only)

1. Synchronous `fetch` throw untested — retained: added to AC-07.
2. `fstat` check and size wording ambiguous, untested — retained: BR-329
   reworded; AC-03 adds the 64 KiB + 1 reader case.
3. Order of timer and metadata checks — retained: timer after BR-329, one line
   (BR-338).
4. AC-12 fakes unnamed — retained: `PENDING` task, sink throwing on first call.
5. AC-10 expected outputs unclear — retained: one list, string total case.

### Round 4 — reviewed SHA `a60746f` (reviewer Opus 5.5, `114-spec-review-4-reviewer`, diff-only)

1. AC-12 merged two incompatible runs — retained: split into cases (a) and (b).
2. Timer-versus-metadata order untested — retained: two 4 s cases in AC-19.

### Round 5 — reviewed SHA `db004f4` (reviewer Opus 5.5, `114-spec-review-5-reviewer`, diff-only)

1. AC-12(b) left the remaining time open, so the 15 s request timer could
   fire first — retained: 12 s left (summary timer 7 s).

### Decision pass — reviewed SHA `b9afbb6` (Fable 5.2, `114-spec-decision-1-reviewer`), verdict approve

1. Foreign-project issues printed under the header — retained: issues outside
   `<projectKey>` are dropped (BR-336, AC-10).
2. DEL (U+007F) not escaped — retained: every `Cc` (BR-337, AC-11).
3. Unbounded `impacts` join — retained: first 3 typed items (BR-336, AC-10).
4. Body not cancelled when a stage ends — retained: controller aborted at
   every stage end (BR-332).
5. Issues printed when no condition failed — retained: issues stage only with
   an `ERROR` condition (BR-335; AC-09 covers it).
6. BR-339, BR-340, BR-146 v2 without a named test — retained: BR-339 is a
   scope statement verified by the policy tests; `BR-340 development docs` and
   `BR-146 v2 summary redaction` tests named.
Residual risk (watchdog and job timeout pre-empting the summary near the
deadline) accepted in D-10.

### Decision-pass confirmation — reviewed SHA `51d008f` (Opus 5.5, `114-spec-review-6-reviewer`, diff-only)

1. AC-11 lacked U+007F in its Given — retained.
2. Controller abort untested — retained: AC-07 checks `signal.aborted`.
3. Kept/dropped counting ambiguous — retained: filter first, cap 20 on kept
   issues, fallback total counts kept issues; AC-10 gives the expected output.

### Final confirmation — reviewed SHA `4e760c1` (Opus 5.5, `114-spec-review-7-reviewer`, diff-only), verdict approve

Two non-blocking minors folded in at freeze as additional AC cases, no rule
change: filter-before-cap case (AC-10) and the successful stages checked for
`signal.aborted` (AC-07).

### Freeze

Frozen 2026-11-12 by the orchestrator (autonomous mode, PROJECT.md D-1) on the
reviewed SHA `4e760c1` plus the two AC cases above. Evidence: strong-tier
approve (`114-spec-review-7-reviewer`), strongest-tier decision pass approve
(`114-spec-decision-1-reviewer`), no open question. IDs F-022 and
BR-328–BR-340 re-checked free against main `af31e99`.

### Version 2 inputs — AC-15 real run (PR #116, seed head `0f5041e`)

The summary printed (header, condition
`software_quality_reliability_rating GT 1: actual 2`, issues header, 20
issues, `- 30 more issues not shown`) with no host or token in the log; the
token can read issues. The 20 issues were all code smells, so the seeded
Reliability issue was hidden. v2 adds the BR-335 quality filter (D-13,
AC-21). The rest of v1 is unchanged.

### Version 2, round 1 — reviewed SHA `1149086` (Opus 5.5, `114-spec-review-8-reviewer`, diff-only)

1. D-5 contradicted D-13 and the server assumption was stale — retained: both
   amended.
2. `maintainability_rating` and `technical_debt` unmapped — retained: mapped
   to `CODE_SMELL`; AC-21 case (i).
3. No case with `inNewCodePeriod` — retained: AC-21 case (h), other
   parameters unchanged.
4. Header does not say the list is filtered — rejected: the BR-336 header
   already says "current open issues", the condition lines just above name
   the qualities, and changing the header would bump BR-336 for little gain.

### Version 2, round 2 — reviewed SHA `c61f9ad` (Opus 5.5, `114-spec-review-9-reviewer`, diff-only), verdict approve

One minor folded in at freeze: a server rejecting `impactSoftwareQualities`
answers 400 and prints the issues stage line (server assumption).

### Freeze v2

Frozen 2026-11-12 by the orchestrator (autonomous mode) on reviewed SHA
`c61f9ad` plus that sentence. No strongest-tier spec pass on the v2 delta: it
changes only issue-query parameters, adds no request, credential, output or
bound, so it opens no new security surface; the strongest-tier code pass
before merge covers it. No open question.
