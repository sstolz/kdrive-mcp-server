# F-001 — TypeScript package and isolated client foundation

Status: done. Version: 4. Ticket: #28 (archive issue 28), revising #3 / P-03 (archive issue 3).
Date: 2026-11-01. Depends on: reviewed and merged P-02 documentation baseline.
Revises [frozen version 3](history/F-001-v3.md); see the [history index](history/README.md).
BR-001–BR-004, BR-009, BR-010 and BR-012 retain their meaning.
BR-014 replaces BR-013; BR-015 replaces BR-011. Earlier rules remain historical.
Rules became active after acceptance; see the completion record below.

## Context

Contributors need a reproducible package before product work. The user requires
Docker-based development automated through Make, without host toolchain installation.
Version 4 applies the user's working official-scanner method to the existing
`kdrive-mcp-server` project. A Project analysis token is already provisioned;
custom Browse-protected metadata and Quality Gate API calls block its use.
Remove those custom calls and let the official scanner authenticate, analyze
and wait for its Quality Gate. CLI/client behavior, Docker/Make, SDK v2,
fresh immutable main coverage and deferred upstream copying remain unchanged.

## Scope / Out of scope

Deliver an ESM TypeScript package, a diagnostic-only executable, an injectable
per-drive client boundary, Docker/Make quality commands, coverage and mandatory PR CI.
Include package licensing/provenance, installation/contribution instructions,
an environment-name example and ignored environment/key-file paths. Preserve
the French historical sources unchanged. The dependency decision proposal is
[here](../docs/adr-proposals/typescript-foundation.md); it is not an accepted ADR.

No real kDrive requests, credentials, copied upstream implementation, product
configuration, policy, tools/resources, MCP transport, HTTP listener, OAuth,
extraction, production container or publication. Client adaptation/provenance
remain P-05; the production image remains P-13. No host Node/npm/TypeScript,
lint/test/build tools or host Git installation is required by this workflow.
No local SonarQube server, remote project creation/settings changes, token creation,
broader credentials, PR decoration or branch analysis. Local provisioning does
not authorize GitHub secret transfer or CI activation. Preparing an actual clean
Git checkout for acceptance is a one-off operational step, not a new checkout
bootstrap product or Make target. Existing files/data must be preserved.
Remote acceptance uses the explicit selected target and scanner validation
below; local checks remain independent.

## Business rules

- **BR-001:** The package is named `kdrive-mcp-server`, is ESM, supports Node
  `>=26.13.0 <27`, and builds an executable `dist/cli.js` exposed as
  `kdrive-mcp-server`. `--version` prints the package version and exits 0;
  `--help` prints diagnostic usage and exits 0; every other invocation prints
  `Server runtime is not implemented yet.` to stderr and exits 1. These paths
  make no network request, read no deployment configuration and start no server.
- **BR-002:** A client instance binds one positive safe-integer drive ID for
  its lifetime. Its sole foundation operation `info(fileId)` accepts a positive
  safe-integer file ID and delegates exactly once to an injected metadata
  adapter with that instance's drive ID and supplied file ID. Invalid IDs fail
  before adapter invocation. Interleaved instances never exchange drive IDs.
- **BR-003:** The injected metadata adapter is the boundary's only data-access
  dependency. `info` returns the adapter's result unchanged as `unknown`, or
  propagates its rejection unchanged, without retry. Importing or constructing
  the boundary performs no I/O. The foundation supplies no production adapter.
- **BR-004:** The distributable contains the MIT license for original project
  code, README, NOTICE and built executable; NOTICE names upstream repository,
  pinned revision, actual MIT declarations and the absence of copied source.
  A positive package-file allowlist excludes environment/key files, tests,
  reports and development source. Root `.gitignore` excludes `.env`, `.env.*`
  except `.env.example`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `secrets/`,
  `node_modules/`, `dist/`, coverage and generated archives. `.env.example`
  contains names with empty values only; no secret value is read or generated.
- **BR-010 (replaces BR-007):** Installation, lint, format, typecheck, tests,
  build and packing run through the Make targets below, delegating to
  `docker compose run --rm dev <command>` using
  the committed lockfile/toolchain and service defined below. Container commands
  are `npm ci`, `npm run lint`, `npm run format:check`, `npm run typecheck`,
  `npm test`, `npm run build` and `npm pack --pack-destination artifacts`.
  They are reproducible non-watch commands. Lint rejects errors and
  warnings, formatting checks without rewriting, typecheck checks source/tests,
  tests fail when none are discovered, and build fails on type errors.
  Dedicated TypeScript quality analysis uses ESLint/typescript-eslint with
  type-aware recommended rules and `no-floating-promises`; Prettier remains the
  formatter and the TypeScript compiler remains the type checker.
- **BR-015 (replaces BR-011):** Every PR against `main` and push to `main` runs workflow
  `CI`, without path filters, with stable jobs `lint`, `format`, `typecheck`,
  `test` and `build`. Each runs `make setup` with the same development Dockerfile,
  then its corresponding Make target; `test` runs `make build` before `make coverage`
  for executable/artifact tests, and `build` runs `make build` and `make pack` to check the
  packed artifact/executable inside `dev`. Failed steps fail
  the job. Permissions are `contents: read`; there are no publish/release/tag
  steps, write permissions, deployment secrets or tag-triggered release paths.
  A separate `sonar` job runs only after successful local gates, for trusted
  `main` push/manual-main events, with explicit `SONAR_ENABLED=true` configuration
  and separately provisioned runtime `SONAR_TOKEN`. No server/analyzer/scanner
  version or compatibility-evidence environment variables are required: the
  pinned scanner validates the actual server interaction. This local-token
  change neither provisions a GitHub secret nor enables that job. PR/fork events never receive the token
  or upload analysis. Enabled analysis cannot turn a missing configuration,
  failed Quality Gate, network error or timeout into success. Analysis job runs
  are serialized per project; no PR/branch parameters or decoration are configured.
- **BR-009:** Host workflow prerequisites are Docker with Compose (`docker compose`)
  and the user's existing Make, used solely as orchestrator. Makefile supports
  GNU Make 3.81/4.x, with POSIX recipes and no host Node/npm/Git, jq, Python or
  extra helper CLI dependencies. Default target and `make help` display usage
  without network, image pulls or daemon access. `make setup` builds `dev`,
  initializes fresh volume permissions and runs container `npm ci`; all quality,
  build/pack/shell targets delegate to Compose. `make check` runs the ordered
  gates below, stops on first failure and preserves nonzero Docker/npm failures
  for Make/CI. Parallel Make cannot race initialization with consumers or run
  competing/destructive volume setup. No target deletes volumes or cleans
  automatically. `Dockerfile.dev` uses official `node:26.13.0-bookworm`, pinned to its
  verified manifest-list digest before implementation is committed, and supplies
  Git inside the image. `compose.yaml` defines `dev` with checkout bind-mounted
  at `/workspace`, project-scoped named volumes at `/workspace/node_modules`
  and `/home/node/.npm`, and no default secrets, `env_file`, host credential
  passthrough, exposed/published ports, privileged mode or Docker socket mount.
  Normal commands run unprivileged; documented UID/GID mapping supports writable
  Linux bind mounts without root-owned outputs. Fresh volumes are initialized
  for that identity; any ownership setup is confined to the two named volumes,
  never recursive ownership changes to the checkout. `dist/`, `artifacts/` and
  the committed lockfile persist in the checkout; dependencies/cache remain in
  their volumes. Container commands need no host Node/npm/Git. Routine cleanup
  preserves volumes; volume deletion requires separate explicit authorization.
  Build context excludes environment/key files, `secrets/`, dependencies and
  output directories; no user credential is copied into the development image.

- **BR-012:** `make coverage` runs Vitest with the pinned matching
  `@vitest/coverage-v8` version in `dev`, including all `src/**/*.ts` in coverage
  scope, and creates nonempty `coverage/lcov.info` plus machine-readable source/
  test/config/lockfile digests. A failing test never yields a reusable success
  marker. `make sonar` regenerates coverage in its own run against the exact
  committed main snapshot to upload; missing, stale, failed-run or mismatched
  reports are rejected before upload. Reports use project-relative source paths.
- **BR-014 (replaces BR-013):** `make sonar` runs only the official SonarScanner Docker image in
  an opt-in Compose analysis service, against base URL
  `https://sonar.example.org`, project key `kdrive-mcp-server`, both read
  from and checked against the reviewed committed `sonar-project.properties`.
  The user's explicit selection of this existing target authorizes upload;
  its visibility is not independently claimed or changed. No custom Sonar REST
  preflight, authentication, metadata, compatibility or Quality Gate request is
  made. Only the scanner owns HTTPS authentication, analysis and gate waiting.
  There is no project-creation call, fallback key or credential escalation;
  missing target/access fails with the scanner diagnostic. Use the already
  supplied Project analysis token, never a new user/admin/read token. Only an
  exact clean `main` commit verified against the repository's trusted main SHA
  can be uploaded; dirty/feature/fork/PR sources fail preflight. Source and LCOV
  are mounted read-only from the same immutable analysis snapshot; scanner work
  and cache use distinct named writable volumes with verified non-root access.
  There is no local Qube server, Docker socket, privileged mode or host Java/Node.
  The token reaches only the scanner service at runtime as `SONAR_TOKEN`, never
  dev/test processes, CLI arguments, Make echo, logs, committed properties,
  generated token files, `.env` or configuration dumps. An explicit local
  `SONAR_TOKEN_FILE` selector may name the already provisioned
  `.config/qube-token` using its absolute path from a separate clean checkout.
  File mode requires that path to be outside the active dev checkout bind;
  reject a selector inside that checkout before starting dev/tests/snapshot.
  Both `make sonar` and `make quality` first run a nonsecret POSIX entry guard,
  before any Make prerequisite or command can build/start dev or run tests.
  In every credential mode the guard rejects when the exact supported
  `.config/qube-token` path exists (`test -e`) or is a symlink (`test -L`)
  inside the active checkout, directing the caller to an isolated clean checkout.
  It neither reads content nor searches for other credentials. File selectors
  must be absolute: compare the physical checkout/containing-directory paths
  after resolving `..` and directory symlink aliases, and reject a final-component
  file symlink rather than following it. A selector that resolves inside the
  checkout is rejected before dev starts, even through an alias.
  Only the analysis service mounts that exact file read-only, with host-path
  auto-creation disabled; its existing-image Node wrapper reads it in memory
  and supplies `SONAR_TOKEN` to the scanner child. No host reader/toolchain,
  copying, sourcing or credential discovery is allowed. Environment mode uses
  a supplied `SONAR_TOKEN` without mounting a credential file. Both selected
  modes together, no selected mode, empty/whitespace token, unreadable file or
  multiline token fail before scanner launch. One terminal LF/CRLF is allowed
  for a local file. Dev/test mounts cannot expose the local credential.
  Exclude the exact `.config/qube-token` path from build/packing and reject
  it if tracked before snapshot export; preserve neighboring `.config` files.
  These path rules are verified only with synthetic fixture credentials.
  Scan uses `sonar.javascript.lcov.reportPaths=coverage/lcov.info`, waits for its
  own task's Quality Gate with a 300-second gate timeout and one shared 15-minute
  overall deadline measured from snapshot preparation, covering snapshot export,
  build/fresh coverage, validation and scanner/gate waiting without resetting
  between stages. Expiry terminates owned active subprocess/container work,
  fails nonzero and prevents subsequent upload. Analysis fails on any
  upload/processing/gate/network/timeout error. The wrapper propagates nonzero
  scanner exit status (or nonzero failure for signal/timeout), captures its
  stdout/stderr without raw forwarding, replaces every literal occurrence of
  the credential with `[REDACTED]` before emitting output, and otherwise preserves
  the scanner diagnostic. Redaction must cover repeated occurrences and token
  fragments split across stream chunks; no generic message replaces the error.
  Debug/verbose/property-dump modes and user scanner argument injection are disabled.
  A fresh unique `sonar.scanner.metadataFilePath` must not exist before launch.
  After scanner exit 0, its official report must contain the expected
  `projectKey=kdrive-mcp-server`, `serverUrl=https://sonar.example.org`
  and a nonempty `ceTaskId`; stale, absent or wrong-target metadata fails.
  Bind that invocation locally to the trusted SHA, run ID and source/LCOV
  manifest and pass `-Dsonar.scm.revision=<trusted SHA>` because the snapshot
  omits `.git`. The official report is not required to contain a SHA or gate
  field. Zero scanner exit after enabled built-in waiting proves this task's
  successful gate; retain its redacted gate diagnostic as evidence, without
  inventing report fields or making a second API check.
  After that entry guard, `make quality` runs local `make check`, then guarded
  `make sonar`; standalone `make check`
  needs no Sonar configuration/token/server. Neither target changes remote
  project visibility, profiles, gates, permissions or server settings.

## Acceptance criteria

Planned tests below are obligations, not existing files or passing evidence.
Every test names its BR in its test title/comment. Use synthetic IDs/data only.

- **AC-01 (BR-001):** Given a clean build and no deployment configuration, When
  the diagnostic executable is invoked with each supported flag, no arguments
  and an unknown flag, Then output/exit status match BR-001 and a network-denying
  test guard observes zero requests. Planned `tests/cli.test.ts`; repeat the
  executable checks against the tarball after build and on merged `main`.
- **AC-02 (BR-002):** Given clients for drives 101 and 202 sharing a recording
  adapter, When concurrent/interleaved `info` calls use distinct file IDs, Then
  recorded calls retain each drive/file pair exactly once. Given zero, negative,
  fractional, unsafe, NaN or infinite IDs, When construction/call is attempted,
  Then it rejects before adapter invocation. Planned `tests/kdrive/client.test.ts`.
- **AC-03 (BR-003):** Given an adapter returning an object or rejecting with a
  sentinel error, When `info` runs, Then the exact object/error identity reaches
  the caller once. Given an I/O-denying guard, When the module is imported and a
  client constructed, Then no I/O occurs. Planned `tests/kdrive/client.test.ts`.
- **AC-04 (BR-004):** Given an isolated package fixture containing synthetic
  `.env`, key and report filenames, When the real package allowlist is applied
  with `npm pack --dry-run --json`, Then required distribution files are included
  and those fixtures are absent; no real secret paths are inspected. Planned
  `tests/package.test.ts` also checks ignored fixture paths using `git check-ignore`
  in a temporary fixture repository. Review actual provenance/license text.
- **AC-05 (BR-010):** Given a clean checkout and the built `dev` image, When all
  commands run through Make/Compose, Then they exit 0 without changing tracked files. Given
  isolated temporary fixtures with respectively a lint error, bad formatting,
  type error, failing assertion or zero tests, When the corresponding command
  runs, Then it exits nonzero. Planned `tests/quality-commands.test.ts` uses
  subprocesses outside normal test discovery to avoid recursive test runs.
  A valid TypeScript fixture containing an unhandled Promise fails the dedicated
  lint rule without depending on formatting or compiler diagnostics.
- **AC-06 (BR-015):** Given the proposed workflow configuration, When its
  trigger/permissions/job policy is validated, Then all BR-015 constraints hold;
  a fixture with a skipped gate or write permission is rejected. Planned
  `tests/ci-policy.test.ts`. Then verify the real PR's five named checks and their
  executed steps on GitHub; local policy tests alone do not prove CI ran.
- **AC-07 (BR-009):** Given a fresh Compose project name (new dependency/cache
  volumes), accessible Docker daemon/checkout and no host Node/npm/Git toolchain in
  the execution path, When `make help`, `make setup` and `make check` run, Then
  help needs no daemon/network and installation,
  all gates and packing succeed inside `dev`; lockfile is unchanged, the packed
  CLI executes inside `dev`, dependencies/cache use the named volumes and outputs
  are writable by the checkout owner. Record UID/GID and mount evidence. Planned
  `tests/dev-environment.test.ts` checks isolation constraints with negative
  fixtures and exercises the real Makefile with a fake Docker command to prove
  fail-fast/nonzero propagation and default help. The dev image supplies Make
  solely for those fixture tests, without nested Docker. Actual host Make/Compose
  evidence checks runtime facts and GNU Make 3.81 compatibility.
  No Docker client/socket is needed inside test containers. New volumes may be
  left unused after evidence collection; do not delete existing volumes to test.
- **AC-08 (BR-012):** Given container tests and coverage, When coverage runs,
  Then unexecuted source files remain in LCOV and the success metadata matches
  its inputs. Given stale metadata, changed source/lockfile, failing tests or
  absent/empty LCOV, When analysis preflight runs, Then upload is rejected.
  Planned `tests/coverage-contract.test.ts` uses temporary source/report fixtures.
- **AC-09 (BR-014):** Given an exact clean trusted-main snapshot, fresh matching
  coverage and a synthetic Project analysis token, When the fake official
  scanner runs, Then it alone performs remote interaction, uses reviewed
  server/key and built-in gate wait, and succeeds only on exit 0 with fresh
  matching task metadata (`projectKey`, `serverUrl`, nonempty `ceTaskId` in a
  fresh run-specific file). Assert the invocation's trusted SHA argument and
  local run/source/LCOV binding; use a realistic official report fixture with
  no invented SHA/gate fields. A network-denying wrapper guard records zero custom
  REST calls; no legacy version/evidence environment variables are needed.
  Missing/mutated server/key, disabled analysis, dirty/feature/fork/PR source,
  stale/missing LCOV, bad snapshot digests or stale/missing/wrong-target task metadata
  prevent success. Planned `tests/sonar-analysis.test.ts`, including retained
  provenance/snapshot tests and negative branch/PR property/argument fixtures.
- **AC-10 (BR-014):** Given synthetic environment and file-token fixtures, When
  each mode is selected independently, Then only the analysis service/child
  receives `SONAR_TOKEN`; dev/tests never receive or can read it, and no token
  argument, generated credential file, snapshot, image or package contains it.
  Both modes, absent mode, empty/whitespace, invalid multiline, missing file
  and a file selector inside the active dev checkout fail closed;
  LF/CRLF-terminated file values work. Planned
  `tests/sonar-analysis.test.ts` and `tests/dev-environment.test.ts` verify mounts,
  Make routing and exclusions using temporary fixture paths only. Neither tests
  nor preparation inspect the real credential file.
  Invoke both public targets with synthetic in-checkout selectors, `..` and
  symlink aliases, and prove zero dev/test launches before rejection, including
  Make prerequisite launches. In environment mode, synthetic existing and
  dangling-symlink `.config/qube-token` paths also fail before dev/test launches.
  Safe external-file and clean environment-mode fixtures pass the entry guard.
- **AC-11 (BR-014):** Given fake scanner success, failed gate, processing error,
  network error, nonzero exit, signal or hang, When analysis runs, Then only a
  successful built-in gate wait exits 0, all other cases fail within the bounded
  shared deadline and owned active subprocess/container work is terminated on
  expiry. Snapshot preparation and fresh-coverage hang fixtures must also fail
  within the same original deadline and never launch an upload, using an
  injected short clock rather than waiting 15 minutes. Stage completion cannot
  reset the remaining budget. Given diagnostic text with
  the synthetic token repeated and split across chunks, Then emitted output
  contains `[REDACTED]` for every occurrence and preserves the remaining exact
  scanner diagnostic and nonzero exit. Planned `tests/sonar-analysis.test.ts`.
- **AC-12 (BR-014, BR-012):** Given the merged exact trusted `main` SHA and the
  user-provisioned local Project analysis token, When `make sonar` runs with
  explicit enablement/file selector, Then the official scanner publishes to
  the selected kdrive project and completes its built-in Quality Gate wait.
  Record source/main SHA, source/LCOV digests, image digest/reported scanner
  version, nonsecret server/analyzer versions if emitted, task identity, scanner
  exit and gate result in #28. No REST privacy/compatibility proof is required
  or claimed. A failed live gate leaves acceptance open. Successful fixture
  tests, an upload alone or issue #3's partial acceptance do not satisfy this AC.

Before implementation, record a failing client-fixture test for AC-02/03 and its
later successful run in `runs/P-03-development-1.md`. The PR maps all ACs to actual
tests and output. After merge, repeat acceptance at the exact `main` SHA, record evidence in the
existing issue and synchronize repository markers under the updated AGENTS workflow.

## Decisions

1. **Proposed toolchain:** Node 26.13.0 / its bundled npm 11.20.0, TypeScript
   6.0.3, `@modelcontextprotocol/server` 2.4.0, zod 4.6.7, Vitest 5.0.5 and
   matching `@vitest/coverage-v8` 5.0.5,
   ESLint 10.14.0, typescript-eslint 8.72.1 and Prettier 3.9.10. Exact direct
   versions and resolved transitive versions are committed in the lockfile.
   `@types/node` uses a released 26.x patch pinned during installation; this
   mechanical patch selection does not change the runtime contract. No package
   was installed to prepare this spec. Compatibility is a required gate, not a
   claim of successful installation. TypeScript 7 is rejected because the current
   typescript-eslint support range ends below 6.1.0.
2. **SDK update retained:** replace the umbrella's v1 package
   name with official stable v2. The v1 maintenance README explicitly excludes
   MCP 2026-07-28 support, the umbrella §8 target. V2 is Apache-2.0, while project
   original code remains MIT; preserve required dependency notices. No protocol
   compatibility or auth implementation is claimed by installing the SDK.
   Only the server package is required now; a client SDK waits for real MCP tests.
3. **Boundary:** `src/kdrive/client.ts` exports an interface with readonly
   `driveId` and `info(fileId): Promise<unknown>`, plus a factory accepting the
   drive ID and an async `(driveId, fileId) => unknown` metadata adapter. This
   small port is SDK-independent. Reject a generic HTTP engine or speculative
   methods: they would freeze contracts belonging to P-05 and later features.
4. **Upstream:** revision `857272d7fd42c0940ae389b9092b1c4cd2351337`, tag `1.2.0`,
   `src/kdrive-client.ts`, is the comparison baseline. Its client has no SDK
   import. Its README/package declare MIT, but root listing and `LICENSE` 404
   provide no standalone notice. Do not invent an upstream copyright statement
   or copy its code now. P-05 must resolve provenance before adaptation; document
   the pinned/current comparison procedure and local changes when reuse begins.
5. **Build/package:** strict TypeScript NodeNext, emit to `dist/`, no bundler or
   runtime transpiler. Package and `VERSION` start at proposed `0.1.0` unreleased;
   changing metadata does not cut a release. README top/package description state
   unofficial/non-affiliation. No `prepare` hook, automatic publish or semantic-release.
6. **Development and CI:** use `Dockerfile.dev`/`compose.yaml`, the same base
   digest and commands locally/on a Docker-capable GitHub Ubuntu runner. Pin
   Actions to full SHAs. CI calls the same Make targets; no host setup-node
   or host npm command is used. The image asserts Node/npm/Git versions. Image
   digest is resolved from the official registry during implementation and
   recorded with evidence; no digest is invented here. No tooling is installed
   on the user's computer. Existing host Make is expressly requested; no new host
   tooling is installed. Image changes authorize no Docker engine changes.
7. **Storage/identity:** use dedicated `node_modules` and `npm_cache` volumes;
   initialize their permissions through the image or a narrowly scoped setup
   step. UID/GID parameters default to the image's non-root node identity and
   map to the checkout owner on Linux. Document macOS Docker Desktop behavior
   and prove write access rather than assuming numeric ownership translation.
   Dependency/lockfile updates run inside `dev`; no lockfile is baked over or
   hidden by a volume. Add `artifacts/` to ignored build output. Docker's daemon
   must have access to the bind-mounted checkout; remote-daemon path provisioning
   is an execution prerequisite, not permission to install host tooling.
8. **Quality:** retain dedicated ESLint/typescript-eslint, formatter and compiler
   as distinct local checks. Add V8/LCOV coverage without inventing a local
   percentage threshold or changing the remote gate. `make check` retains its v2
   order and no remote dependency; `make coverage` is additive. CI's `test` job
   runs tests with coverage, preserving the five existing required check names.
9. **Official scanner owns remote validation:** retain the committed official
   `sonarsource/sonar-scanner-cli` image at digest
   `sha256:47956b669bf486bdad919e1cbd0533223515aa0b6d1d31763e5a3754942df6d7`,
   platform `linux/amd64`, and record its reported CLI version. The current
   Compose comment records CLI 8.1.0.6389 and Node 22.23.2; this spec author has
   not rerun that image. Reuse image runtimes for the wrapper/scanner; no host
   Java/Node or speculative compiler downgrade. Reject custom REST probes or
   manual installed-analyzer allowlists: they demand Browse access beyond the
   provided token and duplicate the official scanner. A scanner/analyzer error
   remains a visible failure; compatibility is established by live operation,
   not asserted from a version string or disabled gate.
10. **Explicit existing-target acceptance:** the user selected
    `https://sonar.example.org` / `kdrive-mcp-server` and authorized live
    analysis with the provisioned Project analysis token. Hullgate is an example
    only; never copy its key. Use reviewed properties, reject alternate target
    overrides and branch/PR flags. This revision explicitly removes v3's private
    visibility proof prerequisite; no privacy claim or remote setting change is
    made. The scoped token and fixed existing key avoid project creation; no
    creation workflow or fallback is implemented. Reject broader tokens or a new
    admin/read credential as a workaround. Failed selected-target access blocks
    remote acceptance and preserves the official error; it does not block local
    checks. CI enablement remains a separate future authorized operation.
    [ADR-002](../architecture-decisions/ADR-002-official-scanner-validation.md)
    supersedes only ADR-001's remote Sonar prerequisites upon this revision's
    approved freeze; ADR-001's foundation decisions and immutable text remain.
11. **Snapshot and CI:** verify clean main/commit in the dev container, then use
    an isolated immutable snapshot of that committed tree for fresh coverage and
    scan. Recheck digests before upload. Exclude reports, dependency/cache data,
    environment/key files, `.config/qube-token` and development output from `sonar.sources=src`;
    `sonar.tests=tests`. Mount snapshot/coverage read-only; put
    `sonar.working.directory` on the writable work volume and scanner user home/
    cache on a separate volume. No Compose-wide token interpolation or verbose
    scanner diagnostics/configuration dumps. Only the scanner service receives
    the token. CI runs analysis from protected/trusted `main` workflow definitions
    after local gates, serializes per project, and never consumes PR artifacts.
    No `pull_request_target`, `sonar.branch.*` or `sonar.pullrequest.*` parameters.
    Manual runs must target main. A real clean checkout and trusted remote main
    reference are mandatory; synthetic Git identity or dirty-input exemptions
    are rejected. Scan publication is the only authorized Sonar mutation.
12. **Credential loading and diagnostics:** select environment mode with
    `SONAR_TOKEN`, or file mode explicitly with nonsecret `SONAR_TOKEN_FILE`.
    Do not probe a default file or discover credentials. File mode mounts the
    existing exact path read-only only into analysis; the image's Node wrapper
    reads it without copying or persisting it and constructs the scanner child's
    runtime environment. The selected file remains outside the active dev
    checkout bind, as in the separately prepared clean-checkout acceptance run;
    an in-checkout selector fails before dev starts rather than exposing it.
    Both `quality` and `sonar` run the same entry guard before all Make
    prerequisites. Even environment mode rejects the exact supported local
    credential path if it exists/is symlinked in that checkout, using only
    POSIX metadata tests. Resolve physical parent/checkouts for selector aliases;
    reject final file symlinks. This narrowly checks the explicitly supported
    path and selected mount location, not arbitrary secret discovery. Authoring
    and tests use only synthetic fixtures; do not probe the real provisioned file.
    No broad `.config` directory exclusion or mount change is needed. The
    selector is not an alternate scanner credential: the
    scanner still receives only `SONAR_TOKEN`. Capture scanner output and redact
    the literal token before logging, including split stream chunks. Disable
    debug/property dumps; retain the exact remaining error and failed status.
    Generic diagnostics conceal actionable permission/gate errors and are rejected.

### Make targets and Docker-only development sequence

Run from the checkout. Make only orchestrates Docker; Node/npm and fixture tools
execute inside `dev`. Target contract:

| Target | Action |
|---|---|
| `help` (default) | Print usage; no Docker operation |
| `setup` | Compose build, safe volume setup, container `npm ci` |
| `lint` / `format-check` | Container `npm run lint` / `npm run format:check` |
| `format` | Container `npm run format`; explicit formatting writes only |
| `typecheck` / `build` | Container `npm run typecheck` / `npm run build` |
| `test` | Container `npm test`, after the required build |
| `pack` | Container packing plus packed CLI verification |
| `check` | Sequential lint, format-check, typecheck, build, test, pack; fail fast |
| `shell` | Interactive shell inside `dev` |
| `coverage` | Container Vitest V8 coverage and current-input success metadata |
| `sonar` | Entry credential/mount guard before dev prerequisites, trusted-main snapshot/fresh coverage, official scanner/gate wait |
| `quality` | Entry credential/mount guard before dev prerequisites, then local `check` and guarded `sonar`; fail fast |

```sh
make help
make setup
make check
```

Quality targets require successful setup; standalone targets report an actionable
setup prerequisite rather than using host tools. The image/setup creates writable
output directories; container command equivalents remain documented for diagnosis.
Document first-time UID/GID setup and container-only lockfile generation before
`npm ci` exists; subsequent clean installs use the committed lockfile. Container
subprocess tests reuse installed tools and never invoke Docker recursively.
Pack/executable inspection runs inside `dev`; ordinary stopped-container cleanup
does not include `down --volumes`, `volume rm` or pruning. This sequence is a
contract, not evidence that the current sandbox can reach a Docker daemon.

The analysis service is behind an opt-in Compose profile and never starts through
ordinary setup/check/shell targets. Store only nonsecret scanner properties in
the repository; environment mode forwards `SONAR_TOKEN` by name at runtime,
while explicit local file mode reads only inside the analysis service. No raw
credential is an argument value or committed `.env`. Quality Gate polling uses
`sonar.qualitygate.wait=true` and `sonar.qualitygate.timeout=300`, with the separate
15-minute process/job limit. Runtime scanner requirements and image architectures
remain the selected pinned image's responsibility; record its identity/version
as acceptance evidence. A nonsecret local invocation is
`SONAR_ENABLED=true SONAR_TOKEN_FILE=/absolute/path/to/.config/qube-token make sonar`.
The file is not sourced by a host shell and is never mounted into dev/tests.

### Primary sources checked on 2026-11-01

- [Node 26.13.0 LTS](https://nodejs.org/en/blog/release/v26.13.0) and
  [bundled npm](https://github.com/nodejs/node/blob/v26.13.0/deps/npm/package.json).
- [Official SDK v2](https://github.com/modelcontextprotocol/typescript-sdk),
  [server manifest](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/server/package.json),
  [v1 maintenance limitations](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/README.md).
- [Infomaniak pinned source](https://github.com/Infomaniak/mcp-server-kdrive/blob/857272d7fd42c0940ae389b9092b1c4cd2351337/src/kdrive-client.ts),
  [pinned package/license declaration](https://github.com/Infomaniak/mcp-server-kdrive/blob/857272d7fd42c0940ae389b9092b1c4cd2351337/package.json),
  [pinned README](https://github.com/Infomaniak/mcp-server-kdrive/blob/857272d7fd42c0940ae389b9092b1c4cd2351337/README.md).
- [typescript-eslint compatibility](https://typescript-eslint.io/users/dependency-versions/),
  [Vitest 5.0.5](https://github.com/vitest-dev/vitest/releases/tag/v5.0.5),
  [ESLint 10.14.0](https://github.com/eslint/eslint/releases/tag/v10.14.0),
  [typescript-eslint 8.72.1](https://github.com/typescript-eslint/typescript-eslint/releases/tag/v8.72.1),
  [Prettier 3.9.10](https://github.com/prettier/prettier/releases/tag/3.9.10),
  [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/).
- [Official Node image tags/architectures](https://github.com/docker-library/official-images/blob/master/library/node)
  lists `26.13.0-bookworm`; [pinned image recipe](https://github.com/nodejs/docker-node/blob/34e1b0030b415bdea959ccb15afda976a0761346/26/bookworm/Dockerfile)
  sets Node 26.13.0. No registry digest was resolved or image pulled in this revision.
- [Compose one-off commands](https://docs.docker.com/reference/cli/docker/compose/run/),
  [service settings](https://docs.docker.com/reference/compose-file/services/),
  [named volumes](https://docs.docker.com/reference/compose-file/volumes/),
  [bind mounts](https://docs.docker.com/engine/storage/bind-mounts/).
- [SonarScanner CLI/Docker/environment and cache](https://docs.sonarsource.com/sonarqube-community-build/analyzing-source-code/scanners/sonarscanner),
  [official scanner image recipe](https://github.com/SonarSource/sonar-scanner-cli-docker/blob/master/Dockerfile).
- Rechecked for v4: [Project analysis token scope](https://docs.sonarsource.com/sonarqube-community-build/user-guide/managing-tokens)
  and [token environment/analysis parameters](https://docs.sonarsource.com/sonarqube-community-build/analyzing-source-code/analysis-parameters/parameters-not-settable-in-ui).
  Project tokens are restricted to their project; official documentation supports
  `SONAR_TOKEN` and discourages writing credentials to files or passing CLI values.
  The existing user-provisioned file is input only, never generated by this workflow.
- [Community feature limits](https://docs.sonarsource.com/sonarqube-community-build/feature-comparison-table),
  [Quality Gate wait/timeout and CI token guidance](https://docs.sonarsource.com/sonarqube-community-build/devops-platform-integration/github-integration/adding-analysis-to-github-actions-workflow),
  [analysis parameters/work directory](https://docs.sonarsource.com/sonarqube-community-build/analyzing-source-code/analysis-parameters/parameters-not-settable-in-ui).
- [LCOV property](https://docs.sonarsource.com/sonarqube-server/analyzing-source-code/test-coverage/javascript-typescript-test-coverage),
  [current Community language support](https://docs.sonarsource.com/sonarqube-community-build/analyzing-source-code/languages/javascript-typescript-css),
  [26.4 release](https://github.com/SonarSource/sonarqube/releases/tag/26.4.0.121862),
  [Vitest coverage](https://vitest.dev/guide/coverage).

## Open questions

None. Live scanner success remains an acceptance obligation, not a design
question or a claim made by this draft. Docker access and an actual exact-main
checkout remain execution prerequisites without host-toolchain fallback.

## Stress-test

Version 4 author: GPT-6.1 Sol, high reasoning. Round 1 reviewer: GPT-6 Astra,
high reasoning, fresh independent context. Report (archived evidence `runs/28-spec-review-1.md`),
2026-11-01: **changes** against SHA-256
`6c807262392fc7ad94f68a84816ac5fc22b7205a0d9ba66aabb26459739f010e`.

- **R1 (major), retained:** credential/mount-safety validation must precede all
  dev/test prerequisites of both public analysis targets. Add physical-path
  alias and environment-mode exposure cases; selecting env alone is no exclusion.
  A narrow POSIX metadata guard rejects the exact supported local path in every
  mode, while file mode rejects in-checkout physical paths/final symlinks. This
  prevents exposure without new configuration, broad masking or secret discovery.
- **R2 (major), retained:** allocate ADR-002 to supersede only ADR-001's Sonar
  privacy/compatibility proof decision. Keep ADR-001 unchanged and ledger explicit,
  so accepted historical architecture cannot conflict with this revision.
- **R3 (minor), retained:** require official report project/server/task fields
  and a fresh unique metadata path, bind the invocation to manifest/SHA locally,
  and pass trusted `sonar.scm.revision`; successful built-in wait supplies gate
  proof. Do not invent report SHA/gate fields or duplicate API validation.
- **R4 (minor), retained:** extend AC-11 to preparation and fresh-coverage hangs,
  one original deadline across stages, owned-work termination and no later upload.

Fresh independent review of the corrected draft approved without findings:
round 2 report (archived evidence `runs/28-spec-review-2.md`), GPT-6 Astra/high. The version 3
review/freeze record remains in its immutable history snapshot.

## Freeze and verification

Version 4 was autonomously frozen by the orchestrator on 2026-11-01 20:26:00 UTC.
Exact reviewed pre-freeze SHA-256:
`8f253c2249c6055002c8bff67bdcf3b29023daaec6982d7d304b7d18bf124eca`.
Evidence: fresh independent approval (archived evidence `runs/28-spec-review-2.md`); ticket #28
is ready and no open question remains. The user is notified of this hash and the
official-scanner-only/project-token decisions; no reply is required.
Record real RED tests for BR-014/015, implement only this revision,
run all local gates and mandatory PR CI, obtain fresh independent PR approval,
merge, and perform AC-09–AC-12 plus AC-06/08 regression acceptance on the actual
merged main SHA. Existing unaffected AC obligations from #3 remain intact;
#28 does not close #3 by proxy. No rule is active, capability accepted, release
tagged or package published by this spec revision's freeze.

## Acceptance and completion

All AC-01–AC-12 were accepted on actual merged main
`f2d38b32dbbd78059da6754bb11d9b8e561fd645` on 2026-11-01.
The acceptance report (archived evidence `runs/28-acceptance-1.md`) records Docker/Make gates,
128 passing tests, packed-artifact checks, successful mandatory main CI and the
current wrapper's successful official-scanner task with built-in Quality Gate
waiting. Issues #3 and #28 are closed as completed. This #4 record synchronization
marks BR-001–BR-004, BR-009, BR-010, BR-012, BR-014 and BR-015 active;
BR-013 and BR-011 are superseded by BR-014 and BR-015 respectively.
The reviewed contract and historical freeze evidence above are unchanged.
Foundation acceptance supplies no MCP runtime, real kDrive adapter, release,
publication, project-privacy proof or optional CI Sonar activation.
