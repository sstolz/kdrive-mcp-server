# Capability map

## Accepted — bounded invocation queue

[F-026 v1](features/F-026-bounded-invocation-queue.md) (#16), BR-380–BR-388 v1
with BR-070 v3, BR-118 v2 and BR-258 v2. A tool call, resource read or gate run
that arrives while another invocation of the same session runs waits in a
per-session first-in first-out queue (at most 4 waiting calls, at most 12
seconds each) instead of failing at once; execution stays one at a time, so
writes stay serialized, and each invocation's 10-second deadline and budgets
start when it takes the slot. A full queue or a wait timeout answers
`SERVER_BUSY` before any kDrive request, documented as retryable; abort or
close while waiting answers `ACCESS_DENIED`. The stdio transport queues up to
6 outbound frames behind the frame being written instead of closing the
session. Accepted on actual main `2d10e19` on 2026-11-13 (`make check` rc=0,
4060 tests; [evidence](https://github.com/sstolz/kdrive-mcp-server/issues/16#issuecomment-6863879656)).

## Accepted — changelog release sections

[F-025 v1](features/F-025-changelog-release-sections.md) (#2), BR-321 v3.
`CHANGELOG.md` keeps released entries under dated release sections
(`## [<version>] - <YYYY-MM-DD>`), the first being `0.6.0-beta.1`, and the
dependency-audit check reads the #104 lines from the first release section that
cites #104, or from `## [Unreleased]` while no release section exists.
Accepted on actual main `e857db3` on 2026-11-13 (`make check` rc=0, 4032 tests;
AC-06 changelog diff checked; [evidence](https://github.com/sstolz/kdrive-mcp-server/issues/2#issuecomment-6852513497)).

## Accepted — gated beta publication

[F-024 v2](features/F-024-gated-publication.md) (#2), BR-353–BR-375, BR-378 and
BR-379 v1 with BR-016 v3 and BR-178 v3. The npm package is renamed
`@sstolz/kdrive-mcp-server` (the command and server-info name stay
`kdrive-mcp-server`), and a dispatch-only `release.yml` checks the tagged
`main` HEAD, its green CI, the registries and the protected `release`
environment, then, only for `dry_run=false` and after the owner's approval,
pushes the two-platform image `ghcr.io/sstolz/kdrive-mcp-server:<version>` and
publishes the verified tarball to npm under `beta` with provenance, and reads
both back. npm installs still resolve Jimp's nested Zod 3 during the beta
(residual risk (f), fixed before 1.0 in #12). Accepted on actual main
`163e701` on 2026-11-13: `make check` rc=0 (4028 tests), AC-16 refused
dispatches 43374504547, 43375479137 and 43374822744, AC-22 dry run 43410611002,
and release run 43412989345 published `0.6.0-beta.1`
([evidence](https://github.com/sstolz/kdrive-mcp-server/issues/2#issuecomment-6851666057)).

## Accepted — hosted CI and privacy scan

[F-023 v1](features/F-023-hosted-ci-privacy-scan.md) (#1), BR-341–BR-352 v1
with BR-015 v7, BR-149, BR-183, BR-225 and BR-227 v3, BR-229 and BR-320 v2.
Every CI job runs on GitHub-hosted `ubuntu-24.04`; a `privacy-scan` job, needed
by `ci-result`, scans the tracked tree, the commit range (messages, identities,
changed blobs and paths) and the PR title and body against deny patterns read
only from the `PRIVACY_DENY_PATTERNS` secret, and prints locations and pattern
numbers only. The self-hosted runner setup stays optional documentation, never
attached to this repository. Accepted on actual main `ad25fa2` on 2026-11-12
(`make check` rc=0, 142 files / 3742 tests; push run 43269623841 and full-history
`workflow_dispatch` run 43269650799 green on hosted runners, `privacy-scan` 0 hits;
[evidence](https://github.com/sstolz/kdrive-mcp-server/issues/1#issuecomment-6831523066)).

## Accepted — Quality Gate failure summary

[F-022 v2](features/F-022-sonar-gate-summary.md)
(#114), BR-328–BR-340 (BR-335 v2) with BR-146 v2. When the scanner exits nonzero, the
`sonar` and `sonar-pr` job logs show the Quality Gate status, up to 20 failed
conditions and up to 20 current open issues of the analysed project, read with
the existing analysis token; without Browse permission the issues are replaced
by a fixed degraded line. Server text is escaped, the host and the token are
redacted, and the scanner exit code is preserved. Accepted on actual
main `e7d6367` on 2026-11-12 (`make check` rc=0, 142 files / 3709 tests; main CI
run 43179730746 green including `sonar`; AC-15 `sonar-pr` jobs 131024019873 and
131035729892; evidence (archive issue 114)).

## Accepted — container health check

Accepted on actual main e208996d2885b217f385baddf4bf9bf50c2631cc, 2026-11-11
(`make check` rc=0, Tests 3670 passed (3670); AC-01–AC-10 pass, including the
CI `image` jobs of main run 43117180747 for both platforms;
evidence (archive issue 105)):
[F-021 v1](features/F-021-container-health-check.md) (#105), BR-322–BR-327 v1 with BR-154, BR-156, BR-162, BR-167, BR-168, BR-180,
BR-181 and BR-184 v2 and BR-187 v3. The HTTP runtime answers an
unauthenticated `GET /healthz` with `{"status":"ok"}` in both modes, accepting
loopback `Host` values on that route only, within two windows of 120 requests
per minute. The runtime image's `HEALTHCHECK` runs `node
/app/dist/healthcheck.js` every 10 s; behind Traefik, routing waits until
Docker reports the container `healthy`.

## Accepted — dependency audit

Accepted on actual main b6acf86d0e230281bb7f0524a8c066b83123643f, 2026-11-11
(`make check` rc=0, Tests 3570 passed (3570); `npm audit --audit-level=high`
found 0 vulnerabilities; AC-01–AC-08 pass, including the CI `audit` job of main
run 43104333108; evidence (archive issue 104)):
[F-020 v1](features/F-020-dependency-audit.md) (#104), BR-315–BR-321 v1 with
BR-015 v6, BR-122 v2, BR-225 v2 and BR-227 v2, and
[ADR-009](architecture-decisions/ADR-009-dependency-overrides-skiplibcheck.md).
`package.json` overrides make Jimp use the root Zod 4 and pin `minimatch`
11.0.8, so `npm audit` on the lockfile reports no high finding; `make audit`
and the CI `audit` job, needed by `ci-result`, fail on any high or critical
finding. An install of the packed tarball does not get the overrides
(`SECURITY.md`).

## Accepted — persistent OAuth proxy state

Accepted on actual main 68209fef44e34d4adfd155bc3dab6a1734c03e10, 2026-11-11
(`make check` rc=0, Test Files 138 passed (138) / Tests 3527 passed (3527);
AC-01–AC-13 and AC-19–AC-23 pass, AC-14–AC-18 moved to #109;
evidence (archive issue 103)):
[F-019 v1](features/F-019-persistent-oauth-state.md) (#103), BR-290, BR-292–BR-304
and BR-312–BR-314 v1, with BR-023 v2, BR-024 v3, BR-124 v2, BR-128 v2, BR-139 v2,
BR-140 v2, BR-142 v2, BR-143 v2, BR-152 v2 and BR-169 v2. In `proxy`
mode over HTTP, the optional `OAUTH_STATE_FILE` keeps registered clients and
refresh families in a private, locked SQLite file on a local file system, so a
restart needs neither registration nor login again; pending consents, upstream
flows and authorization codes stay in memory. Startup refusals use five fixed
`OAUTH_STATE_*` lines, a failed write latches the store until restart, and the
file is a credential store ([operator notes](docs/oauth-proxy.md)). The
owner-run check with a real MCP client across a container restart has not been
run.

## Accepted — bounded upload

Accepted on actual main 0f1852c732fa3d4afe1741a7d89e453ae96b2905, 2026-11-10
(`make check` rc=0; owner-run `make kdrive-upload-acceptance` passed all 12
steps with 63 requests, evidence (archived evidence `runs/19-acceptance-2.md`)):
[F-018 v1](features/F-018-upload.md) (#19), BR-279–BR-289 and BR-035 v2,
BR-060 v6, BR-190 v3, BR-266 v2 and BR-274 v2. In
`write` and `share` modes the server registers `kdrive_upload`: UTF-8 `text` or
canonical `base64` of at most 524,288 bytes into an authorized folder.
`overwrite:false` sends `conflict=error` (observed kDrive refusal of an
existing same-name file, not a guarantee); `overwrite:true` requires the
`file_id` of the file called `name` in `parent_id` and replaces it in place.
A response that does not report that file in that folder is `uncertain`;
nothing is replayed. D-18-9 and D-18-10 passed on the real API; D-18-11 was
triggered (kDrive renamed a file named like a folder and normalized an NFD
name, both reported `uncertain`), so F-018 v2 (NFC-only names, owner decision
2026-11-10) is required before any release.
Accepted on actual main b6b7fbb5a96934c8f918cc8e00e9e42a4ac0e0f6, 2026-11-11
(evidence (archived evidence `runs/91-acceptance-1.md`)): F-018 v2 (#91) refuses names that are not
in NFC for `kdrive_upload`, `kdrive_create_folder` and `kdrive_rename`; NFC names
are stored unchanged, which resolves D-18-11 for normalization (R-18-3 remains an
accepted risk).
Accepted on actual main cdc238ba3d1cda0f6e15aa75d1a39cf955f1b62f, 2026-11-11
(evidence (archive issue 100)): F-018 v3 (#100,
BR-260 v3) also refuses a `name` that is not well-formed UTF-16 (an unpaired
surrogate) for `kdrive_create_folder` and `kdrive_rename`, as `kdrive_upload`
already did; the User-Agent and the MCP server info version follow the package
version.

## Accepted — controlled tree mutations

Accepted on actual main 4b59c528eed9d088cad27271f460f5a4077b9eda, 2026-11-10
(`make check` rc=0, 127 files / 3121 tests; PR #86 CI green; owner-run
`make kdrive-write-acceptance` passed all 11 steps with 70 requests,
evidence (archived evidence `runs/18-acceptance-1.md`)):
[F-017 v1](features/F-017-controlled-tree-mutations.md) (#18),
[BR-260–BR-278](business-rules/README.md#accepted--controlled-tree-mutations),
BR-039 v2, BR-060 v5, BR-190 v2 and BR-200 v2. In `write` and `share` modes the
server registers `kdrive_create_folder`, `kdrive_rename`, `kdrive_move`,
`kdrive_trash` and `kdrive_restore`. Each call passes the F-016 audit gate;
the production mutators send one request on a new TLS connection and report a
lost response as `uncertain`. Restore returns an item only to its live,
authorized former parent; a folder restore is refused while deny patterns are
configured; configured roots cannot be trashed, renamed or moved; no route
deletes permanently; received-share writes stay denied. Residual risk R-17-1 was not observed:
the measured trash `path` is a deletion-time snapshot.

## Accepted — pre-merge quality gates

Accepted on actual main bc09d562eb422acd2b284be8c14e1e0806d6a118, 2026-11-04
(`make check` rc=0, 94 files / 2041 tests; PR Quality Gate observed failing on
a seeded issue and passing after its revert in real CI,
evidence (archived evidence `runs/50-acceptance-1.md`)): [F-011 v3](features/F-011-pre-merge-quality-gates.md),
[BR-144–BR-151](business-rules/README.md#pending--pre-merge-quality-gates)
(BR-144/150 v2, BR-151 v3), BR-010/012/014 v2 and BR-015 v3. A stricter lint gate (SonarJS and `strictTypeChecked`),
a Sonar host taken from runtime configuration, and a blocking PR Quality Gate
for same-repository pull requests on the dedicated `kdrive-mcp-server-pr`
project, with read-only snapshot preparation and pristine-archive checks before
any secret is used. The owner configured `kdrive-pr-gate` (Reliability,
Security and Maintainability rating A on overall code) and set
`SONAR_ENABLED=true`. The two current Security Hotspots were reviewed as Safe
with justifications; marking them in the Sonar UI is owner-side and not
confirmed in the record.

## Accepted — authenticated Streamable HTTP (proxy mode)

Accepted on actual main 00e6fe340a505ce57967b486a0bda6f7c2f4d2d9, 2026-11-04
(`make check` rc=0, 94 files / 2031 tests; PR #53 CI green; owner-run AC-21 with
claude.ai web, evidence (archived evidence `runs/12-acceptance-claude-1.md`)): [F-012 v1](features/F-012-authenticated-http.md),
[BR-152–BR-171](business-rules/README.md#pending--authenticated-http),
[BR-025 v2](business-rules/BR-025.md) (F-002 v4) and
[BR-059 v2](business-rules/BR-059.md) (F-005 v2). A `node:http` listener in
`src/http/` mounts the accepted OAuth proxy handlers and the SDK Streamable HTTP
transport in front of the injected navigation server: exact routes, protected
resource metadata, Host and Origin checks, bearer verification of every MCP
request, per-identity and per-route rate limits, bounded bodies, per-identity
sessions with a JSON-only 2025-era protocol, an ordered shutdown, and a
loopback-only unauthenticated mode for local development. Accepted with synthetic tests and one real connection: claude.ai web connected
through the Infomaniak upstream, listed the ten read-only tools and read the
synthetic drive of the dev-only acceptance composition. No production kDrive
adapter and no CLI HTTP runtime exist yet, so a real drive is not served.

## Accepted — bounded OAuth proxy

Accepted on actual main 3fc14c3bbbd57b3c52ca4b74c07a512720f0d627, 2026-11-03
(`make check` rc=0, 76 files / 1746 tests; PR #51 CI green): [F-010 v1](features/F-010-oauth-proxy.md),
[BR-124–BR-143](business-rules/README.md#pending--oauth-proxy),
[BR-100 v2](business-rules/BR-100.md) and [BR-024 v2](business-rules/BR-024.md)
(F-002 v3). Transport-independent handlers for authorization-server metadata,
dynamic registration, consent, the upstream login with Infomaniak or another
OIDC provider, and the code and refresh grants, plus a verifier for the
proxy's one-hour access tokens. Accepted with synthetic tests: no HTTP listener
exists until P-12 mounts the handlers, and no MCP client connection is
established (#12/#13).

## Accepted — multi-architecture HTTP container image

Accepted on actual main 25e79ba, 2026-11-05 (`make check` rc=0, 97 files / 2128
tests; main CI run 41990665178 built and smoke-tested both architectures,
evidence (archived evidence `runs/13-acceptance-1.md`)): [F-013 v2](features/F-013-http-image.md),
[BR-172–BR-188](business-rules/README.md#pending--http-image) and
[BR-015 v4](business-rules/BR-015.md). A production `Dockerfile` builds a
non-root `runtime` image and a dev-only `smoke` image for linux/amd64 and
linux/arm64 (`make image`, `make image-smoke`, CI job `image`); nothing is
pushed. Generic Compose/Traefik and YAML examples and
[deployment guidance](docs/deployment.md) are templates: at that SHA the
runtime container reported that the runtime was not implemented and exited 1;
F-014 later supplies the runtime.

Update — accepted on main `18c2325`, 2026-11-11 ([F-013 v3](features/F-013-http-image.md),
[BR-187 v2](business-rules/BR-187.md), acceptance (archive issue 101)):
[deployment guidance](docs/deployment.md) states that the runtime image serves
kDrive and adds a personal-server step-by-step guide and a Troubleshooting
section. The guide has not been run on a real server.

## Accepted injected scope — bounded extracted content

Accepted on actual main 7b046a0, 2026-11-03 (`make check` rc=0, 61 files / 1576
tests plus 4 package tests, evidence (archived evidence `runs/14-acceptance-1.md`)): [F-009 v1](features/F-009-bounded-content-reading.md),
[BR-109–123](business-rules/README.md#pending--bounded-extracted-content) and
[BR-060 v4](business-rules/BR-060.md). Ten injected reads include strict decoded
text, selected-page text from a conservative classic PDF profile, and complete
resized PNG images from admitted PNG/JPEG sources. Full version-bound downloads,
code-point continuation, pre-parser expansion/producer limits and owned worker
termination are bounded. No OCR, arbitrary PDF compatibility, provider version
qualification or production entrypoint is established at that SHA; #6/#7 passed later with F-014.

## Accepted — OIDC qualification tooling and validator

Accepted on actual main 2cec566ab8e2f030dbbbf47f04bf541e5eb48dc4, 2026-11-03, with owner-run
AC-20 on actual main 7b046a0446930ab6a935510314c6c1b975d13550: [F-008 v1](features/F-008-oidc-qualification.md),
[BR-094–BR-108](business-rules/README.md#pending--oidc-provider-qualification)
and the Infomaniak discover (archived evidence `runs/11-acceptance-infomaniak-1.md`), Infomaniak token (archived evidence `runs/11-acceptance-infomaniak-token-1.md`), Gitea discover (archived evidence `runs/11-acceptance-gitea-1.md`) and Gitea token (archived evidence `runs/11-acceptance-gitea-token-1.md`) reports.
The qualification tooling and the access-token validator in `src/auth/` are
accepted. Both real providers are `proxy-only`: Infomaniak issues opaque access
tokens and Gitea access JWTs lack `iss`, `aud` and `sub`, while both return a
usable ID token. Every matrix client resolves to `proxy`; P-21 is promoted to
0.2 and Infomaniak is the selected production provider. No HTTP listener or
OAuth runtime exists, and no MCP client connection is tested.

## Accepted injected scope — bounded raw content and resources

Accepted on actual main4f84e4bb5343274d779ff43061effb60aa3cb64b,2026-11-03;
see #10 acceptance (archived evidence `runs/10-acceptance-1.md`): [F-007 v1](features/F-007-bounded-downloads.md),
[BR-082–BR-093](business-rules/README.md#accepted--raw-content-and-resources) and
[BR-060 v3](business-rules/BR-060.md). Nine injected read tools and one complete
binary resource template share fresh configured/received read policy. Raw
continuation uses byte offsets/qualified strong ETags; base64-inclusive output,
reader cleanup and centralized read retries are bounded. No real provider version
semantics, adapter or production entrypoint is qualified at that SHA; #6/#7
production ACs passed later with F-014.

## Accepted injected scope — filtered collection continuation

Accepted on actual main `30e059ef8ef3540c4aa4bb6a0de0bf209c963b12`,2026-11-02;
see #9 acceptance (archived evidence `runs/9-acceptance-1.md`): [F-006 v1](features/F-006-filtered-pagination.md),
[BR-072–BR-081](business-rules/README.md#accepted--filtered-pagination),
[BR-060 v2](business-rules/BR-060.md) and [BR-065 v2](business-rules/BR-065.md).
At that accepted SHA eight injected read tools share guarded metadata and five paged collections.
Opaque session-bound single-use handles, finite state, ordered roots and a
shared five-list-call budget preserve truthful remaining-work semantics.
Complete received proofs remain mandatory; provider qualification is absent.

## Accepted injected scope — stdio navigation

Accepted on actual main209a68de956b328e04e2d98d6745128a587184bd,2026-11-02;
see #8 acceptance (archived evidence `runs/8-acceptance-1.md`): [F-005 v1](features/F-005-stdio-navigation.md) and
[BR-059–BR-071](business-rules/README.md#pending--injected-stdio-navigation).
At its accepted SHA, the SDK server/stdio runner exposed four guarded read tools with exact scalar
metadata, configured/default drive isolation, scoped terminal lists, guarded
path resolution and bounded sanitized I/O. F-006 extends that version as described above. Actual SDK child/client tests use
synthetic evidence only. The packaged CLI retains its exact unavailable-runtime
diagnostics; no production adapter, credential binding, working user-facing
kDrive connection, provider qualification, HTTP/resources or release is claimed.
#6/#7 production ACs passed later with F-014.

## Accepted — mutation audit gate

Accepted on actual main 005b9ba8e5b4115c5b14844e3fc23b7ea8079242, 2026-11-10 (`make check` rc=0, 123 files / 2945
tests; PR #84 CI green; evidence (archived evidence `runs/17-acceptance-1.md`)):
[F-016 v1](features/F-016-mutation-audit-gate.md) (#17),
[BR-234–BR-259](business-rules/README.md#accepted--mutation-audit-gate),
BR-069 v2 and BR-070 v2. In `write` and `share` modes the
CLI opens a JSONL audit sink (stderr or a private file) and binds the policy
`execute` dependency to a gate that records an intent before and an outcome after
each upstream write, retries 429 only and reports timeouts and 5xx as `uncertain`.
No write tool is registered yet and no mutator exists (#18–#20); received-share
writes stay denied.

## Accepted — production kDrive read adapter

Accepted on actual main 2a9c1e3cd82b10d701e003aeea180d1000088787, 2026-11-09
(owner-run `make kdrive-acceptance`, AC-23–AC-26 all pass, 249 GET within the
400 bound; AC-01–AC-22 by the merged suites and CI of PRs #71, #75–#78,
evidence (archived evidence `runs/70-acceptance-4.md`)): [F-014 v7](features/F-014-production-kdrive-adapter.md),
[BR-190–BR-217](business-rules/README.md#pending--production-kdrive-adapter),
BR-016/028/071/123/175 v2 and
[ADR-006](architecture-decisions/ADR-006-builtin-https-kdrive-transport.md).
The packaged CLI runs production preflight and serves stdio or HTTP with a
read-only adapter on the fixed Infomaniak API origin, with upstream pages of
50 entries. The acceptance run read a real drive through stdio and HTTP tools
and resources, both configured-tree runs (A and B) with a 1,001-child
traversal, received shares (discovery, reads, refusals, revocation after 60 s)
and a version change. Read-only: no mutation reaches kDrive.

## Accepted — separate received-share policy

Accepted 2026-11-09: [F-004 v1](features/F-004-received-share-policy.md),
[BR-047–BR-058](business-rules/README.md#pending--received-share-access-policy)
and [BR-042 v2](business-rules/BR-042.md); AC-01–AC-13 by unit tests (green on
main `5ede9d6`), production AC-14/AC-15 through F-014 AC-25 on main `2a9c1e3`
(evidence (archived evidence `runs/7-acceptance-4.md`)). Opt-in discovery of received shares,
root/child reads with recipient paths, a list-only read cache below 60 seconds
(revocation enforced once the snapshot is 60 s old) and fresh capability-gated
mutation simulations. Re-sharing and external-root enumeration deny. No real
write is issued.

## Accepted — configured-tree policy

Accepted 2026-11-09: [F-003 v2](features/F-003-tree-access-policy.md),
[BR-029–BR-046](business-rules/README.md#pending--configured-tree-access-policy);
AC-01–AC-18 by unit tests (green on main `5ede9d6`), production AC-19/AC-20
through F-014 AC-23/AC-24 on main `2a9c1e3` (evidence (archived evidence `runs/6-acceptance-1.md`)).
Configured drive roots, deny patterns and operation effects are enforced on real
kDrive metadata with fresh checks, including a 1,001-child descendant proof; the
qualified `kdrive_info` tool and `kdrive://` resource dispatch through the
guarded facade (BR-043).

The foundation below is accepted on `main`; the production read-only kDrive
adapter (F-014) and the F-003/F-004 access policies are accepted above.

Planned capabilities are tracked in the backlog (archive `docs/github-backlog.md`), not
listed as available here. Future feature PRs may add clearly provisional entries.
Only successful AC checks on `main`, recorded in the feature issue, establish
acceptance; that issue is authoritative while repository markers await their
next appropriately scoped, reviewed PR. Synchronize markers before release and
link F-NNN/BR-NNN records; no separate closure PR is mandatory per feature.
See the [specification index](docs/spec-index.md) and [draft policy](docs/delivery-policy.md).

## Accepted — diagnostic package and development foundation

Accepted on main `f2d38b32dbbd78059da6754bb11d9b8e561fd645`, 2026-11-01;
see the AC acceptance evidence (archived evidence `runs/28-acceptance-1.md`) and completed
#3 (archive issue 3) /
#28 (archive issue 28).

- Diagnostic ESM executable and injectable isolated per-drive metadata client:
  [F-001 v4](features/F-001-typescript-foundation.md), [BR-002 v1](business-rules/BR-002.md), [BR-003 v1](business-rules/BR-003.md),
  [BR-004 v1](business-rules/BR-004.md). No MCP server or real kDrive adapter.
- Docker/Make development, mandatory quality CI and local V8 coverage:
  [F-001 v4](features/F-001-typescript-foundation.md), [BR-009 v1](business-rules/BR-009.md),
  [BR-010 v1](business-rules/BR-010.md), [BR-015 v1](business-rules/BR-015.md),
  [BR-012 v1](business-rules/BR-012.md).
- Official scanner with the existing Project analysis token, scanner-owned
  authentication/Quality Gate waiting and guarded external local-file input:
  [F-001 v4](features/F-001-typescript-foundation.md), [BR-014 v1](business-rules/BR-014.md).
  The merged wrapper's exact-main task passed its built-in Quality Gate.
  Optional CI Sonar remains disabled; no project-privacy proof, release or
  publication is claimed.

## Accepted — configuration and injected startup preflight

Accepted on main `88bf8caa7412988e11099a4a01f9e600aa38eeee`, 2026-11-01;
see the AC acceptance evidence (archived evidence `runs/33-acceptance-1.md`) and completed
#4 (archive issue 4),
#31 (archive issue 31) and
#33 (archive issue 33).

Local CLI/environment/explicit-YAML configuration,
bounded source precedence, explicit multi-drive/root selection, cumulative
levels, guarded credential-file input and redacted diagnostics; plus injected
drive-role and root-resolution validation. See
[F-002 v2](features/F-002-configuration.md),
[BR-016 v1](business-rules/BR-016.md), [BR-017 v1](business-rules/BR-017.md),
[BR-018 v1](business-rules/BR-018.md), [BR-019 v1](business-rules/BR-019.md),
[BR-020 v1](business-rules/BR-020.md), [BR-021 v1](business-rules/BR-021.md),
[BR-022 v1](business-rules/BR-022.md), [BR-023 v1](business-rules/BR-023.md),
[BR-024 v1](business-rules/BR-024.md), [BR-025 v1](business-rules/BR-025.md),
[BR-026 v1](business-rules/BR-026.md), [BR-027 v1](business-rules/BR-027.md) and
[BR-028 v1](business-rules/BR-028.md).

Local preparation selects stdio or HTTP but always reports that its runtime is
unimplemented. Preflight is tested through synthetic injected dependencies;
there is no production kDrive resolver, MCP/HTTP listener, OAuth-provider
qualification or implemented access policy. Acceptance establishes only the
local configuration and synthetic injected-preflight scope described above;
no release is established. BR-016 supersedes the original diagnostic invocation
[BR-001 v1](business-rules/BR-001.md), whose statement remains historical.
