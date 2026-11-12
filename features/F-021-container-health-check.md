---
id: F-021
title: Container health check for the HTTP runtime
ticket: "#105"
status: done
version: 1
---

Author: Claude Opus 5.5 (effort unknown), spec phase, 2026-11-11.
Base: branch `claude/beautiful-maxwell-8mdk2w` at `b0a6f4f`. IDs: F-021,
BR-322–BR-327 (BR-291 and BR-305–BR-311 stay reserved for #109); no ADR.
Re-check before freeze and before the PR.

## Context

The runtime image has no `HEALTHCHECK` (`docs/deployment.md`, Current status;
F-013 D-07 deferred it "until the HTTP runtime" exists, which F-014 delivered).
Docker, Compose (`depends_on: condition: service_healthy`) and orchestrators
therefore cannot tell a hung server from a healthy one, and the 0.6 public
beta needs a liveness signal.

Users affected: operators running the runtime image in HTTP mode (personal
server guide, Compose example, any orchestrator); MCP clients are unaffected.
stdio mode is unaffected as a protocol; a stdio run of the runtime image sees
the image's health check and is documented (BR-187 v3).

Today every route except the MCP endpoint is an OAuth route, and insecure
mode has no unauthenticated GET at all (BR-168). The PRM route needs the
public `Host` (BR-156), which a fixed in-image command cannot know when the
deployment uses `--config` instead of environment variables. A dedicated
route with a narrow loopback `Host` allowance solves both.

## Scope

1. A dedicated `GET /healthz` route in the F-012 handler, in authenticated
   and insecure modes, with a constant body, behind the existing ordering
   (shutdown 503, target length 414, `Host` 403, route 404, method 405,
   framing 413), its own two process-wide windows (loopback and public
   `Host`) and no authentication, session, store, upstream or kDrive work
   (BR-322–BR-325).
2. A probe module `src/healthcheck.ts`, compiled to `dist/healthcheck.js`
   (BR-326), using only `node:http`; no tool is added to the image.
3. `HEALTHCHECK` in the `runtime` stage of `Dockerfile` (BR-327); `smoke`
   inherits it.
4. `make image-smoke` proves the instruction, the route, Docker's `healthy`
   state and a failing probe (BR-180 v2, BR-181 v2).
5. `examples/compose.yaml` comment and `docs/deployment.md` (BR-184 v2,
   BR-187 v3).
6. Records in the feature PR, marked pending: BR-322–BR-327 files, the
   versioned BR files, `business-rules/README.md`, `docs/spec-index.md`
   (including its "next identifier" sentence), `capability-map.md`,
   `CHANGELOG.md` (Added: the route and the probe; Changed: behind Traefik,
   routing now waits for `healthy`), and `docs/observations/traefik.md`
   (D-7's Traefik health behaviour: date, source, result).

### Out of scope

- Readiness: checking kDrive, the upstream IdP, the OAuth state store or the
  audit log. A dependency outage must not make an orchestrator restart the
  server, and the route must not trigger outbound calls (D-2).
- Metrics, version, uptime or any other body content (D-3).
- A health signal for stdio mode, and any change to stdio behaviour.
- Kubernetes manifests, Helm charts or Swarm examples; the docs only state
  how an `httpGet` probe sets `Host` (BR-187 v3).
- `--health-start-interval` (Docker Engine ≥ 25 only) (D-6).
- A new configuration setting or environment variable (D-5).
- Publishing an image, a registry, a release.
- Changing BR-156 for any route other than `/healthz`.

## Business rules

### Route

- **BR-322** — The handler has a route `/healthz` (route name `health`) in
  authenticated and insecure modes. It is added after every route that exists
  today, so when the MCP endpoint path is exactly `/healthz` the MCP route
  keeps the path and no health route exists. A request whose path is exactly
  `/healthz` (any query string) is answered by the first rule that applies,
  in this order: (1) while the server closes, BR-169's 503
  `temporarily_unavailable`; (2) a target over BR-169's 8,192 bytes, 414
  `invalid_request`; (3) a `Host` refused by BR-324, 403 `invalid_host`; (4)
  any method other than `GET`, `HEAD` included, 405 `method_not_allowed` with
  `Allow: GET`; (5) a `Content-Length` that is not all zeros, or any
  `Transfer-Encoding`, BR-160's 413 `payload_too_large` with `connection:
  close` (the existing no-limit framing check); (6) a full BR-325 window, 429
  `rate_limited`; (7) otherwise status 200. A path other than an existing
  route's (for example `/healthz/` or `/HEALTHZ`) still yields 404
  `not_found` after the `Host` check, as today. The handler's `Response` for
  the 200 has exactly the headers `content-type: application/json`,
  `cache-control: no-store` and `x-content-type-options: nosniff` and the
  15-byte body `{"status":"ok"}`; on the wire, the BR-170 adapter and
  `node:http` add only their usual `content-length`, `date`, `connection` and
  `keep-alive`. Verified by: AC-01, AC-02.
- **BR-323** — The `/healthz` response does not depend on `Authorization`,
  `Cookie`, `Origin`, `Mcp-Session-Id`, the query string, the number of
  sessions, the OAuth state or the mode: it never calls the token verifier,
  the OAuth proxy, the upstream port, the OAuth state store, the session
  registry or any kDrive port, reads no request body, sets no cookie and
  emits no logger event when it returns 200. Verified by: AC-03.

### Host and rate limit

- **BR-324** — For a target path equal to `/healthz` (when BR-322's route
  exists), the BR-156 v2 `Host` check also passes, case-insensitively, the
  loopback forms `127.0.0.1`, `localhost` and `[::1]`, each bare or followed
  by `:` and 1 to 5 ASCII digits. Every other `Host` (absent, empty,
  repeated, another name, an IP other than these) yields 403 `invalid_host`
  before any BR-325 window is counted. Verified by: AC-04.
- **BR-325** — Two process-wide windows bound `/healthz`, each 120 requests
  per 60 seconds: `health_loopback` counts requests whose `Host`, lowercased,
  is a BR-324 loopback form (even when it is also an accepted public form),
  and `health_public` counts every other accepted `Host`. A request is
  counted in its window only after it passes checks (1)–(5) of BR-322;
  requests refused by those checks or by 429 are not counted. A full window
  refuses only its own requests, with 429 `rate_limited`, `Retry-After` (the
  seconds until that window ends) and one `request_refused` event with
  `route` `health`. Verified by: AC-04, AC-05.

### Probe and image

- **BR-326** — `node /app/dist/healthcheck.js` (source `src/healthcheck.ts`)
  imports only `node:http`, reads only the environment variable
  `MCP_HTTP_PORT`, reads no file and opens no other connection; it sends the
  request through a dedicated `http.Agent` with no proxy, so proxy variables
  (`NODE_USE_ENV_PROXY`, `HTTP_PROXY`, `NO_PROXY`) never redirect it. The port is
  3000 when `MCP_HTTP_PORT` is unset; otherwise it is parsed exactly as the
  server's own `integer` parser (`src/config-schema.ts`): the value matches
  `^\d+$` and its number is a safe integer from 1 to 65535 (so `03000` is
  port 3000), else the probe fails with code `port` without connecting. It
  sends one `GET /healthz` to `127.0.0.1:<port>` with `Host:
  127.0.0.1:<port>` (the parsed number), no credential and no cookie, follows
  no redirect, and reads at most 1,024 body bytes within a 5,000 ms deadline
  measured from the start of the request. It exits 0 with no output when the
  status is 200 and the body is exactly `{"status":"ok"}`, or when the status
  is 429 and the body is exactly `{"error":"rate_limited"}`. Otherwise it
  writes exactly one line `healthcheck failed: <code>` to stderr and exits 1,
  with `<code>`: `port` for an invalid port; `connection` when the connection
  fails, is reset, closes before the complete response, or the response
  cannot be parsed as HTTP; `timeout` when the
  deadline passes before the status line or before the end of the body;
  `status` for any status other than 200 and 429 (3xx included); `body` for
  a 200 or 429 whose body differs from the expected one or exceeds 1,024
  bytes. Verified by: AC-06.
- **BR-327** — The `runtime` stage of `Dockerfile` has exactly one
  `HEALTHCHECK` instruction, exactly `HEALTHCHECK --interval=10s --timeout=10s
  --start-period=30s --retries=3 CMD ["node", "/app/dist/healthcheck.js"]`
  (exec form, no shell); the `smoke` stage has no `HEALTHCHECK` and inherits
  it. The runtime stage keeps BR-173's only `RUN` (the Node version test):
  no package manager, `curl` or `wget` is added. Verified by: AC-07.

### Versioned rules

- **BR-154 v2** — v1 holds, and the route table also contains `/healthz`
  (GET) per BR-322; a non-GET method on it yields 405 with `Allow: GET`.
  Verified by: AC-01.
- **BR-156 v2** — v1 holds for every route except the BR-324 loopback
  allowance on `/healthz`. Verified by: AC-04.
- **BR-162 v2** — v1 holds, and the process-wide windows also include
  `health_loopback` and `health_public`, 120 per 60 seconds each (BR-325). A
  `/healthz` request has no body to read; it is counted only after the
  shutdown, target-length, `Host`, method and framing checks of BR-322 pass,
  and a request refused by one of those checks or by 429 is not counted.
  Verified by: AC-05.
- **BR-167 v2** — v1 holds, and `request_refused` `route` may also be
  `health`; a 200 `/healthz` response emits no event. Verified by: AC-03,
  AC-05.
- **BR-168 v2** — v1 holds, except that in insecure mode the `/healthz`
  route of BR-322 also exists (still no OAuth or PRM path). Verified by:
  AC-02.
- **BR-180 v2** — v1 holds, with two changes: the smoke container's launch
  adds exactly `--health-interval=2s` after the hardening flags (the image's
  health command, timeout, start period and retries apply); and one extra
  runtime-image container runs `--entrypoint node
  kdrive-mcp-server:runtime-<arch> /app/dist/healthcheck.js` with the same
  flags and no server. Verified by: AC-08.
- **BR-181 v2** — v1 holds, and a run passes only when also: (7) `docker image
  inspect` of both the runtime and the smoke image reports health test
  `[CMD node /app/dist/healthcheck.js]`, interval `10s`, timeout `10s`, start
  period `30s` and retries `3`; (8) inside the smoke container, `node:http`
  GETs on `/healthz` with `Host: 127.0.0.1:3000` and with the public URL's
  `Host` each return `200|application/json|{"status":"ok"}`, and with `Host:
  attacker.example` return 403; (9) `docker inspect` reports the smoke
  container's `.State.Health.Status` as `healthy` within 30 s after check
  (1)'s `http-acceptance listening on` line appears; (10)
  the BR-180 v2 no-server probe container exits 1 and its log is exactly
  `healthcheck failed: connection`. Checks (7)–(10) run before the SIGTERM
  check. Verified by: AC-08, AC-09.
- **BR-184 v2** — v1 holds, and the service has no `healthcheck` key (the
  image's `HEALTHCHECK` applies, reading `MCP_HTTP_PORT: "3000"`) and a
  comment line containing `HEALTHCHECK` and `docs/deployment.md`. Verified
  by: AC-10.
- **BR-187 v3** — v2 holds with these changes: the required sections add
  `Health check`; Current status states "The runtime image has a
  `HEALTHCHECK`" and no longer contains "It has no `HEALTHCHECK`"; the
  Health check section (phrases are case-sensitive substrings, as in v2)
  states:
  - what is checked: `/healthz`, `node /app/dist/healthcheck.js`,
    `127.0.0.1`, `MCP_HTTP_PORT` and `liveness`;
  - `--no-healthcheck` (for stdio and one-shot runs of the image);
  - `Traefik` and `healthy`: Traefik's Docker provider routes to the
    container only once Docker reports it `healthy`, so the service is
    unreachable for up to one interval after each (re)start;
  - when the image's probe fails and `healthcheck.test` must be overridden
    in Compose (or `--no-healthcheck` used): an MCP endpoint at `/healthz`
    (the MCP route keeps the path and the probe fails); an effective port
    that differs from `MCP_HTTP_PORT` (3000 when unset), that is `--port`, or
    a `port` in `--config` without the variable; an `MCP_HTTP_HOST` not
    reachable at `127.0.0.1`, for example `::1` or a specific address;
  - troubleshooting: a Traefik 404 or a container stuck `starting` or
    `unhealthy` is diagnosed with `docker inspect --format
    '{{json .State.Health}}'`, whose log shows `healthcheck failed: <code>`;
  - for orchestrators: an `exec` probe running `node
    /app/dist/healthcheck.js` is recommended, with `timeoutSeconds` of at
    least 10 (the default 1 s is too short for a Node start); an `httpGet`
    probe must set `Host: localhost` (or the public `Host`) through
    `httpHeaders`, because its default `Host` (the pod IP) gets 403
    `invalid_host`; probes and monitors use `GET` (`HEAD` gets 405);
    `httpGet` counts `429` as failure, and each `Host` class allows 120
    requests per minute, for example two probes at 1 s or up to 20 at 10 s,
    shared with any other probe in the same class.

  Only these new substrings are required in the last three bullets: `--port`,
  `docker inspect`, `.State.Health`, `healthcheck failed:`, `httpHeaders`,
  `invalid_host`, `timeoutSeconds` and `GET`; the rest of their wording is
  non-normative.

  The `### 7. Verify` subsection of "Personal server, step by step" (the
  text from that line up to the next line starting with `#`) contains
  `docker compose ps` and `healthy`: it says to wait until `docker compose
  ps` shows the service `healthy` before the checks. Verified by: AC-10.

## Acceptance criteria

Handler tests drive `createHttpHandler` / the F-012 server with the existing
fakes (clock, verifier, upstream, logger spies); no test contacts a network
host other than loopback.

- **AC-01** (BR-322, BR-154 v2) — Given an authenticated-mode handler with
  public URL `https://mcp.example.com/mcp`, When `GET /healthz`, `GET
  /healthz?x=1` and a `GET /healthz` with `Content-Length: 0` arrive with the
  public `Host`, Then each returns 200 whose handler `Response` has exactly
  the three BR-322 headers and body `{"status":"ok"}`; When `HEAD`, `POST`,
  `DELETE` or `PUT` arrive on `/healthz`, Then 405 with `Allow: GET`; When a
  `GET /healthz` arrives with `Content-Length: 5` and a body, or with
  `Transfer-Encoding: chunked`, Then 413 `payload_too_large` with
  `connection: close`; When a `/healthz?` target over 8,192 bytes arrives,
  Then 414; When `/healthz/` or `/HEALTHZ` arrive, Then 404; Given public URL
  `https://mcp.example.com/healthz`, When `GET /healthz` arrives, Then the MCP
  route answers (405 `Allow: POST, DELETE`); Given the server closing, Then
  503 `temporarily_unavailable`; over the real F-012 server, the 200's wire
  headers are the three BR-322 headers plus only `content-length`, `date`,
  `connection` and `keep-alive`. Verified by: `tests/http/health.test.ts`,
  `tests/http/routes.test.ts` (`TestBR322_...`, `TestBR154_...`).
- **AC-02** (BR-322, BR-168 v2) — Given an insecure-mode server on
  `127.0.0.1`, When `GET /healthz` arrives with `Host: localhost:<port>`, Then
  200 with the BR-322 body; the PRM and OAuth paths still yield 404. Verified
  by: `tests/http/insecure.test.ts` (`TestBR168_...`).
- **AC-03** (BR-323, BR-167 v2) — Given verifier, proxy, upstream, store,
  registry and logger spies, When `/healthz` is requested with and without a
  valid and an invalid `Authorization`, a `Cookie`, an `Origin:
  https://attacker.example`, an `Mcp-Session-Id`, with zero and with open
  sessions, Then every response is byte-identical, no spy is called, no
  `Set-Cookie` is present and the logger receives no event; the BR-167
  secrecy scan over these responses finds no secret. Verified by:
  `tests/http/health.test.ts`, `tests/http/secrecy.test.ts`
  (`TestBR323_...`, `TestBR167_...`).
- **AC-04** (BR-324, BR-156 v2) — Given the authenticated handler, When
  `/healthz` arrives with `Host` `127.0.0.1`, `127.0.0.1:3000`,
  `LOCALHOST:65535`, `[::1]:8080` or the public host, Then 200; When it
  arrives with no `Host`, an empty one, two `Host` headers, `127.0.0.2`,
  `127.0.0.1:123456`, `127.0.0.1:`, `10.0.0.1:3000` or `attacker.example`,
  Then 403 `invalid_host` and no `/healthz` window is counted; a 200 with a
  loopback `Host` counts only in `health_loopback` and one with the public
  `Host` only in `health_public`; When `GET
  /.well-known/oauth-protected-resource/mcp` or `POST /mcp` arrive with
  `Host: 127.0.0.1:3000`, Then 403 `invalid_host` as before. Verified by:
  `tests/http/host-origin.test.ts` (`TestBR324_...`, `TestBR156_...`).
- **AC-05** (BR-325, BR-162 v2, BR-167 v2) — Given a fixed clock, When 120
  `/healthz` GETs with the public `Host` arrive, Then all return 200; the
  121st returns 429 `rate_limited` with `Retry-After: 60` and one
  `request_refused` event `{route: "health", status: 429, error:
  "rate_limited"}`, while a GET with `Host: 127.0.0.1:3000` still returns
  200; symmetrically, 120 loopback-`Host` GETs fill `health_loopback` and a
  public-`Host` GET still returns 200; a 405, a 403, a 414 and a 413 (GET
  with a body) are not counted, nor is a 429; after 60 s a GET returns 200;
  the OAuth windows are unchanged. Verified by:
  `tests/http/rate-limits.test.ts`
  (`TestBR325_...`, `TestBR162_...`).
- **AC-06** (BR-326) — Given the built `dist/healthcheck.js` spawned with a
  controlled environment, When a loopback test server on an ephemeral port
  (passed as `MCP_HTTP_PORT`) answers 200 `{"status":"ok"}`, or 429
  `{"error":"rate_limited"}`, Then exit 0 and no output, and the server saw
  one `GET /healthz` with `Host: 127.0.0.1:<port>` and no `Authorization` or
  `Cookie`; When `MCP_HTTP_PORT` is the port prefixed with `0` (as
  `03000` is for 3000), Then exit 0 and `Host` carries the unpadded number;
  When it answers 200 with another body, 200 with a body over 1,024 bytes,
  429 with another body or 429 with a body over 1,024 bytes, Then exit 1 and
  stderr exactly `healthcheck failed: body`; When it answers 301 with a
  `Location`, 403, 503 or 500, Then `... status` and no second request;
  When nothing listens, the server resets the connection, or the server
  writes `garbage\r\n\r\n`, Then `... connection`; When the server never answers, or sends the headers of a 200
  and then stalls the body, Then `... timeout` after 5,000 ms (± test
  tolerance); When `MCP_HTTP_PORT` is `0`, `65536`, `abc`, `-1`, `3000.0`,
  `3000` with a leading space, or empty, Then `... port` and no connection
  is attempted; When spawned with `NODE_USE_ENV_PROXY=1` and `HTTP_PROXY`
  pointing at a second loopback listener, Then exit 0 and that listener sees
  no connection; When the real F-012 server runs in insecure and in
  authenticated mode on loopback, Then exit 0; a source scan finds only the
  `node:http` import and only `MCP_HTTP_PORT` read from `process.env`.
  Verified by: `tests/healthcheck-probe.test.ts` (`TestBR326_...`).
- **AC-07** (BR-327) — Given the real `Dockerfile`, When the image-policy
  parser reads it, Then the runtime stage has exactly the BR-327
  `HEALTHCHECK`, the smoke stage has none and the runtime stage's only `RUN`
  is unchanged; Given mutated copies (no `HEALTHCHECK`, a shell-form `CMD`,
  `curl` in the command, other interval/timeout/start-period/retries, two
  `HEALTHCHECK`s, a `HEALTHCHECK` in smoke, `HEALTHCHECK NONE`, an added
  `RUN apt-get install curl`), Then the checker rejects each. Verified by:
  `tests/image-policy.test.ts` (`TestBR327_...`).
- **AC-08** (BR-180 v2, BR-181 v2) — Given a fake `docker` client recording
  calls, When `scripts/image-smoke.sh` runs, Then the smoke launch is exactly
  BR-180 v2's command with `--health-interval=2s`, the no-server probe
  container uses the hardened flags and the runtime image, and each new
  check (`healthcheck-config`, `healthcheck-route`, `healthcheck-status`,
  `healthcheck-down`) fails the run when its fake output is wrong, naming
  that check once on stderr and removing only its containers (BR-182).
  Verified by: `tests/image-smoke-script.test.ts` (`TestBR180_...`,
  `TestBR181_...`).
- **AC-09** (BR-181 v2, BR-326, BR-327) — Given the CI `image` job on the PR
  head, When `make image` and `make image-smoke` run for `linux/amd64` and
  `linux/arm64`, Then both print `image-smoke <platform>: all checks passed`.
  This is the rehearsal against the synthetic drive (AGENTS.md §6); it is
  re-run on the main SHA at acceptance. Verified by: CI job `image` logs.
- **AC-10** (BR-184 v2, BR-187 v3) — Given `examples/compose.yaml` and
  `docs/deployment.md`, When the deployment-example tests run, Then the
  BR-184 v2 and BR-187 v3 assertions hold, and mutated copies (a
  `healthcheck` key, no comment, "It has no `HEALTHCHECK`" kept, no Health
  check section, each required Health check phrase removed (including each
  of `--port`, `docker inspect`, `.State.Health`, `healthcheck failed:`,
  `httpHeaders`, `invalid_host`, `timeoutSeconds` and `GET`), `docker compose
  ps` or `healthy` removed from step 7) are rejected.
  Verified by: `tests/deployment-examples.test.ts` (`TestBR184_...`,
  `TestBR187_...`).

## Decisions

- **D-1 — A dedicated `/healthz` route.** Chosen: a fixed path outside the
  MCP endpoint, constant body, present in both modes. Rejected: the PRM route
  (absent in insecure mode, needs the public `Host`, returns configuration,
  and its contract is F-010/F-012's, not health's); accepting any HTTP
  answer (a 403 `invalid_host` per probe would log a `request_refused` every
  10 s and could not tell our server from another listener); a path under
  the MCP endpoint (`/mcp/healthz` couples health to `P` and to the OAuth
  namespace). A collision with an MCP endpoint at `/healthz` keeps the MCP
  route (existing `add` precedence) instead of a new startup error; the docs
  say so.
- **D-2 — Liveness, not readiness.** The route checks only that the process
  answers HTTP through the real handler. Checking kDrive or the IdP would let
  their outage restart the container and turn the route into an outbound
  amplifier for anonymous callers.
- **D-3 — Body `{"status":"ok"}`, JSON like every HTTP-layer error.** It
  reveals no version, mode, drive, identity, session count or uptime, so it
  is no oracle for auth or configuration state. The status code carries the
  meaning; the body lets the probe tell our server from another listener.
- **D-4 — Loopback `Host` allowance on `/healthz` only, public `Host` kept.**
  A static `HEALTHCHECK` cannot know `P`'s host when the deployment uses
  `--config`; allowing `127.0.0.1`/`localhost`/`[::1]` only on a constant
  route keeps BR-156's DNS-rebinding protection where it matters (a rebound
  page can read nothing but `ok`). The public `Host` stays accepted so an
  orchestrator `httpGet` probe or an external uptime monitor can use it,
  each `Host` class with its own window (D-8).
  Rejected: exempting `/healthz` from the `Host` check entirely (wider than
  needed); loopback-only (blocks external monitors behind Traefik for no
  confidentiality gain); deriving `Host` from `MCP_PUBLIC_URL` in the probe
  (fails for `--config` deployments).
- **D-5 — Port from `MCP_HTTP_PORT`, default 3000, connect to `127.0.0.1`.**
  No new setting (F-002's environment source refuses unknown `MCP_HTTP_*`
  names). An effective port that differs from `MCP_HTTP_PORT` (3000 when
  unset), that is `--port` or `port` in `--config` without the variable, or a bind to a specific
  non-loopback address (or `::1`), or an MCP endpoint at `/healthz`,
  overrides `healthcheck.test` in Compose or uses `--no-healthcheck`; the
  docs say so (BR-187 v3). The port is parsed like the server's own
  `integer` parser so both agree on every value (`03000` is 3000). Rejected:
  a stricter probe-only pattern (a value the server accepts would make the
  probe fail `port` forever). Rejected: parsing `/proc/1/cmdline`
  for `--config` (fragile, `init: true` changes PID 1); a CLI subcommand
  that loads the full configuration (reads secrets files every interval).
- **D-6 — Probe as a compiled module, exec form.** `dist/healthcheck.js` is
  unit-testable and needs no shell. Rejected: an inline `node -e` one-liner
  (untestable, quoting in the Dockerfile); installing `curl`/`wget` (larger
  attack surface, BR-173 allowlist). `--start-interval` rejected because it
  needs Docker Engine ≥ 25, so its effect would depend on the host's engine;
  D-7's 10 s interval gives a short start-up gap on every engine.
- **D-7 — Values 10 s / 10 s / 30 s / 3.** Traefik's Docker provider (the
  Compose example's reverse proxy) routes only to containers whose health is
  `healthy` and drops `starting` and `unhealthy` ones, so after each
  (re)start the service is unreachable until the first passing probe, up to
  one interval after the server listens. A 10 s interval keeps that gap
  short; a 30 s interval would make each restart a 30 s outage. Cost: one
  Node process start every 10 s (6 requests per minute, far under BR-325's
  window). A hung server is marked unhealthy after 3 failed probes, about
  30–60 s; Traefik then stops routing to it. `--timeout=10s` leaves margin
  over the 5,000 ms in-probe deadline for Node start-up on slow or emulated
  hosts; `--start-period=30s` covers the F-014 preflight (failures inside it
  are not counted, and the first success marks the container `healthy`).
  The standalone Docker Engine does not restart an unhealthy container by
  itself (Swarm replaces unhealthy tasks); the Compose
  example keeps `restart: on-failure:3`, and acting on `unhealthy` is the
  orchestrator's choice. The docs tell the operator that Traefik routes only
  once healthy and to wait for `docker compose ps` to show `healthy`
  (BR-187 v3). The Traefik behaviour is taken from Traefik's Docker provider
  documentation, not measured here; `docs/observations/traefik.md` records it
  (AGENTS.md §9.1). Rejected: 30 s (above); `--start-interval` (D-6).
- **D-8 — Two windows of 120 per 60 s, and the probe treats 429 as alive.**
  120 requests per minute per `Host` class, for example two probes at 1 s or
  up to 20 at 10 s, shared with any other probe in the same class (Docker's
  exec probe uses the loopback class at 6 per minute), while bounding
  anonymous handler work. A 429 with the
  handler's exact `rate_limited` body is produced by our own handler, so the
  in-image probe counts it as alive; counting it as failure would let an
  anonymous flood flip the container to `unhealthy`. An orchestrator's
  `httpGet` probe or an external monitor counts 429 as failure, so the
  public-`Host` window is separate from the loopback-`Host` window: a flood
  through the public host (the only `Host` a `Host`-routing reverse proxy
  forwards) fills only `health_public` and cannot affect a probe using
  `Host: localhost` or the exec probe. The docs recommend the exec probe and
  warn that `httpGet` counts 429 as failure (BR-187 v3). The window does not
  bound `request_refused` log volume: each 429 still logs one event, like
  every existing HTTP-layer refusal (404, 403); that volume is bounded only
  by the request rate the server accepts (accepted residual risk,
  Stress-test). Rejected: no window (unbounded anonymous handler work); one
  shared window (an external flood would make an `httpGet` probe fail and
  could restart a pod).
- **D-9 — image-smoke proves it in the existing hardened smoke container.**
  The `smoke` image inherits the runtime `HEALTHCHECK` and already runs the
  real HTTP runtime on `127.0.0.1:3000` under `--network none`, so Docker's
  own health machinery runs the real probe against the real handler without
  a network or a published port. Only `--health-interval=2s` is added to
  keep the run short; a no-server container proves the probe can fail.
  Rejected: running the runtime image with `--http` (its preflight cannot
  reach kDrive under `--network none`, BR-175 v2); publishing a port.
- **D-10 — Compose example adds no `healthcheck` key.** One source of truth
  (the image); the comment points to the docs for overrides.

## Open questions

## Stress-test

Spec review `105-spec-review-1-reviewer` (fresh reviewer, verdict
`changes`); each finding was checked against the code before deciding.

1. Major, Traefik routes only `healthy` containers — **retained**. D-7 records
   it; the interval drops from 30 s to 10 s (BR-327, BR-181 v2 (7)) so the
   post-restart gap is at most about 10 s; `--start-interval` stays rejected
   (D-6). BR-187 v3 requires the Traefik/`healthy` statement in Health check
   and `docker compose ps` / `healthy` in step 7, Verify.
2. Major, one shared window lets an external flood fail an `httpGet` probe —
   **retained**. BR-325 now has `health_loopback` and `health_public`; D-8
   explains why; BR-187 v3 recommends an `exec` probe or `httpGet` with
   `Host: localhost` and warns that `httpGet` counts 429 as failure. A
   loopback-`Host` flood remains possible where the container port is
   reachable without a `Host`-routing proxy; it cannot fail the exec probe
   (429 is alive) and the docs name the trade-off.
3. Major, framing check order — **retained**, confirmed in
   `src/http/handler.ts` (`framingRefusal` after the method check, 413 with
   `connection: close` from `refuse`). BR-322 gives the full order (503, 414,
   403, 404, 405, 413, 429, 200); AC-01 and AC-05 cover GET with a body and
   with `Transfer-Encoding`; BR-162 v2 states the counting order explicitly.
4. Major, port parsing differs from the server — **retained**, confirmed in
   `src/config-schema.ts` `integer` (`^\d+$`, safe integer 1..65535). BR-326
   uses the same rule; AC-06 now expects `03000`-style values to work.
5. Minor, 429 accepted with any body — **retained**: only the exact
   `{"error":"rate_limited"}` body of `src/http/responses.ts`, under the same
   1,024-byte limit.
6. Minor, AC-06 failure codes — **retained**: each case names its code; 3xx
   (`status`, no redirect followed), a stalled body (`timeout`), a reset
   (`connection`) and 429 bodies (`body`) are added.
7. Minor, "exactly these headers" — **retained**, confirmed in
   `src/http/adapter.ts` `writeResponse` (adds `content-length`) and
   `node:http` (`date`, `connection`, `keep-alive`): BR-322 and AC-01 limit
   the exact set to the handler's `Response` and name the transport headers.
8. Minor, missing BR-187 v3 phrases — **retained**: MCP endpoint at
   `/healthz`, `--config` with another port, `MCP_HTTP_HOST` not reachable at
   `127.0.0.1` (`::1`, a specific address) and `healthcheck.test`.
9. Minor, D-8 log-volume claim and connection starvation — **retained**. D-8
   no longer claims the window bounds `request_refused` volume (each 429
   logs, `refuse` in `src/http/handler.ts`). Accepted residual risks: (a)
   refusal log volume is bounded only by the accepted request rate, as for
   every existing refusal; (b) an attacker holding BR-169's 256 connections
   (`server.maxConnections`) makes the probe fail `connection` or `timeout`
   and the container `unhealthy`. Docker does not restart on `unhealthy`;
   the mitigation is the reverse proxy's connection limits. Not addressed in
   this feature: a reserved probe connection would change BR-169.
10. Minor, BR-181 v2 (9) baseline — **retained**: `healthy` within 30 s after
    check (1)'s listening line, not 60 s from container start.

`105-spec-review-2-reviewer` (approve, diff-only, 1 minor):

1. Minor, unparsable HTTP reply — **retained**: BR-326 maps a response that
   cannot be parsed as HTTP to `connection`, and AC-06 adds a server writing
   `garbage\r\n\r\n`.

`105-spec-decision-1-reviewer` (Fable 5.2, approve, 5 minors), all
**retained** by the orchestrator:

1. Proxy environment — BR-326 requires a dedicated `http.Agent` that ignores
   proxy variables; AC-06 adds the `NODE_USE_ENV_PROXY` case.
2. Port mismatch and diagnosis — BR-187 v3 names `--port` and `port` in
   `--config` without the variable, and requires a troubleshooting phrase
   with `docker inspect`; scope 6 adds a CHANGELOG Changed line.
3. Orchestrator probes — BR-187 v3 requires `httpHeaders`, `invalid_host`,
   `timeoutSeconds` and `GET` guidance.
4. D-8 arithmetic — the budget is stated per `Host` class (two 1 s probes or
   any number at 10 s); the limit stays 120, since 1 s multi-probe setups
   are not a target.
5. Traefik evidence — scope 6 adds `docs/observations/traefik.md`
   (documentation source, not a measurement); D-7 limits the no-restart
   statement to the standalone Engine.

`105-spec-review-3-reviewer` (changes, diff-only, 3 minors), all
**retained**: D-5 uses the effective-port wording of BR-187 v3; the budget
reads "two probes at 1 s or up to 20 at 10 s, shared with any other probe in
the same class" in BR-187 v3 and D-8; BR-187 v3 and AC-10 name the exact
required substrings of the new bullets.
