# ADR-002 — Official scanner validation with the existing Project analysis token

Status: accepted design; implementation pending acceptance after F-001 v4 autonomous freeze.
Date: 2026-11-01. Source: F-001 v4, issue #28, BR-014/015.
Supersedes only ADR-001's remote Sonar privacy/installed-compatibility proof
prerequisites. All unaffected ADR-001 foundation decisions remain applicable.

## Context

The user selected the existing `kdrive-mcp-server` project at
`https://sonar.example.org` and authorized analysis with its provisioned
Project analysis token. Custom Browse-protected metadata and Quality Gate calls
block that supported token. ADR-001's prerequisite demands independent privacy
and installed-pairing verification; the user's scanner-only decision changes it.

## Decision

Use the pinned official scanner for HTTPS authentication, actual analyzer/server
compatibility, analysis and built-in Quality Gate waiting. The reviewed committed
properties fix the existing server/key. No custom Sonar REST probes or gate
queries remain. Runtime SONAR_TOKEN is supplied only to the scanner service,
through selected environment mode or an explicit existing read-only external
file mount; no broader token, copying, persistence or GitHub transfer.
Both public analysis targets reject unsafe supported credential locations before
any dev/test prerequisite, using narrow nonsecret POSIX path checks. Environment
mode cannot bypass an existing in-checkout supported local credential path.

Retain clean exact trusted-main provenance, immutable read-only source and fresh
LCOV, non-root work/cache volumes, 300-second gate wait and the shared 15-minute
preparation-through-gate deadline. The official report's project/server/task
identity and local SHA/run/manifest binding associate the scanner result with
this invocation. Successful built-in waiting and scanner exit 0 establish its
gate; no invented report gate/SHA field or second API validation is required.

## Options rejected (and why)

- Broader user/admin/read tokens: unnecessary rights beyond the provided token.
- Custom privacy/installed-analyzer/gate probes: require unsupported Browse
  access and duplicate official scanner responsibilities.
- Disabling gate waiting or treating upload as success: leaves task processing
  and Quality Gate outcomes unverified.
- Alternate keys, project creation or visibility/settings changes: exceed the
  explicitly authorized existing target.
- Host secret loading or copied token files: expose credentials beyond the
  scanner's runtime boundary and violate Docker-only development.

## Consequences

The selected existing target is authorized; this workflow neither proves its
privacy independently nor changes visibility. Scanner access, analyzer or gate
errors remain failures with exact diagnostics after credential redaction.
Live exact-main acceptance remains mandatory; fixture success is insufficient.
Local provisioning neither enables CI Sonar nor transfers secrets to GitHub.
No release, product runtime, production image or upstream-client decision changes.
