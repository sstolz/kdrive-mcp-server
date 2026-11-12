# Specification index

F-001 v4 is done and its applicable rules are accepted on actual `main`
`f2d38b32dbbd78059da6754bb11d9b8e561fd645`, 2026-11-01; see the
acceptance evidence (archived evidence `runs/28-acceptance-1.md`). Frozen v1/v2/v3 history and
accepted ADR text remain immutable. F-002 v1 is preserved frozen; v2 is done after
acceptance on actual main `88bf8caa7412988e11099a4a01f9e600aa38eeee`,
2026-11-01; see the final evidence (archived evidence `runs/33-acceptance-1.md`) recorded in
completed #4/#31/#33. BR-016–BR-028 are active and BR-001 is superseded by BR-016.
GitHub issue numbers are not feature/rule IDs.

The [business-rule index](../business-rules/README.md) provides all 123 canonical
records with human-readable summaries, explicit BR versions, concrete GWT
examples, verification mappings/gaps and explicit historical successor chains.
BR versions and source feature versions are independent; #35 creates an initial
versioned record of each existing definition, without inventing prior versions.
F-003 v1 adds BR-029–BR-046, accepted on 2026-11-09 with production AC-19/AC-20
executed through F-014 AC-23/AC-24 on main `2a9c1e3`.

## Source map

| Source                                                                                               | Meaning                                                                                             |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [AGENTS.md](../AGENTS.md)                                                                            | Existing working method                                                                             |
| [Delivery policy](delivery-policy.md)                                                                | English baseline aligned with corrected AGENTS; issue acceptance then scoped marker synchronization |
| [SPEC.md](../SPEC.md)                                                                                | Historical French umbrella draft v0.4; not a feature freeze                                         |
| [API notes](api-notes.md)                                                                            | Dated read observations; not proof of unmeasured writes or provider behavior                        |
| [Spec review](spec-review.md)                                                                        | Review of v0.3; reconcile with v0.4 per feature                                                     |
| GitHub backlog (archive `docs/github-backlog.md`) / issue export (archive `docs/github-issues.json`) | Planning and publication snapshots; not live execution status                                       |
| [Live issues](https://github.com/sstolz/kdrive-mcp-server/issues)                                    | Current ticket discussion/progress                                                                  |
| [Capability map](../capability-map.md)                                                               | Accepted foundation, local configuration and synthetic injected preflight                           |

## Allocation

The orchestrator allocates the next unused sequential number separately for F,
BR and ADR when authoring the corresponding artifact, records its ticket/path
here, and commits the allocation through that ticket's reviewed PR. Never derive
IDs from issue numbers, reuse abandoned IDs or renumber history. Record abandoned
allocations explicitly. Same-purpose rule changes retain their ID and increment
the BR version with History/tests updated; different-purpose replacements use a
new ID and explicit supersession. This prospective policy preserves the existing
chains and frozen definitions. The orchestrator allocated F-001 / BR-001–BR-015 for
#3/#28 and F-002 / BR-016–BR-028 for #4. Autonomous freeze requires a ready
ticket, no open questions and a fresh independent approval under AGENTS'
project waiver. F-001 v1's host-toolchain workflow remains historical and cannot
override the current Docker-only development contract.

### Feature ledger

| ID    | Ticket  | Spec path                                     | Status                                                                                                                                                                                                          |
| ----- | ------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-001 | #3, #28 | `features/F-001-typescript-foundation.md`     | Done v4; accepted 2026-11-01 on `f2d38b32dbbd78059da6754bb11d9b8e561fd645`                                                                                                                                      |
| F-002 | #4      | `features/F-002-configuration.md`             | Done v4 (accepted on main 00e6fe3 with F-012, BR-025 v2); v3 snapshot in history; frozen v1 preserved                                                                                                           |
| F-003 | #6, #7  | `features/F-003-tree-access-policy.md`        | Done v2, accepted 2026-11-09; BR-029–046 active; production AC-19/AC-20 via F-014 AC-23/AC-24 on main 2a9c1e3                                                                                                   |
| F-004 | #7      | `features/F-004-received-share-policy.md`     | Done v1, accepted 2026-11-09; BR-047–BR-058 active; production AC-14/AC-15 via F-014 AC-25 on main 2a9c1e3                                                                                                      |
| F-005 | #8      | `features/F-005-stdio-navigation.md`          | Done v2 (accepted on main 00e6fe3 with F-012, BR-059 v2); v1 snapshot in history; injected stdio only                                                                                                           |
| F-006 | #9      | `features/F-006-filtered-pagination.md`       | Done v1; accepted on main30e059ef8ef3540c4aa4bb6a0de0bf209c963b12; injected continuation only                                                                                                                   |
| F-007 | #10     | `features/F-007-bounded-downloads.md`         | Done v1; accepted injected scope on main4f84e4bb5343274d779ff43061effb60aa3cb64b                                                                                                                                |
| F-008 | #11     | `features/F-008-oidc-qualification.md`        | Done v1; accepted on main2cec566ab8e2f030dbbbf47f04bf541e5eb48dc4; AC-20 owner-run on main 7b046a0; both providers proxy-only                                                                                   |
| F-009 | #14     | `features/F-009-bounded-content-reading.md`   | Done v1, accepted on main 7b046a0; BR-109–123 / BR-060 v4 active; injected bounded extraction only                                                                                                              |
| F-010 | #21     | `features/F-010-oauth-proxy.md`               | Done v1; accepted on main 3fc14c3bbbd57b3c52ca4b74c07a512720f0d627; BR-124–143, BR-100 v2, BR-024 v2 active; no client connection                                                                               |
| F-011 | #50     | `features/F-011-pre-merge-quality-gates.md`   | Done v3, accepted on main bc09d56 (v1, v2 in history); BR-144–151, BR-010/012/014 v2, BR-015 v3 active; ADR-005; PR Quality Gate                                                                                |
| F-012 | #12     | `features/F-012-authenticated-http.md`        | Done v2 (#63, accepted on main 7b8b52d): BR-171 v2, BR-189 active; v1 accepted on main 00e6fe3 (AC-21 2026-11-04), BR-152–171 v1 active                                                                         |
| F-013 | #13     | `features/F-013-http-image.md`                | Done v3, accepted on main 18c2325; BR-172–188 (BR-187 v2) and BR-015 v4 active; image recipe, examples and personal-server guide                                                                                |
| F-014 | #70     | `features/F-014-production-kdrive-adapter.md` | Done v7, accepted on main 2a9c1e3 (v1–v6 in history); BR-190–217 and BR-016/028/071/123/175 v2 active; ADR-006 accepted; production read-only adapter                                                           |
| F-015 | #72     | `features/F-015-self-hosted-runner.md`        | Done v2, accepted on main de9b283; BR-218–233, BR-015 v5, BR-149/178/183 v2 active; ADR-007 accepted                                                                                                            |
| F-019 | #103    | `features/F-019-persistent-oauth-state.md`    | Done v1, accepted on main 68209fe (2026-11-11); BR-290, BR-292–304, BR-312–314 and BR-023/124/128/139/140/142/143/152/169 v2, BR-024 v3 active; AC-14–18 moved to #109; BR-291 and BR-305–311 reserved for #109 |
| F-020 | #104    | `features/F-020-dependency-audit.md`          | Done v1, accepted on main b6acf86 (2026-11-11); BR-315–321 and BR-015 v6, BR-122/225/227 v2 active; ADR-009 accepted                                                                                            |
| F-021 | #105    | `features/F-021-container-health-check.md`    | Done v1, accepted on main e208996 (2026-11-11); BR-322–327 and BR-154/156/162/167/168/180/181/184 v2, BR-187 v3 active                                                                                          |
| F-022 | #114    | `features/F-022-sonar-gate-summary.md`        | Done v2, accepted on main e7d6367 (2026-11-12); BR-328–340 (BR-335 v2) and BR-146 v2 active                                                                                                                     |
| F-023 | #1      | `features/F-023-hosted-ci-privacy-scan.md`    | Done v1, accepted on main ad25fa2 (2026-11-12); BR-341–352 and BR-015 v7, BR-149/183/225/227 v3, BR-229/320 v2 active                                                                                           |
| F-024 | #2      | `features/F-024-gated-publication.md`         | Frozen v2 (2026-11-12; v1 in history), implementation pending acceptance; BR-353–375, BR-378, BR-379 and BR-016/178 v3 pending; BR-376/377 withdrawn, never reused                                              |

Version history: [v1 immutable snapshot](../features/history/F-001-v1.md),
[v2 immutable snapshot](../features/history/F-001-v2.md),
[v3 immutable snapshot](../features/history/F-001-v3.md),
[history index](../features/history/README.md). Versioning does not allocate a new F ID.

F-002 v1 freeze evidence: review round 1 (archived evidence `runs/4-spec-review-1.md`),
fresh round 2 approval (archived evidence `runs/4-spec-review-2.md`) and the exact freeze record
in the [immutable v1 snapshot](../features/history/F-002-v1.md).
The [current v2](../features/F-002-configuration.md) was frozen at 21:29:17 UTC
after fresh v2 approval (archived evidence `runs/4-spec-v2-review-1.md`) of reviewed SHA-256
`7005d6d3322a10a76dff08cc6fb05dfe3641f8ab07586ca65ccf61563c100d4f`;
see the narrow revision note (archived evidence `runs/4-spec-author-2.md`). BR-016–BR-028 retain
their v1 rule statements. No new rule becomes active through this freeze.
F-005 v1 allocates BR-059–BR-071 for #8; records are prepared after reviewed
freeze with implementation. F-005 v2 (frozen with F-012 under #12) versions BR-059 to v2, accepted on main `00e6fe3`: the factory accepts HTTP preflight objects and the stdio runner keeps refusing them ([v1 snapshot](../features/history/F-005-v1.md)). #9 allocates F-006 / BR-072–BR-081 v1 and versions
BR-060/065 to v2 in its [frozen specification](../features/F-006-filtered-pagination.md).
#10 allocates F-007 / BR-082–BR-093 v1 and versions BR-060 to v3 in its
[frozen raw content contract](../features/F-007-bounded-downloads.md). Canonical
records are active for accepted #10 injected scope on main4f84e4bb5343274d779ff43061effb60aa3cb64b.
Concurrent allocation explicitly authorized for #11 and #14: #11 owns F-008 /
BR-094–108 on `claude/beautiful-maxwell-8mdk2w`; #14 owns
[F-009](../features/F-009-bounded-content-reading.md) / BR-109–123 v1,
versions BR-060 to v4 and records
[ADR-004](../architecture-decisions/ADR-004-bounded-extraction-dependencies.md).
#21 allocates F-010 / BR-124–BR-143 v1 and versions BR-100 and BR-024 to v2 in its
[frozen proxy contract](../features/F-010-oauth-proxy.md).
#50 allocates F-011 / BR-144–BR-151 v1, ADR-005, and versions BR-010, BR-012,
BR-014 and BR-015 to v2 in its [frozen quality-gate contract](../features/F-011-pre-merge-quality-gates.md).
#12 allocates F-012 / BR-152–BR-171 v1 and versions BR-025 (F-002 v4) and BR-059 (F-005 v2) to v2 in its [frozen authenticated-HTTP contract](../features/F-012-authenticated-http.md); the snapshots are [F-002 v3](../features/history/F-002-v3.md) and [F-005 v1](../features/history/F-005-v1.md), and the records are accepted on main `00e6fe3` (AC-21 on 2026-11-04).
#13 allocates F-013 / BR-172–BR-188 v1 and versions BR-015 to v4 in its [HTTP-image contract](../features/F-013-http-image.md) (v2), accepted on main `25e79ba`.
#63 versions BR-171 to v2 and allocates BR-189 v1 in [F-012 v2](../features/F-012-authenticated-http.md) ([v1 snapshot](../features/history/F-012-v1.md)); both accepted on main `7b8b52d`.
#70 allocates F-014 / BR-190–BR-217 v1, versions BR-016, BR-028, BR-071, BR-123 and BR-175 to v2, and proposes ADR-006 in its [production-adapter contract](../features/F-014-production-kdrive-adapter.md); later versions up to F-014 v7 version further rules (snapshots in `features/history/`); accepted on main `2a9c1e3` (evidence (archived evidence `runs/70-acceptance-4.md`)). #72 allocates F-015 / BR-218–BR-233 v1, versions BR-015 to v5 and BR-149, BR-178 and BR-183 to v2, and proposes ADR-007 in its [self-hosted-runner contract](../features/F-015-self-hosted-runner.md); F-015 v2 accepted on main `de9b283` (evidence (archived evidence `runs/72-acceptance-1.md`)). The next unused feature ID was then F-016 and the next unused business-rule ID BR-234.
#103 allocates F-019 / BR-290 and BR-292–BR-314 v1 (BR-291 and BR-305–BR-311 are reserved for #109 and never reused) and versions BR-023, BR-124, BR-128, BR-139, BR-140, BR-142, BR-143, BR-152 and BR-169 to v2 and BR-024 to v3 in its [persistent-state contract](../features/F-019-persistent-oauth-state.md); all were accepted on actual main `68209fe` on 2026-11-11 (evidence (archive issue 103)) and are active; the owner-run real-client restart check has not been run.
#104 allocates F-020 / BR-315–BR-321 v1, versions BR-015 to v6 and BR-122, BR-225 and BR-227 to v2, and writes ADR-009 in its [dependency-audit contract](../features/F-020-dependency-audit.md); all were accepted on actual main `b6acf86` on 2026-11-11 (evidence (archive issue 104)) and are active.
#105 allocates F-021 / BR-322–BR-327 v1, versions BR-154, BR-156, BR-162, BR-167, BR-168, BR-180, BR-181 and BR-184 to v2 and BR-187 to v3 in its [container health-check contract](../features/F-021-container-health-check.md), with no ADR; all were accepted on actual main `e208996` on 2026-11-11 (evidence (archive issue 105)) and are active. The next unused feature ID was then F-022 and the next unused business-rule ID BR-328.
#114 allocates F-022 / BR-328–BR-340 (BR-335 at v2) and versions BR-146 to v2 in its [Quality Gate summary contract](../features/F-022-sonar-gate-summary.md), with no ADR; all were accepted on actual main `e7d6367` on 2026-11-12 (evidence (archive issue 114)) and are active. The next unused feature ID was then F-023 and the next unused business-rule ID BR-341.
#1 allocates F-023 / BR-341–BR-352 v1 and versions BR-015 to v7, BR-149, BR-183, BR-225 and BR-227 to v3, and BR-229 and BR-320 to v2 in its [hosted CI and privacy-scan contract](../features/F-023-hosted-ci-privacy-scan.md), with no ADR; all were accepted on actual main `ad25fa2` on 2026-11-12 ([evidence](https://github.com/sstolz/kdrive-mcp-server/issues/1#issuecomment-6831523066)) and are active. The next unused feature ID was then F-024 and the next unused business-rule ID BR-353.
#2 allocates F-024 / BR-353–BR-379 and versions BR-016 and BR-178 to v3 in its [gated publication contract](../features/F-024-gated-publication.md), with no ADR; F-024 v2 withdraws BR-376 and BR-377 (never accepted, no record, never reused) and the BR-321 v2 of F-024 v1 (BR-321 stays at v1). BR-353–BR-375, BR-378 and BR-379 v1 and BR-016 v3 and BR-178 v3 are pending acceptance on actual main. The next unused feature ID is F-025; the next unused business-rule ID is BR-380 (BR-291 and BR-305–BR-311 stay reserved for #109; BR-376 and BR-377 are withdrawn).
#14 was frozen after independent review and autonomous freeze; these
allocations were accepted on actual main `7b046a0`. ADR-001–003 were verified on both actual
main and the concurrent #11 branch before allocating ADR-004.
#11 F-008 / BR-094–108 is accepted with its [qualification contract](../features/F-008-oidc-qualification.md): AC-01–AC-19 on main `2cec566ab8e2f030dbbbf47f04bf541e5eb48dc4`, owner-run AC-20 on main `7b046a0446930ab6a935510314c6c1b975d13550`.

Allocation and freeze establish no working production capability.

### Business-rule ledger

| ID                                       | Source feature | Rule record timing                  | Status                             |
| ---------------------------------------- | -------------- | ----------------------------------- | ---------------------------------- |
| [BR-001 v1](../business-rules/BR-001.md) | F-001          | Accepted foundation record          | Superseded by BR-016               |
| [BR-002 v1](../business-rules/BR-002.md) | F-001          | Accepted foundation record          | Active                             |
| [BR-003 v1](../business-rules/BR-003.md) | F-001          | Accepted foundation record          | Active                             |
| [BR-004 v1](../business-rules/BR-004.md) | F-001          | Accepted foundation record          | Active                             |
| [BR-005 v1](../business-rules/BR-005.md) | F-001 v1       | Historical record; frozen v1 source | Superseded by BR-007; never active |
| [BR-006 v1](../business-rules/BR-006.md) | F-001 v1       | Historical record; frozen v1 source | Superseded by BR-008; never active |
| [BR-007 v1](../business-rules/BR-007.md) | F-001 v2       | Historical record; frozen v2 source | Superseded by BR-010; never active |
| [BR-008 v1](../business-rules/BR-008.md) | F-001 v2       | Historical record; frozen v2 source | Superseded by BR-011; never active |
| [BR-009 v1](../business-rules/BR-009.md) | F-001 v2       | Accepted foundation record          | Active                             |
| [BR-010 v1](../business-rules/BR-010.md) | F-001 v3       | Accepted foundation record          | Active; supersedes BR-007          |
| [BR-011 v1](../business-rules/BR-011.md) | F-001 v3       | Preserved superseded record         | Superseded by BR-015               |
| [BR-012 v1](../business-rules/BR-012.md) | F-001 v3       | Accepted foundation record          | Active                             |
| [BR-013 v1](../business-rules/BR-013.md) | F-001 v3       | Preserved superseded record         | Superseded by BR-014               |
| [BR-014 v1](../business-rules/BR-014.md) | F-001 v4 / #28 | Accepted foundation record          | Active; supersedes BR-013          |
| [BR-015 v1](../business-rules/BR-015.md) | F-001 v4 / #28 | Accepted foundation record          | Active; supersedes BR-011          |
| [BR-016 v1](../business-rules/BR-016.md) | F-002 v1 / #4  | Prepared in feature PR              | Active; supersedes BR-001          |
| [BR-017 v1](../business-rules/BR-017.md) | F-002 v1 / #4  | Prepared in feature PR              | Active                             |
| [BR-018 v1](../business-rules/BR-018.md) | F-002 v1 / #4  | Prepared in feature PR              | Active                             |
| [BR-019 v1](../business-rules/BR-019.md) | F-002 v1 / #4  | Prepared in feature PR              | Active                             |
| [BR-020 v1](../business-rules/BR-020.md) | F-002 v1 / #4  | Prepared in feature PR              | Active                             |
| [BR-021 v1](../business-rules/BR-021.md) | F-002 v1 / #4  | Prepared in feature PR              | Active                             |
| [BR-022 v1](../business-rules/BR-022.md) | F-002 v1 / #4  | Prepared in feature PR              | Active                             |
| [BR-023 v1](../business-rules/BR-023.md) | F-002 v1 / #4  | Prepared in feature PR              | Active                             |
| [BR-024 v2](../business-rules/BR-024.md) | F-002 v3 / #21 | Accepted on main `3fc14c3` (#21)    | Active (v2)                        |
| [BR-025 v2](../business-rules/BR-025.md) | F-002 v4 / #12 | Accepted on main 00e6fe3 (#12)      | v2 Active                          |
| [BR-026 v1](../business-rules/BR-026.md) | F-002 v1 / #4  | Prepared in feature PR              | Active                             |
| [BR-027 v1](../business-rules/BR-027.md) | F-002 v1 / #4  | Prepared in feature PR              | Active                             |
| [BR-028 v1](../business-rules/BR-028.md) | F-002 v1 / #4  | Prepared in feature PR              | Active                             |

Foundation markers follow the actual-main
acceptance report (archived evidence `runs/28-acceptance-1.md`). F-002 markers now follow its
successful actual-main acceptance report (archived evidence `runs/33-acceptance-1.md`), not the
freeze or merge alone. #35 synchronizes these accepted states.

### Architecture-decision ledger

F-003 allocates [BR-029–BR-046](../business-rules/README.md#pending--configured-tree-access-policy),
all v1, accepted on 2026-11-09 (BR-042 at v2). No existing rule is superseded. The next unused
feature and rule IDs were F-005 and BR-059 after #7 allocated F-004 and
BR-047–BR-058; #8 now allocates F-005 and BR-059–BR-071 as recorded above.
#7 freezes BR-042 v2 with F-003 v2 and F-004 v1 after fresh
independent round 2 approval (archived evidence `runs/7-spec-review-2.md`) of
`e913aa40af932889daa88be780095ff9095706c2`, at2026-11-02 19:32:08 UTC.
No full acceptance marker is established.

| ID      | Ticket | ADR path                                                                                               | Status                                                                                                       |
| ------- | ------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| ADR-001 | #3     | [Docker TypeScript foundation](../architecture-decisions/ADR-001-typescript-development-foundation.md) | Accepted design; foundation implementation accepted on `f2d38b32dbbd78059da6754bb11d9b8e561fd645`            |
| ADR-002 | #28    | [Official scanner validation](../architecture-decisions/ADR-002-official-scanner-validation.md)        | Accepted design; supersedes only ADR-001 remote Sonar prerequisites; implementation accepted on the same SHA |

[ADR-003](../architecture-decisions/ADR-003-bounded-raw-content.md) records the
F-007 raw continuation/version/resource design; its injected implementation is accepted
on main4f84e4bb5343274d779ff43061effb60aa3cb64b. The ADR text remains historical.
[ADR-004](../architecture-decisions/ADR-004-bounded-extraction-dependencies.md) is
accepted design for #14 / F-009, whose implementation was accepted on actual main `7b046a0`.
#50 allocates ADR-005 (dedicated PR project, F-011). #70 writes
[ADR-006](../architecture-decisions/ADR-006-builtin-https-kdrive-transport.md)
(built-in `node:https` transport, F-014 D-01), accepted with F-014 on main `2a9c1e3`.
#72 allocates [ADR-007](../architecture-decisions/ADR-007-isolated-self-hosted-runner.md)
(isolated self-hosted runner, F-015), accepted with F-015 on main `de9b283`.
ADR-008 stays allocated to F-019 (#103) and is not written yet (`BACKLOG.md`).
#104 allocates [ADR-009](../architecture-decisions/ADR-009-dependency-overrides-skiplibcheck.md)
(dependency overrides and `skipLibCheck`, F-020), accepted with F-020 on main `b6acf86`.
The next unused architecture-decision identifier is ADR-010. ADR-001 stays
byte-for-byte unchanged; its unaffected foundation choices remain applicable.

## Templates

- [Feature](templates/feature.md): context, scope, BRs, linked ACs, decisions,
  empty open questions at freeze, and independent stress-test dispositions.
- [Business rule](templates/business-rule.md): statement, rationale, source,
  YAML ID/version/status/source/supersedes metadata, unchanged Rule/Rationale,
  concrete GWT Examples on each boundary side mapped to tests, Verification and
  History; pending status then active/superseded after acceptance.
- [Architecture decision](templates/architecture-decision.md): costly-to-reverse
  choice, rejected options, consequences and immutable accepted history.
- [Review](templates/review.md): independent verdict, severity, actionable
  locations, AC/BR/test traceability and report evidence.

Template tokens such as `F-NNN` and `BR-NNN` are unallocated placeholders.
No template or planning entry grants implementation permission.

## Readiness and remaining product decisions

The current initial unreleased VERSION remains 0.1.0; this index creates no
release. Product decisions D-03–D-07 and probes E-01–E-03 remain with their
affected backlog tickets (archive `docs/github-backlog.md`). F-002 validates local configuration
and an injected preflight boundary only; it does not qualify a real provider,
resolve a real account or implement an MCP/HTTP server. Successful actual-main
#4/#31/#33 acceptance establishes only that bounded local/synthetic scope.
