# Foundation dependency and client-boundary decision proposal

Status: historical proposal for F-001 v3 / issue #3, promoted to
[ADR-001](../../architecture-decisions/ADR-001-typescript-development-foundation.md).
ADR-001 records the accepted design; feature implementation remains pending
acceptance. The proposal text below preserves the pre-freeze reasoning and is
not a separate current decision or implementation authorization.

## Context

The umbrella draft names TypeScript/Node LTS and the official MCP SDK v1 package,
but targets MCP 2026-07-28. The official SDK v1 maintenance documentation states
that protocol version is unsupported and unplanned; current stable v2 supplies
separate Apache-2.0 packages. Upstream Infomaniak's API client is SDK-independent.
At its pinned 1.2.0 revision it declares MIT in package metadata and README,
without a standalone LICENSE file or source copyright header.
Sources and proposed exact versions are recorded in
[F-001](../../features/F-001-typescript-foundation.md#primary-sources-checked-on-2026-11-01).

## Decision

Propose Node 26.13.0 LTS, npm, strict ESM TypeScript and the official stable v2
server package, with zod and Vitest. Keep project original code MIT and preserve
third-party license obligations separately. Compile with TypeScript, without
bundling. Pin direct dependencies and commit an npm lockfile.

Run all development tools inside a `dev` Compose service built from
`Dockerfile.dev`, using official Node 26.13.0 Bookworm pinned to a verified
registry digest before committing implementation. Docker/Compose is the only
host toolchain requirement, with existing Make as the requested orchestrator.
Makefile supports GNU Make 3.81/4.x and exposes setup/check plus focused targets;
default help needs no network/daemon. Recipes propagate failures and delegate
development tools to containers. Bind-mount the checkout; isolate dependencies
and npm cache in dedicated named volumes. Run normal commands as non-root with
documented UID/GID mapping and writable outputs. Include fixture Git in the
image, plus Make for fake-Docker fixture tests, and call the same host Make targets
in all five CI jobs. Provide no
socket mount, privileged mode, ports, default secrets or deployment runtime.
Production Docker packaging remains P-13.

Keep dedicated type-aware ESLint/typescript-eslint, formatter and compiler checks;
add matching Vitest V8/LCOV coverage. Introduce an opt-in official SonarScanner
container targeting the user's remote Community Build, never a local Qube server.
Local Make check remains credential-free. Remote publication uses a verified
private project and exact clean main snapshot, fresh matching coverage, scanner-
only runtime token and bounded Quality Gate waiting. Enable trusted-main CI only
after version/analyzer/image/access facts are verified; never analyze fork PRs.

Create a narrow SDK-independent per-drive metadata port with an injected async
adapter and validated numeric IDs. Supply no real HTTP adapter at foundation.
Record Infomaniak provenance/comparison baseline in NOTICE, explicitly stating
that no source has yet been copied. Move adaptation to P-05 after resolving the
missing upstream notice; no invented copyright holder/date is permitted.

## Options rejected (why)

- Retain SDK v1: creates a known mismatch with the umbrella protocol target and
  a migration before any protocol feature has been built.
- Import upstream's entire server: couples tools/transports and unsafe defaults
  to a foundation that has no policy or configuration yet.
- Copy the declared-MIT client immediately: leaves provenance incomplete and
  carries unused mutation methods into a feature that has no product operations.
- Build a generic HTTP framework now: freezes error/retry/auth/response contracts
  before their owning tickets have evidence and reviewed specifications.
- Adopt TypeScript 7 immediately: current typescript-eslint support is below 6.1.
- Install Node/npm, Git or quality tools on the host: contradicts the user's
  explicit Docker-only development requirement.
- Run a different CI toolchain directly on the runner: loses the agreed shared
  development image and command path.
- Use host Node helpers or recent-Make-only syntax: adds unwanted host
  dependencies or breaks the user's existing macOS GNU Make 3.81.
- Reuse the production image: introduces P-13 deployment scope and dependencies
  irrelevant to the diagnostic foundation.
- Rely on Sonar alone for local lint/type/format checks: introduces network and
  credential dependencies into ordinary development.
- Run a local SonarQube server or community PR/branch analysis: contradicts the
  user's remote topology and the documented Community feature boundary.
- Assume current docs prove installed 26.4 analyzer compatibility or allow scanner
  project auto-creation: risks unsupported analysis or private-source exposure.

## Consequences

F-001 v3 needs a new independent approval and autonomous freeze under the
project waiver. Preserve v1/v2 snapshots and supersede changed BRs without ID
reuse; issue #3 scope and P-05 prerequisites must reflect retained decisions.
Installing v2 proves no end-to-end MCP or auth compatibility. P-05 cannot copy
the upstream client until provenance is resolved and reviewed. Its production
adapter may replace the narrow port through a later frozen contract when needed.
Toolchain compatibility still requires actual installation and quality-gate
evidence after freeze. Publication remains a separate human-authorized action.
Docker access and daemon-visible bind paths are execution prerequisites; no
Docker runtime is claimed here. Never work around a denied daemon by installing
host development tools. Named volumes survive normal cleanup and require explicit
authorization before deletion; clean-volume checks use a fresh project name.
The observed remote UI version is Community Build 26.4.0.121862; installed JS/TS
analyzer support and scanner pairing remain activation prerequisites. No remote
project, gate, setting, token or source upload is created by this proposal.
