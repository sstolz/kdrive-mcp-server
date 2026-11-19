---
id: F-046
title: Compose example identity allowlists
ticket: "#112"
status: done
version: 1
---

## Context

The owner decision of 2026-11-19 (#99, decision C) makes the existing
subject-based identity allowlist usable from `examples/compose.yaml` without
requiring an e-mail allowlist. The example currently passes only
`OAUTH_ALLOWED_EMAILS`, as a required Compose variable. Users who prefer
provider subjects must edit the example even though the server already accepts
subjects only, e-mails only, or both lists.

`examples/compose-traefik.yaml`, lines 64–67, already has the intended two
empty-default variables and two-line guidance. The server already refuses an
authenticated HTTP configuration when both lists are empty. This ticket aligns
the deployment example and its checks; it changes no server behavior.

Sources: [BR-184 v3](../business-rules/BR-184.md),
[BR-186 v2](../business-rules/BR-186.md),
[BR-024 v5](../business-rules/BR-024.md),
`tests/deployment-examples.test.ts`, `tests/helpers/deployment.ts`,
`src/config-values.ts` and `tests/config-value-boundaries.test.ts`.
The existing refusal is `ConfigurationError` with code `MISSING_REQUIRED`
and setting `oauthAllowedSubjects` (the `P-BR024-002` boundary case).

This is the light full path and is not security-sensitive, as directed for
#112. The orchestrator re-checks the feature and rule versions on current main
before freeze and before opening the implementation PR.

## Scope

1. In `examples/compose.yaml`, replace the required e-mail variable with the
   exact allowlist block below, immediately after `OAUTH_ISSUER`. Preserve all
   other settings and the existing required/optional header distinction;
   update the header's F-035 line to name the optional identity allowlists too,
   using the exact wording in BR-184 v4 below.
2. Adapt `tests/deployment-examples.test.ts` and
   `tests/helpers/deployment.ts` to the three permitted empty-default variables.
   Keep the existing service-hardening, secrets, routing, healthcheck, header
   and trusted-proxy checks. Test the parsed service environment through
   `loadConfiguration` for all four identity-list combinations.
3. Align `docs/deployment.md`: both allowlist rows in the server
   configuration table, the Compose-variable table (add subjects and remove
   the unconditional e-mail requirement), and the step-by-step `.env` example.
   State that either list may individually be unset or empty, at least one
   combined entry is required by the server, and subjects are preferred because
   an e-mail address can be reassigned. Align the setup snippet and adjacent
   allowlist guidance in `README.md` with the same choice as a content check
   verified by diff review, bound to no BR. Keep the existing
   exact-address and verified-email guidance. The search found no
   `docs/configuration*` file; `docs/oauth-proxy.md` already describes subjects
   or e-mails and needs no change for this ticket.
4. Version BR-184, BR-186 and BR-187 as specified below; update their histories,
   examples, verification, `business-rules/README.md`, `capability-map.md` and
   the Unreleased CHANGELOG entry as pending acceptance for #112. Keep the
   accepted versions until acceptance on the actual merged main SHA. Done
   specifications remain historical; the versioned rules are authoritative.
5. As a separate record synchronization under AGENTS.md §6, set F-045 v1 to
   `done` and BR-239 v2, BR-293 v2 and BR-295 v3 to `active`. Synchronize
   their markers in `business-rules/README.md`, `capability-map.md` and the
   #96 CHANGELOG entry. Link the acceptance records to
   `<#96 acceptance comment URL>`; the orchestrator replaces this placeholder
   with the verified acceptance permalink before the implementation PR.
   Verify this scoped record diff against that comment; it introduces no rule
   version or behavior change.
6. Include the two cosmetic test fixes deferred from #96 review: correct the
   banner immediately before `describe("F-045 state-store open flags", ...)`
   in `tests/auth/proxy-store.test.ts` (near line 316) so it identifies F-045
   rather than the unrelated AC-03 block; restore a blank separator between
   the F-045 describe block and `function errno` in `tests/audit-sink.test.ts`
   (near line 111). Verify by diff and formatting checks; no assertion or test
   behavior changes.

### Out of scope

- Any change under `src/`, including validation, errors or identity matching.
- Changes to `examples/compose-traefik.yaml`; it is the read-only reference.
- #110 and #111.
- Other deployment settings, credential handling, provider qualification,
  live deployment acceptance or release work.

## Business rules

Keep existing IDs, accepted text and history. Allocate no new BR or ADR.
BR-184 v3, BR-186 v2 and BR-187 v3 remain accepted until the proposed versions pass
acceptance on actual main. Add the new versions as `pending acceptance` with
dated F-046 v1 history entries in the implementation PR. This specification
activates no #112 rule.

- **BR-184 v4** — v3 holds except that its phrase "the only variable of the
  file with a default" is replaced by an exact set of three variables:
  `MCP_HTTP_TRUSTED_PROXIES`, `OAUTH_ALLOWED_SUBJECTS` and
  `OAUTH_ALLOWED_EMAILS`, each using `${NAME:-}` with an empty default.
  The service environment contains this exact consecutive block after
  `OAUTH_ISSUER`, with the same two comment lines as the Traefik example:

  ```yaml
  # Allowlist: set at least one of the two lists (the server refuses both
  # empty). Prefer subjects; an e-mail address can be reassigned (SPEC.md).
  OAUTH_ALLOWED_SUBJECTS: ${OAUTH_ALLOWED_SUBJECTS:-}
  OAUTH_ALLOWED_EMAILS: ${OAUTH_ALLOWED_EMAILS:-}
  ```

  The required/optional and file-secret header lines remain unchanged. Replace
  the header line mentioning F-035 and "optional trusted proxies below" with
  this exact line:

  ```yaml
  # Optional trusted proxies (F-035, accepted on main 703bece) and identity allowlists (F-046) below.
  ```

  Its loading checks substitute supplied values or empty defaults for those
  three variables, RFC 2606 values for required installation variables and
  temporary synthetic credential-file paths for the file-secret references.
  Subjects only, e-mails only and both lists load as transport `http`, OAuth
  mode `proxy`, retaining the expected `oauthAllowedSubjects` and
  `oauthAllowedEmails` arrays. Both lists empty are refused with the existing
  `ConfigurationError`, code `MISSING_REQUIRED`, setting
  `oauthAllowedSubjects`. The trusted-proxy checks still cover its empty
  default and the existing nonempty synthetic network value. All other v3
  hardening, routing, secrets and healthcheck requirements hold.
  Verified by: AC-01–AC-07 (AC-07 also checks the exact header line above).
- **BR-186 v3** — v2 holds, with the optional-empty-variable checks permitting
  exactly `MCP_HTTP_TRUSTED_PROXIES`, `OAUTH_ALLOWED_SUBJECTS` and
  `OAUTH_ALLOWED_EMAILS` in `examples/compose.yaml`. All other required
  installation-specific Compose values remain `${NAME:?…}` variables.
  Nonempty defaults and any other optional variable are refused by these
  checks. The header still distinguishes required values from optional empty
  defaults and states that credentials are file secrets only; its optional
  settings line is exactly the BR-184 v4 header line above. Existing host,
  address and path hygiene holds. Verified by: AC-07.
- **BR-187 v4** — v3 holds, plus `docs/deployment.md` documents both
  `OAUTH_ALLOWED_SUBJECTS` and `OAUTH_ALLOWED_EMAILS` in the server
  configuration table, the Compose-variable table and the step-by-step `.env`
  example. Each list may individually be unset or empty; the server requires
  at least one combined entry. Guidance prefers subjects because an e-mail
  address can be reassigned. The exact per-location assertions are in AC-08.
  Verified by: AC-08.

BR-186 is bumped because its test contract actually changes:
`validateComposeAdmission` currently permits only the trusted-proxy empty
default, and `validateHygiene` applies that check to `examples/compose.yaml`.
Leaving the tests unchanged rejects the requested allowlist block. The broader
required/optional wording and privacy purpose are retained.
BR-024 v5 is reused unchanged for the existing combined-allowlist requirement
and error identity. BR-314 v1 binds the state-file comments and stays unchanged.
BR-187 v4 extends v3's deployment-guidance requirements with the allowlist
guidance above, retaining its existing purpose. BR-314's
historical unchanged-test claim describes its own feature, not a prohibition
on later versioned example changes. No other rule found by the
`OAUTH_ALLOWED` search binds the Traefik allowlist block.

## Acceptance criteria

All named tests below belong to `tests/deployment-examples.test.ts`.
Before changing the example, characterize the existing BR-024 v5 loading
matrix using parsed example settings with explicit synthetic allowlist values.
Then add the exact-block and hygiene cases and observe their failures on the
old example/helper before implementation. Do not pass unexpanded Compose
expressions to `loadConfiguration`. Separate required-value fixtures from
optional values; the old loop requiring every `SAMPLE` entry to match
`${NAME:?…}` cannot include the optional allowlists.

- **AC-01 (BR-184 v4)** — Given the parsed Compose service and its raw text,
  When its allowlist block is inspected, Then both environment entries equal
  the specified `${NAME:-}` expressions and the exact two comment lines
  immediately precede them after `OAUTH_ISSUER`. A missing entry, required
  e-mail expression, or missing/altered comment fails the check. Verified by
  `BR-184 v4 AC-01 Compose passes both optional allowlists with exact guidance`.
- **AC-02 (BR-184 v4, BR-024 v5)** — Given the resolved Compose environment
  with subjects `subject-1` and e-mails unset or explicitly empty, When
  `loadConfiguration` runs, Then it loads HTTP proxy mode with
  `oauthAllowedSubjects=["subject-1"]` and `oauthAllowedEmails=[]`.
  Verified by `BR-184 v4 BR-024 v5 AC-02 Compose loads subjects only`, with
  unset and empty rows.
- **AC-03 (BR-184 v4, BR-024 v5)** — Given that environment with subjects
  unset or explicitly empty and e-mails `user@example.com`, When
  `loadConfiguration` runs, Then it loads HTTP proxy mode with
  `oauthAllowedSubjects=[]` and `oauthAllowedEmails=["user@example.com"]`.
  Verified by `BR-184 v4 BR-024 v5 AC-03 Compose loads emails only`, with
  unset and empty rows.
- **AC-04 (BR-184 v4, BR-024 v5)** — Given that environment with subjects
  `subject-1` and e-mails `user@example.com`, When `loadConfiguration` runs,
  Then it loads HTTP proxy mode retaining both one-entry arrays. Verified by
  `BR-184 v4 BR-024 v5 AC-04 Compose loads both allowlists`.
- **AC-05 (BR-184 v4, BR-024 v5)** — Given that environment with both
  variables unset or explicitly empty, When their Compose defaults resolve
  and `loadConfiguration` runs, Then it rejects with name
  `ConfigurationError`, code `MISSING_REQUIRED`, setting
  `oauthAllowedSubjects`, and message
  `Configuration error [MISSING_REQUIRED] (oauthAllowedSubjects).` Verified by
  `BR-184 v4 BR-024 v5 AC-05 Compose refuses both empty allowlists`, covering
  all unset/empty combinations with otherwise complete valid settings.
- **AC-06 (BR-184 v4)** — Given the updated example with a nonempty identity
  allowlist and each existing trusted-proxy fixture, When its environment loads
  and the retained service checks run, Then the trusted-proxy arrays and all
  existing hardening, secrets, routing and healthcheck assertions still pass.
  Verified by the adapted
  `BR-184 v4 AC-06 the Compose example passes an optional empty trusted-proxy list`
  and retained `BR-184` service tests. Repeat acceptance on actual merged main.
- **AC-07 (BR-184 v4, BR-186 v3)** — Given the updated example, When hygiene
  checks run, Then exactly the three permitted empty defaults pass with the
  unchanged required/optional and file-secret header lines and the exact new
  optional-settings header line specified in BR-184 v4. A missing or altered
  new header line, a nonempty default for each permitted variable, an additional
  optional variable, an existing required value made optional, or the old
  all-required header is rejected. Verified by
  `BR-186 v3 AC-07 required and optional variables match the Compose header`.
- **AC-08 (BR-187 v4)** — Given `docs/deployment.md`, When its scoped
  allowlist content is inspected, Then these assertions hold (table cell text
  and prose phrases are case-sensitive after whitespace collapsing):

  - The server configuration table has rows for both `OAUTH_ALLOWED_SUBJECTS`
    and `OAUTH_ALLOWED_EMAILS`; each row's `Required?` cell is exactly
    `No individually; at least one entry across both lists`.
  - The prose immediately after that table names both variables, states that
    either may be unset or empty and the server requires `at least one`
    combined entry, and prefers subjects because an e-mail address can be
    `reassigned`.
  - The Compose-variable table has rows for both `OAUTH_ALLOWED_SUBJECTS` and
    `OAUTH_ALLOWED_EMAILS`; each row's `Required?` cell is exactly
    `No individually; at least one entry across both lists`. In particular,
    the e-mail row no longer has the unconditional `Yes` cell.
  - The step-by-step `.env` example in
    `### 4. Configure Compose behind the reverse proxy` contains assignments
    for both `OAUTH_ALLOWED_SUBJECTS` and `OAUTH_ALLOWED_EMAILS`.

  Verified by
  `BR-187 v4 AC-08 deployment guidance explains either or both allowlists`;
  inspect `docs/deployment.md` only, not this specification or record indexes.

The implementation runs `make check` through the Docker-only project gate,
then mandatory PR CI and independent review. Acceptance repeats the scoped
checks on actual main and records commands, results and SHA in #112.
The #96 record and cosmetic items use the content, link, diff and formatting
checks stated in Scope; no unit test is added for prose-only synchronization.

## Decisions

- Choose two empty-default allowlist variables and copy the exact Traefik
  comment, per #99 decision C. Compose can resolve either variable as empty;
  the existing server validation enforces the combined requirement.
- Reject retaining required e-mails or requiring both lists. Either would
  prevent the requested subject-only setup.
- Choose BR-184 v4, BR-186 v3 and BR-187 v4, preserving their existing purposes and
  histories. Reject new BR IDs for the same deployment and hygiene contracts.
  Keep BR-024 v5 unchanged because configuration behavior is already correct.
- Keep BR-186 v3 limited to example hygiene: the exact three empty-default
  variables and header checks extend v2 without adding operator guidance.
  BR-187 already binds the deployment guide's sections and content, so v4
  retains v3 and adds the allowlist guidance under that existing purpose.
- Update the Compose header's F-035 line to the exact BR-184 v4 wording,
  naming optional trusted proxies and identity allowlists without claiming
  F-046 is accepted. Preserve the required/optional and file-secret lines;
  AC-07 checks the same header for BR-184 v4 and BR-186 v3.
- Choose parsed-example loading tests and explicit empty-default resolution.
  Reject source changes or a new startup validation mechanism.
- Choose focused alignment of `docs/deployment.md` and `README.md`; keep
  already-correct OAuth reference guidance. README alignment is a content
  check verified by diff review, bound to no BR; AC-08 covers only
  `docs/deployment.md`. Startup contains no allowlist text and needs no
  alignment. Reject expanding this ticket into
  #110, #111 or changes to the Traefik reference example.

## Open questions

## Stress-test

- **112-spec-1-reviewer, finding 1 (major) — retained.** Keep BR-186 as example hygiene, add deployment guidance to BR-187 v4, and verify README alignment by diff without a BR because these match the existing rule purposes.
- **112-spec-1-reviewer, finding 2 (minor) — retained.** Remove Startup from Scope's alignment list and AC-08 because it contains no allowlist text.
- **112-spec-1-reviewer, finding 3 (minor) — retained.** AC-08 now fixes assertions per table, adjacent prose and step-by-step `.env` example, including exact `Required?` cells, to make the guidance testable.
- **112-spec-1-reviewer, finding 4 (minor) — retained.** Specify the exact replacement header line naming optional allowlists and align BR-184 v4, BR-186 v3 and AC-07 so the header describes all optional settings.

## Acceptance synchronization

Accepted on actual main `e8ae20d`, 2026-11-19 ([#112 acceptance](https://github.com/sstolz/kdrive-mcp-server/issues/112#issuecomment-7014711154)). Status synchronized in #111.
