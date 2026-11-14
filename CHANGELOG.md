# Changelog

User-facing changes follow Keep a Changelog and Semantic Versioning.

## [Unreleased]

### Added

- #12 / F-027 v1 (pending acceptance): `make install-check` packs the package,
  installs the packed tarball from the npm registry into a new prefix and fails
  on any `zod` below 4.6.6, any former image-library package or any symbolic
  link; the CI `audit` job runs it as its fourth step.

### Fixed

- #12 / F-027 v1 (pending acceptance): an install of the packed tarball or of
  the published package no longer resolves Zod 3 (`zod` 3.25.76,
  GHSA-mrhx-c7xc-m3w5): the image route calls `pngjs` 7.0.0 and `jpeg-js` 0.4.4
  directly with a local nearest-neighbour resize instead of Jimp, with
  byte-identical PNG output, and `tsconfig.json` no longer sets `skipLibCheck`.

- #16 / F-026 v1 (accepted 2026-11-13): parallel tool calls of one session
  wait in a bounded queue (up to 4 calls, at most 12 seconds each) instead of
  failing at once with `SERVER_BUSY`; `SERVER_BUSY` is now documented as
  retryable, and stdio writes queued responses in order instead of closing
  the session.

## [0.6.0-beta.1] - 2026-11-13

### Added

- #2 / F-024 v2 (accepted 2026-11-13): gated beta publication. The npm package
  is renamed `@sstolz/kdrive-mcp-server` (command unchanged; `make pack`
  writes `artifacts/sstolz-kdrive-mcp-server-<version>.tgz`), and a
  dispatch-only `release.yml` with `make release-*` targets checks the tagged
  `main` commit, its CI, the registries and the protected `release`
  environment before an owner-approved image push and npm `beta` publish with
  provenance, then reads both back. Nothing is published by this change.
- #1 / F-023 v1 (accepted 2026-11-12): every CI job runs on GitHub-hosted
  `ubuntu-24.04`, and a `privacy-scan` job (`make privacy-scan`, needed by
  `ci-result`) scans the tracked tree, the pushed or PR commits and the PR
  title and body against deny patterns from the `PRIVACY_DENY_PATTERNS`
  secret, failing closed and printing only locations and pattern numbers.
  `runner-acceptance.yml` never runs in this repository.
- #114 / F-022 v2 (accepted 2026-11-12): Quality Gate failure summary. When
  the Sonar scanner exits nonzero, the `sonar` and `sonar-pr` logs show the
  gate status, up to 20 failed conditions and up to 20 current open issues of
  the project, read with the existing analysis token (a fixed degraded line
  when the token lacks Browse permission); server text is escaped and
  redacted, and the exit code is unchanged. `docs/development.md` documents
  the line formats and the token upgrade path.
- #105 / F-021 v1 (accepted 2026-11-11): container health check. The HTTP
  runtime answers `GET /healthz` with `{"status":"ok"}` in authenticated and
  insecure modes, without authentication, also for a loopback `Host`, within
  two windows of 120 requests per minute; `node /app/dist/healthcheck.js`
  probes it, and the runtime image has a `HEALTHCHECK` (every 10 s, 10 s
  timeout, 30 s start period, 3 retries). `docs/deployment.md` gains a Health
  check section.
- #104 / F-020 v1 (accepted 2026-11-11): `make audit` runs
  `npm audit --audit-level=high` inside `dev`, and a CI `audit` job, needed by
  `ci-result`, fails on any high or critical finding. `make check` does not run
  it (network advisory service).
- #103 / F-019 v1 (accepted 2026-11-11): persistent OAuth
  proxy state. The optional `OAUTH_STATE_FILE` (`--oauth-state-file`, YAML
  `oauthStateFile`; `proxy` mode over HTTP only) keeps registered clients and
  refresh families in a private SQLite file across restarts, so a client
  refreshes without registering or logging in again; consents, upstream flows
  and authorization codes stay in memory. The file must be a `0600` regular
  file in a private directory on a local file system, holds one exclusive lock
  and no upstream token or plain secret, and is a credential store. Five fixed
  startup refusals (`OAUTH_STATE_UNAVAILABLE`, `_LOCKED`, `_CORRUPT`, `_VERSION`,
  `_MISMATCH`), the events `store_loaded` and `store_write_failed` (a failed
  write latches the store with 503 until restart) and a family identity re-check
  at refresh. See `docs/oauth-proxy.md`. The owner-run real-client restart check
  has not been run.
- #19 / F-018 (accepted 2026-11-10; D-18-11 triggered: kDrive renamed a folder-named file and normalized an NFD name, so F-018 v2 is required before release): `kdrive_upload` in `write` and `share`
  modes. UTF-8 `text` or canonical `base64`, at most 524,288 decoded bytes,
  through the F-016 audit gate; `overwrite:false` sends `conflict=error`
  (observed kDrive refusal of an existing same-name file, not a guarantee),
  `overwrite:true` requires `file_id`, checked by the policy as the file
  called `name` in `parent_id`, and sends `conflict=version`. A response that
  does not report that file in that folder is `uncertain`; nothing is
  replayed. New owner-run `make kdrive-upload-acceptance`. BR-279–BR-289 and
  BR-035 v2, BR-060 v6, BR-190 v3, BR-266 v2, BR-274 v2 are active.
- #18 / F-017 (accepted 2026-11-10): controlled tree mutations. In `write` and
  `share` modes, `kdrive_create_folder`, `kdrive_rename`, `kdrive_move`,
  `kdrive_trash` and `kdrive_restore` run through the F-016 audit gate with
  production mutators (`src/kdrive/mutators.ts`) and a mutation port that sends
  one request per attempt on a new TLS connection (`NotSent` only before the
  handshake). Restore uses trash metadata plus the live former parent and
  returns an item only to that parent; configured roots cannot be trashed,
  renamed or moved; no permanent deletion. New owner-run
  `make kdrive-write-acceptance`. BR-260–BR-278 and BR-039 v2, BR-060 v5,
  BR-190 v2 and BR-200 v2 are active.
- #17 / F-016 (accepted 2026-11-10): mutation audit gate. `src/audit/sink.ts` writes JSONL
  `intent`, `outcome` and `denied` records to stderr or a private `0600`
  append-only file (`KDRIVE_MCP_AUDIT_LOG`, opened in `write`/`share` modes
  only, `fdatasync` per record); `src/mutation-gate.ts` admits, authorizes
  through the policy facade, records the intent, retries 429 only and returns
  `uncertain` for timeouts, lost responses and 5xx. The navigation controller
  gains `mutate`, and shutdown waits for in-flight writes to record their
  outcome. No write tool yet. BR-234–BR-259 and BR-069/BR-070 v2 are active.
- #70 / F-014 v7 (accepted 2026-11-09): production kDrive read adapter. `src/kdrive/` serves the
  policy, received-share, content and preflight ports over `node:https` with a
  fixed origin, per-connection public-address checks, one bounded storage
  redirect, deadlines, body bounds and bounded concurrency (ADR-006). The CLI
  now runs production preflight and serves stdio or HTTP (BR-016/071/123/175
  v2); the token stays in the adapter and the extraction worker starts with an
  empty environment. New owner-run `make kdrive-record` and
  `make kdrive-acceptance`. BR-190–BR-217 and BR-016/028/071/123/175 v2 are active.
- #13 / F-013 (accepted 2026-11-05): multi-architecture container image. A production
  `Dockerfile` (native build stages, digest-pinned Node 26.13.0, non-root
  `runtime`, dev-only `smoke`), `make image`, `make image-smoke` and the opt-in
  `make image-binfmt`, a per-architecture CI job `image`, and generic
  `examples/compose.yaml`, `examples/config.yaml` and `docs/deployment.md`. No
  image is published; the runtime still reports that it is not implemented.
- Pending #12 / F-012: authenticated Streamable HTTP in proxy mode. A
  `node:http` server in `src/http/` mounts the OAuth proxy handlers and the
  SDK transport behind exact routes, protected-resource metadata, Host and
  Origin checks, bearer verification of every MCP request, per-identity and
  per-route rate limits, bounded bodies, per-identity JSON-only sessions and an
  ordered shutdown, plus a loopback-only unauthenticated mode. A dev-only
  `make http-acceptance` composition serves a synthetic drive for the owner-run
  real-client check. BR-152–BR-171 (v1), BR-025 v2 and BR-059 v2 remain pending
  acceptance; no real client connection or production kDrive adapter is
  established, and the CLI is unchanged.

- Accepted #50 / F-011 v3 on main bc09d56: pre-merge quality gates. The lint gate adds
  `eslint-plugin-sonarjs` 4.2.2 (`recommended`) and typescript-eslint
  `strictTypeChecked`, with named and justified suppressions only and a bounded
  tests allowlist. The Sonar host comes from `SONAR_HOST_URL` or an external
  `SONAR_HOST_URL_FILE` and is never printed or tracked in active code. A new
  `make sonar-pr` target and `sonar-pr` CI job give same-repository pull
  requests a blocking Quality Gate on the dedicated `kdrive-mcp-server-pr`
  project; forks fail closed. Snapshot preparation runs read-only and secrets
  reach only analysis code that matches the pristine archive. Git metadata is
  read-only in the containers, and the Sonar jobs move `.git` aside when it
  changed, so the checkout post step never runs tampered Git configuration.
  Inline ESLint configuration comments stop the lint run. BR-144–BR-151
  (BR-144/150 v2, BR-151 v3), BR-010/012/014 v2 and BR-015 v3 are active; the
  owner configured `kdrive-pr-gate` and set `SONAR_ENABLED=true`
  (acceptance (archived evidence `runs/50-acceptance-1.md`)).

- Accepted #21 / F-010 on main 3fc14c3bbbd57b3c52ca4b74c07a512720f0d627: a transport-independent bounded OAuth proxy
  in `src/auth/proxy/` (RFC 8414 metadata with RFC 9207, dynamic registration
  limited to the redirect allowlist, consent on every authorization,
  browser-bound one-use state, strict upstream ID-token verification, one-use
  60-second codes, one-hour ES256 access tokens, rotating refresh tokens with
  family revocation, bounded in-memory state). The access-token validator
  gains the BR-100 v2 upstream-issuer option, and HTTP redirect URIs may use
  `localhost` (F-002 v3 / BR-024 v2). BR-124–BR-143, BR-100 v2 and BR-024 v2
  are active; no HTTP listener is added (P-12) and no MCP client connection is
  tested (#12/#13).

- #14 / F-009 (accepted 2026-11-03): `kdrive_read` for strict encoded text,
  selected text from a conservative bounded PDF profile and complete resized
  PNG/JPEG-derived MCP images, with version-bound code-point continuation and
  owned workers. BR-109–123 / BR-060 v4 active (injected scope); no OCR, provider
  qualification, production entrypoint or release is established.

- Accepted #11 / F-008 on main2cec566ab8e2f030dbbbf47f04bf541e5eb48dc4, with owner-run AC-20 on main 7b046a0446930ab6a935510314c6c1b975d13550:
  production access-token validator in `src/auth/` (pinned `jose` 6.2.12
  runtime dependency), provider verdict and per-client mode decisions, the
  owner-run `make oidc-qualify` command with redacted reports, and the dated
  [MCP client compatibility matrix](docs/mcp-client-compatibility.md).
  Infomaniak and Gitea are both `proxy-only`, so every client resolves to
  `proxy` and P-21 is promoted to 0.2. BR-094–BR-108 are active. No HTTP/OAuth
  runtime is added and client connections remain `not tested`.

- Accepted #10 / F-007 injected scope on main4f84e4bb5343274d779ff43061effb60aa3cb64b: policy-protected raw byte downloads, strong
  normalized version binding, complete binary resources and shared bounded read
  retries. BR-082–093 v1 / BR-060 v3 are accepted for injected scope; no production provider,
  credential binding, extraction, release or publication is added.

- Accepted #9 / F-006 injected scope on main30e059ef8ef3540c4aa4bb6a0de0bf209c963b12: four additional guarded collection tools,
  common opaque session continuation, ordered roots, cross-call deduplication,
  five-list-call proof/data budget and fixed scalar redaction. BR-072–BR-081 v1
  and BR-060/065 v2 are accepted for that injected scope; no production provider or release is added.

- Accepted #8 / F-005 injected scope on main209a68de956b328e04e2d98d6745128a587184bd: real injected SDK stdio navigation with four
  read tools, guarded metadata/list projection and anchor-based path resolution,
  cumulative safe registration, unofficial/untrusted-data notices and finite
  sanitized input/output/session ownership. Terminal-only lists refuse
  continuation until #9. The production CLI keeps exact existing diagnostics;
  no real provider adapter, production access, HTTP/resources or release is added.
  BR-059–BR-071 v1 are accepted for that injected scope; #6/#7 production ACs remain blocked.

- #7 / F-004 v1 (accepted 2026-11-09): separate injected received-share authorization,
  opt-in discovery and positive root/child proofs, recipient-path effects,
  list-only reads cached for less than 60 seconds, fresh doubly gated mutation
  capability checks and unconditional re-sharing refusal. Synthetic policy
  tests add no production adapter, MCP registration or real write; production
  AC-14/AC-15 passed through F-014 AC-25 on main `2a9c1e3`. BR-047–BR-058 are active.

- #6 / F-003 v2 (accepted 2026-11-09): abstract injected configured-tree policy,
  strict runtime evidence and operation validation, fresh checks, bounded
  descendant proofs, deny matching and immediate guarded dispatch. Synthetic
  AC-01–AC-18 implementation adds no production adapter or MCP registration;
  AC-19/AC-20 passed through F-014 AC-23/AC-24 on main `2a9c1e3`; BR-029–BR-046
  are active. No release is established.

- Accepted documentation preparation for #5: English read API evidence dossier, bounded GET-only
  probe plan and explicitly invented synthetic examples. Historical observations,
  public-source claims and unmeasured cases remain distinct. The original bounded
  init attempt returned HTTP 401 and retained no body or inventory. A separately
  approved receipt-preserving retry returned HTTP 200 with three bounded ID/role
  projections; see the sanitized retry evidence (archived evidence `runs/5-init-retry-1.md`).
  Authentication provisioning was fulfilled at that checkpoint; remaining fixture
  measurements were then unavailable. Documentation acceptance on main
  `62683840cbdcd8f57786200deea18bfc8c533f63` is recorded in
  the documentation acceptance report (archived evidence `runs/5-doc-acceptance-1.md`).
  No working adapter is established.
- Navigable [business-rule index](business-rules/README.md) covering all 28
  allocated IDs, canonical/historical sources, accepted statuses and preserved
  successor chains (#35).
- Migrate all 28 allocated rules to YAML metadata, an initial BR version 1,
  Rule/Rationale, concrete Given / When / Then Examples, Verification and History
  (#35). Extract four never-active historical definitions verbatim into canonical
  records, preserve existing meanings/chains and disclose missing test mappings.
  Align prospective feature/rule templates and navigation with the user-updated
  AGENTS skeleton and same-purpose BR-version policy; no contract change or
  release is established.
- Complete 122 previously missing active-rule verification entries with 121
  automated boundary cases and one actual GNU Make 3.81 help test, preserving
  existing product behavior, rules and tests (#35). Historical never-active
  allocations retain their original verification targets.
- Accepted #4 / F-002 v2: bounded CLI/environment/explicit-YAML
  configuration, drive/root selection, read/write/share settings, credential
  references and redacted diagnostics, with an injected startup-preflight
  boundary. Local CLI preparation selects stdio/HTTP and exits with an explicit
  runtime-unavailable diagnostic. No real resolver, MCP/HTTP server or OAuth
  implementation is established. Acceptance on main
  `88bf8caa7412988e11099a4a01f9e600aa38eeee` is recorded in
  the final acceptance report (archived evidence `runs/33-acceptance-1.md`).
- Accepted foundation for #3 / F-001 v4: diagnostic TypeScript package, isolated
  injected drive client, Docker/Make quality workflow, five mandatory CI jobs,
  V8/LCOV coverage and conditional guarded remote Sonar analysis. Acceptance on
  main `f2d38b32dbbd78059da6754bb11d9b8e561fd645` is recorded in
  the acceptance report (archived evidence `runs/28-acceptance-1.md`). No release or working MCP
  server is established by this foundation.
- Accepted #2 documentation baseline: delivery policy, specification templates
  and planning records, preserving the French historical sources. Acceptance of
  all 19 reviewed file blobs on main
  `40a80e31c88d3bdf4a52e4437ae4f3f538a732c4` is recorded in
  issue #2 (archive issue 2). This accepted
  documentation baseline establishes no working server capability or release;
  remaining repository-enforcement work stays separate in #1.

### Changed

- #2: the README starts with a beta notice (the interface may change before
  1.0) and the unofficial, non-affiliated notice; the npm description says the
  same. `docs/publishing.md` records the chosen package and image names, the
  `0.6.0-beta.N` versions and the release gate.
- #105 / F-021 v1 (accepted 2026-11-11): behind Traefik, routing to the
  container now waits until Docker reports it `healthy` (up to one 10 s
  interval after each start). Deployments whose effective port differs from
  `MCP_HTTP_PORT`, whose MCP endpoint is `/healthz` or whose `MCP_HTTP_HOST`
  is not reachable at `127.0.0.1` override `healthcheck.test` or use
  `--no-healthcheck` (see `docs/deployment.md`).
- #103 / F-019 v1 (accepted 2026-11-11): every OAuth proxy refresh token,
  with or without `OAUTH_STATE_FILE`, is `<family id>.<secret>` (66 characters) and only its secret is
  hashed; a token in the former format is refused with `invalid_grant`, which a
  restart without the file already caused. A stored redirect URI is usable only
  while it is still in `OAUTH_ALLOWED_REDIRECT_URIS` (BR-128 v2). BR-023 v2,
  BR-024 v3, BR-124 v2, BR-128 v2, BR-139 v2, BR-140 v2, BR-142 v2, BR-143 v2,
  BR-152 v2 and BR-169 v2 are active. `docs/oauth-proxy.md`, `docs/deployment.md` and the examples
  describe the setting.
- Accepted #101 / F-013 v3: `docs/deployment.md` states that the
  runtime image serves kDrive and adds a personal server step-by-step guide and
  a Troubleshooting section; `examples/compose.yaml` sets
  `KDRIVE_MCP_MODE: read`, `stop_grace_period: 75s` and commented write-mode
  audit settings (BR-187 v2).
- #91 / F-018 v2 (accepted 2026-11-11): `kdrive_upload`, `kdrive_create_folder`
  and `kdrive_rename` refuse names that are not in Unicode NFC
  (`INVALID_ARGUMENTS`, no request), and their descriptions say so. The
  owner-run upload acceptance checks the refusal, an NFC upload stored
  unchanged, and observes a compatibility ligature and the folder-name rename.
  BR-260 v2, BR-263 v2, BR-279 v2, BR-283 v2, BR-287 v2 and BR-288 v2 are
  active.
- #72 / F-015 v2 (accepted 2026-11-06): CI runs on an isolated self-hosted runner, one Lima VM
  per job restored from a golden disk, with host-enforced egress and JIT
  registration (`ops/runner/`, `docs/self-hosted-runner.md`, ADR-007).
  `ci.yml` adds the `changes`, `fork-refusal` and `ci-result` jobs, skips the
  heavy jobs on records-only PRs and cancels superseded PR runs; a dispatched
  `runner-acceptance.yml` probes the isolation. BR-218–BR-233, BR-015 v5,
  BR-149 v2, BR-178 v2 and BR-183 v2 are active, with BR-231 at v2.
- #63 / F-012 v2 (accepted 2026-11-05): `make http-acceptance` reads the upstream client
  secret and signing key from `HTTP_ACCEPTANCE_SECRETS_DIR`, a directory outside
  the checkout validated by `scripts/http-acceptance-entry.sh` and mounted
  read-only at `/run/secrets` for that run only; it refuses while a `secrets`
  path exists in the checkout, and `make sonar`, `sonar-pr` and `quality` refuse
  one too. BR-171 v2 and BR-189 were accepted on main `7b8b52d`.
- F-003 v2 / BR-042 v2 preserve external-drive refusal in the configured-tree
  route while frozen F-004 v1 defines the separate received-share route. Preserve
  F-003 v1 verbatim and its accepted abstract stage at main
  `f31ee2f0e772c87d4ebfbe6a7aa77bc925d5b330`; #6 production AC-19/AC-20 and
  all full-acceptance markers remain pending. No version/release change.

- Record bounded #5 read evidence for owned pagination/metadata, known ranges,
  opaque nonstandard header equality and invalid-limit handling, preserving
  stopped attempts and explicit unknowns; synchronize workflow/learnings and
  public operational records without product or version changes. See the
  sanitized measurements (archived evidence `runs/5-final-read-measurements-1.md`).

- Pending #38 acceptance: require structured per-ticket token-usage snapshots
  and measured closure reporting, separating missing, shared and unattributable
  usage without double-counting cached input; classify issues with one English
  type label and one or two area labels. This documents the workflow only;
  it introduces no tracker, gate, product behavior or release.
- Accepted documentation preparation for #5: ignore the exact owner-designated credential path
  `/.config/kdrive-token`, synchronize public #35 post-acceptance records and
  the separately authorized local branch-cleanup records, and correct stale
  current-policy/#2 changelog status. Credential contents,
  historical planning snapshots, product behavior and version metadata are
  unchanged; no release is authorized.
- Accepted correction for #28 / F-001 v4: use the official scanner's Project token
  authentication and built-in Quality Gate waiting, with explicit external
  local-file loading, credential-redacted diagnostics and retained exact-main,
  fresh-coverage and timeout guards. Remove custom metadata/gate probes and
  legacy compatibility environment prerequisites; no GitHub secret transfer,
  CI activation, privacy verification or release is established by this entry.
  The merged wrapper completed actual-main live analysis and its built-in
  Quality Gate; F-001/BR/capability completion markers are synchronized in #4.

### Fixed

- #104 / F-020 v1 (accepted 2026-11-11): the dependency audit is clean.
  `package.json` overrides make Jimp use the root Zod 4 instead of a nested
  Zod 3.25.76 (high
  [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5))
  and pin `minimatch` 11.0.8 (moderate tooling advisory); `tsconfig.json` sets
  `skipLibCheck` (ADR-009). An install of the packed tarball does not get the
  overrides (see `SECURITY.md`).
- Accepted #100 / F-018 v3: `kdrive_create_folder` and
  `kdrive_rename` refuse a `name` holding an unpaired surrogate
  (`INVALID_ARGUMENTS`, no gate run, record or request), through the name
  validator they now share with `kdrive_upload`, whose behaviour is
  unchanged (BR-260 v3).
- Accepted #100 / F-018 v3: the adapter User-Agent and the MCP
  server info version come from `PACKAGE_VERSION` instead of a hard-coded
  `0.1.0` (F-014 BR-190 fixed request headers, D-18-15). No observable change
  while the package version is `0.1.0`.
- Accepted #50 (F-011 v3, BR-151 v3): the Sonar CI jobs save and
  compare `.git/config.worktree`, which the pinned `actions/checkout` writes on
  the runner, instead of refusing it; `commondir` and `modules` stay refused.
- Accepted #50: clear the 17 minor Reliability findings that failed
  `kdrive-pr-gate` on the P2 baseline of `main` `42cbaeb`, then the 6 more
  found by the re-run on `87bbc31` (`replaceAll`,
  `String.fromCodePoint`, `codePointAt`, `Number.parseInt`, `new Array`, and
  string patterns instead of single-character regexes);
  behaviour is unchanged.
- Pending #7 acceptance: reject complete received-root snapshots containing
  inconsistent same-drive path identities before cache/use, and synchronously
  recheck snapshot age after awaited evaluation immediately before protected
  execution or discovery/collection output. Add independent queued-microtask
  expiry tests and preserve permitted unique/overlapping-anchor controls.

- Pending #7 acceptance: normalize received capabilities to known primitive
  predicates without invoking nested accessors/toJSON methods; reject owner-root
  substitution in every relative chain; reconcile compatible overlapping shared
  anchors while preserving stronger proofs and strict configured-tree ancestry.
  Add tests for each independent PR #43 review finding; no production capability
  or release is established.

- Accepted #33: explicit CLI argument cursor advancement removes the remaining
  S2310 finding without changing inline/separate value consumption, transport
  progression or frozen configuration diagnostics.
- Accepted #31: behavior-preserving configuration refactoring addresses the exact
  official scanner violations and regex-review findings from #4's earlier failed
  actual-main Quality Gate. F-002 v2, diagnostics, validation order and all
  existing gates remain unchanged. Both corrections and #4 passed final
  acceptance on main `88bf8caa7412988e11099a4a01f9e600aa38eeee`, including the
  official Quality Gate; see the evidence (archived evidence `runs/33-acceptance-1.md`).

### Removed

- This repository's #1: the public-export tooling (`scripts/public-export.ts`, its tests and the
  `public-export` and `public-commit` Make targets), used once to publish this
  repository from the archive.
