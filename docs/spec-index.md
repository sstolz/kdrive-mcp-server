# Specification index

F-001 v4 is done and its applicable rules are accepted on actual `main`
`f2d38b32dbbd78059da6754bb11d9b8e561fd645`, 2026-11-01; see the
acceptance evidence (private archive). Frozen v1/v2/v3 history and
accepted ADR text remain immutable. F-002 v1 is preserved frozen; v2 is done after
acceptance on actual main `88bf8caa7412988e11099a4a01f9e600aa38eeee`,
2026-11-01; see the final evidence (private archive) recorded in
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

| ID    | Ticket    | Spec path                                               | Status                                                                                                                                                                                                                                                                                                                                                   |
| ----- | --------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-001 | #3, #28   | `features/F-001-typescript-foundation.md`               | Done v4; accepted 2026-11-01 on `f2d38b32dbbd78059da6754bb11d9b8e561fd645`                                                                                                                                                                                                                                                                               |
| F-002 | #4        | `features/F-002-configuration.md`                       | Done v4 (accepted on main 00e6fe3 with F-012, BR-025 v2); v3 snapshot in history; frozen v1 preserved                                                                                                                                                                                                                                                    |
| F-003 | #6, #7    | `features/F-003-tree-access-policy.md`                  | Done v2, accepted 2026-11-09; BR-029–046 active; production AC-19/AC-20 via F-014 AC-23/AC-24 on main 2a9c1e3                                                                                                                                                                                                                                            |
| F-004 | #7        | `features/F-004-received-share-policy.md`               | Done v1, accepted 2026-11-09; BR-047–BR-058 active; production AC-14/AC-15 via F-014 AC-25 on main 2a9c1e3                                                                                                                                                                                                                                               |
| F-005 | #8        | `features/F-005-stdio-navigation.md`                    | Done v2 (accepted on main 00e6fe3 with F-012, BR-059 v2); v1 snapshot in history; injected stdio only                                                                                                                                                                                                                                                    |
| F-006 | #9        | `features/F-006-filtered-pagination.md`                 | Done v1; accepted on main30e059ef8ef3540c4aa4bb6a0de0bf209c963b12; injected continuation only                                                                                                                                                                                                                                                            |
| F-007 | #10       | `features/F-007-bounded-downloads.md`                   | Done v1; accepted injected scope on main4f84e4bb5343274d779ff43061effb60aa3cb64b                                                                                                                                                                                                                                                                         |
| F-008 | #11       | `features/F-008-oidc-qualification.md`                  | Done v1; accepted on main2cec566ab8e2f030dbbbf47f04bf541e5eb48dc4; AC-20 owner-run on main 7b046a0; both providers proxy-only                                                                                                                                                                                                                            |
| F-009 | #14       | `features/F-009-bounded-content-reading.md`             | Done v1, accepted on main 7b046a0; BR-109–123 / BR-060 v4 active; injected bounded extraction only                                                                                                                                                                                                                                                       |
| F-010 | #21       | `features/F-010-oauth-proxy.md`                         | Done v1; accepted on main 3fc14c3bbbd57b3c52ca4b74c07a512720f0d627; BR-124–143, BR-100 v2, BR-024 v2 active; no client connection                                                                                                                                                                                                                        |
| F-011 | #50       | `features/F-011-pre-merge-quality-gates.md`             | Done v3, accepted on main bc09d56 (v1, v2 in history); BR-144–151, BR-010/012/014 v2, BR-015 v3 active; ADR-005; PR Quality Gate                                                                                                                                                                                                                         |
| F-012 | #12       | `features/F-012-authenticated-http.md`                  | Done v2 (#63, accepted on main 7b8b52d): BR-171 v2, BR-189 active; v1 accepted on main 00e6fe3 (AC-21 2026-11-04), BR-152–171 v1 active                                                                                                                                                                                                                  |
| F-013 | #13       | `features/F-013-http-image.md`                          | Done v3, accepted on main 18c2325; BR-172–188 (BR-187 v2) and BR-015 v4 active; image recipe, examples and personal-server guide                                                                                                                                                                                                                         |
| F-014 | #70       | `features/F-014-production-kdrive-adapter.md`           | Done v7, accepted on main 2a9c1e3 (v1–v6 in history); BR-190–217 and BR-016/028/071/123/175 v2 active; ADR-006 accepted; production read-only adapter                                                                                                                                                                                                    |
| F-015 | #72       | `features/F-015-self-hosted-runner.md`                  | Done v2, accepted on main de9b283; BR-218–233, BR-015 v5, BR-149/178/183 v2 active; ADR-007 accepted                                                                                                                                                                                                                                                     |
| F-019 | #103      | `features/F-019-persistent-oauth-state.md`              | Done v1, accepted on main 68209fe (2026-11-11); BR-290, BR-292–304, BR-312–314 and BR-023/124/128/139/140/142/143/152/169 v2, BR-024 v3 active; AC-14–18 moved to #109; BR-291 and BR-305–311 reserved for #109                                                                                                                                          |
| F-020 | #104      | `features/F-020-dependency-audit.md`                    | Done v1, accepted on main b6acf86 (2026-11-11); BR-315–321 and BR-015 v6, BR-122/225/227 v2 active; ADR-009 accepted                                                                                                                                                                                                                                     |
| F-021 | #105      | `features/F-021-container-health-check.md`              | Done v1, accepted on main e208996 (2026-11-11); BR-322–327 and BR-154/156/162/167/168/180/181/184 v2, BR-187 v3 active                                                                                                                                                                                                                                   |
| F-022 | #114      | `features/F-022-sonar-gate-summary.md`                  | Done v2, accepted on main e7d6367 (2026-11-12); BR-328–340 (BR-335 v2) and BR-146 v2 active                                                                                                                                                                                                                                                              |
| F-023 | #1        | `features/F-023-hosted-ci-privacy-scan.md`              | Done v1, accepted on main ad25fa2 (2026-11-12); BR-341–352 and BR-015 v7, BR-149/183/225/227 v3, BR-229/320 v2 active                                                                                                                                                                                                                                    |
| F-024 | #91       | `features/F-024-gated-publication.md`                   | Done v4, accepted on main `d30b3ff` (2026-11-18; [#91 acceptance](https://github.com/sstolz/kdrive-mcp-server/issues/91#issuecomment-6992434783)); BR-354/363/372/373 v3 and BR-431–BR-433 v1 active; v3 done for #89, preserved verbatim in `features/history/F-024-v3.md`                                                                              |
| F-025 | #2        | `features/F-025-changelog-release-sections.md`          | Done v1, accepted on main e857db3 (2026-11-13); BR-321 v3 active (v2 withdrawn in F-024 v2, never reused)                                                                                                                                                                                                                                                |
| F-026 | #16       | `features/F-026-bounded-invocation-queue.md`            | Done v1, accepted on main 2d10e19 (2026-11-13); BR-380–388 v1 and BR-258 v2, BR-070 v3, BR-118 v2 active                                                                                                                                                                                                                                                 |
| F-027 | #12       | `features/F-027-direct-image-codecs.md`                 | Done v2, accepted on main 75bd9bb (2026-11-14; v1 2026-11-13); BR-389–392 v1 and BR-122 v3, BR-315 v2, BR-318 v2, BR-320 v3, BR-321 v4 active; BR-317 superseded by BR-390; ADR-010 accepted                                                                                                                                                             |
| F-028 | #3        | `features/F-028-client-id-metadata-documents.md`        | Done v2, accepted on main aa540d4 (2026-11-14; v1 frozen the same day); owner run unblocked (F-029 accepted), following the F-029 owner-run procedure; BR-291, BR-305–311, BR-393–395 v1 and BR-023 v3, BR-024 v4, BR-125 v2, BR-128 v3, BR-129 v2, BR-136 v2, BR-143 v3, BR-169 v3, BR-295 v2, BR-298 v2, BR-299 v2, BR-302 v2 active; ADR-011 accepted |
| F-029 | #25       | `features/F-029-acceptance-launcher-oauth-state.md`     | Done v2, accepted on main 3428df5 (2026-11-14); BR-396–398 v1 and BR-171 v3 active; no ADR                                                                                                                                                                                                                                                               |
| F-030 | #23       | `features/F-030-oauth-proxy-page-design.md`             | Done v1, accepted on main f747072 (2026-11-14); BR-399–403 v1, BR-129 v3, BR-393 v2 active; no ADR                                                                                                                                                                                                                                                       |
| F-031 | #31       | `features/F-031-oauth-proxy-page-languages.md`          | Done v1, accepted on main 901f7af (2026-11-14); BR-404–410 v1, BR-129 v4, BR-143 v4, BR-393 v3, BR-399 v2, BR-402 v2, BR-403 v2 active; no ADR                                                                                                                                                                                                           |
| F-032 | #33       | `features/F-032-repeated-consent-post.md`               | Done v1, accepted on main 89be2ba (2026-11-14); BR-411 v1, BR-129 v5, BR-142 v3 active; no ADR                                                                                                                                                                                                                                                           |
| F-033 | #26       | `features/F-033-cimd-hardening.md`                      | Done v1, accepted on main 6ef8b55 (2026-11-14); BR-129 v6, BR-306 v2, BR-307 v2, BR-309 v2, BR-394 v2 active; no ADR                                                                                                                                                                                                                                     |
| F-034 | #4        | `features/F-034-pdf-extraction-profile.md`              | Done v2, accepted on main 570c4b2 (2026-11-15; v1 frozen 2026-11-14; v2 amends BR-415, BR-417 and BR-419 in place and versions BR-173, BR-226 and BR-392 to v2 after the code reviews); BR-412–420 v1, BR-114, BR-173, BR-226 and BR-392 v2 active; ADR-012 accepted                                                                                     |
| F-035 | #46       | `features/F-035-oauth-proxy-hardening.md`               | Done v1, accepted on main 703bece (2026-11-15); BR-421–422 v1, BR-023 v4, BR-024 v5, BR-131 v2, BR-133 v2, BR-137 v2, BR-162 v3, BR-167 v3, BR-184 v3, BR-186 v2 active; no ADR                                                                                                                                                                          |
| F-036 | #49       | `features/F-036-refused-code-event.md`                  | Done v1, accepted on main 14f5266 (2026-11-15); BR-137 v3 active; no new BR ID or ADR                                                                                                                                                                                                                                                                    |
| F-037 | #47 lot A | `features/F-037-mutation-rate-limit-stop.md`            | Done v1, accepted on main 8b92e07 (2026-11-15); BR-248, BR-249, BR-250 and BR-268 v2 active; no new BR ID or ADR                                                                                                                                                                                                                                         |
| F-038 | #47 lot B | `features/F-038-stream-budget-and-weak-etags.md`        | Done v1, accepted on main 2ae303c (2026-11-15); BR-070 v4, BR-205 v2 and BR-384 v2 active; D-1 preserves existing operation charging points; no new BR ID or ADR                                                                                                                                                                                         |
| F-039 | #47 lot C | `features/F-039-bounded-audit-sink.md`                  | Done v1, accepted on main 8bc1780 (2026-11-15); BR-070 v5 and BR-240, BR-241, BR-254 and BR-259 v2 active; no new BR ID or ADR                                                                                                                                                                                                                           |
| F-040 | #47 lot D | `features/F-040-process-wide-extraction-admission.md`   | Done v1, accepted on main 67c101a (2026-11-15); BR-423–BR-426 v1 and BR-118 v3 active; no ADR                                                                                                                                                                                                                                                            |
| F-041 | #47 lot E | `features/F-041-configured-root-ancestors.md`           | Done v1, accepted on main 448a48f (2026-11-15); BR-277 and BR-278 v2 and BR-427 v1 active; no ADR                                                                                                                                                                                                                                                        |
| F-042 | #42       | `features/F-042-mcp-tool-descriptions.md`               | Done v1, accepted on main 3b035b8 (2026-11-15); BR-428–BR-430 v1 active; no ADR                                                                                                                                                                                                                                                                          |
| F-043 | #67       | `features/F-043-queue-changelog-release-sections.md`    | Done v1, accepted on main f72a15b (2026-11-15); BR-387 v2 active; no new BR or ADR                                                                                                                                                                                                                                                                       |
| F-051 | #77       | `features/F-051-transport-edge-cases.md`                | Done v1, accepted on main b249860 (2026-11-24); BR-438/439 v1 and BR-216/268 v3 active; separate read-deadline decision remains open on #77                                                                                                                                                                                                              |
| F-052 | #72       | `features/F-052-oauth-qualification-proxy-hardening.md` | Done v1, accepted on main 019f0f5 (2026-11-25); BR-440–BR-442 v1, BR-096/103/127 v2, BR-143 v5 and BR-306/394 v3 active                                                                                                                                                                                                                                  |
| F-053 | #73       | `features/F-053-http-lifecycle-hardening.md`            | Done v2 (v1 in history), accepted on main 4492616 (2026-11-25); BR-443–BR-446 v1, BR-164/166 v2 and BR-167/169 v4 active                                                                                                                                                                                                                                 |
| F-054 | #139      | `features/F-054-process-stdio-lifecycle.md`             | Done v2, accepted on main 23174da (2026-11-26); BR-447/448 v1, BR-069/254 v3 and BR-210/262 v2 active                                                                                                                                                                                                                                                    |

Version history: [v1 immutable snapshot](../features/history/F-001-v1.md),
[v2 immutable snapshot](../features/history/F-001-v2.md),
[v3 immutable snapshot](../features/history/F-001-v3.md),
[history index](../features/history/README.md). Versioning does not allocate a new F ID.

F-002 v1 freeze evidence: review round 1 (private archive),
fresh round 2 approval (private archive) and the exact freeze record
in the [immutable v1 snapshot](../features/history/F-002-v1.md).
The [current v2](../features/F-002-configuration.md) was frozen at 21:29:17 UTC
after fresh v2 approval (private archive) of reviewed SHA-256
`7005d6d3322a10a76dff08cc6fb05dfe3641f8ab07586ca65ccf61563c100d4f`;
see the narrow revision note (private archive). BR-016–BR-028 retain
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
#70 allocates F-014 / BR-190–BR-217 v1, versions BR-016, BR-028, BR-071, BR-123 and BR-175 to v2, and proposes ADR-006 in its [production-adapter contract](../features/F-014-production-kdrive-adapter.md); later versions up to F-014 v7 version further rules (snapshots in `features/history/`); accepted on main `2a9c1e3` (evidence (private archive)). #72 allocates F-015 / BR-218–BR-233 v1, versions BR-015 to v5 and BR-149, BR-178 and BR-183 to v2, and proposes ADR-007 in its [self-hosted-runner contract](../features/F-015-self-hosted-runner.md); F-015 v2 accepted on main `de9b283` (evidence (private archive)). The next unused feature ID was then F-016 and the next unused business-rule ID BR-234.
#103 allocates F-019 / BR-290 and BR-292–BR-314 v1 (BR-291 and BR-305–BR-311 are reserved for #109 and never reused) and versions BR-023, BR-124, BR-128, BR-139, BR-140, BR-142, BR-143, BR-152 and BR-169 to v2 and BR-024 to v3 in its [persistent-state contract](../features/F-019-persistent-oauth-state.md); all were accepted on actual main `68209fe` on 2026-11-11 (evidence (archive issue 103)) and are active; the owner-run real-client restart check has not been run.
#104 allocates F-020 / BR-315–BR-321 v1, versions BR-015 to v6 and BR-122, BR-225 and BR-227 to v2, and writes ADR-009 in its [dependency-audit contract](../features/F-020-dependency-audit.md); all were accepted on actual main `b6acf86` on 2026-11-11 (evidence (archive issue 104)) and are active.
#105 allocates F-021 / BR-322–BR-327 v1, versions BR-154, BR-156, BR-162, BR-167, BR-168, BR-180, BR-181 and BR-184 to v2 and BR-187 to v3 in its [container health-check contract](../features/F-021-container-health-check.md), with no ADR; all were accepted on actual main `e208996` on 2026-11-11 (evidence (archive issue 105)) and are active. The next unused feature ID was then F-022 and the next unused business-rule ID BR-328.
#114 allocates F-022 / BR-328–BR-340 (BR-335 at v2) and versions BR-146 to v2 in its [Quality Gate summary contract](../features/F-022-sonar-gate-summary.md), with no ADR; all were accepted on actual main `e7d6367` on 2026-11-12 (evidence (archive issue 114)) and are active. The next unused feature ID was then F-023 and the next unused business-rule ID BR-341.
#1 allocates F-023 / BR-341–BR-352 v1 and versions BR-015 to v7, BR-149, BR-183, BR-225 and BR-227 to v3, and BR-229 and BR-320 to v2 in its [hosted CI and privacy-scan contract](../features/F-023-hosted-ci-privacy-scan.md), with no ADR; all were accepted on actual main `ad25fa2` on 2026-11-12 ([evidence](https://github.com/sstolz/kdrive-mcp-server/issues/1#issuecomment-6831523066)) and are active. The next unused feature ID was then F-024 and the next unused business-rule ID BR-353.
#2 allocates F-024 / BR-353–BR-379 and versions BR-016 and BR-178 to v3 in its [gated publication contract](../features/F-024-gated-publication.md), with no ADR; F-024 v2 withdraws BR-376 and BR-377 (never accepted, no record, never reused) and the BR-321 v2 of F-024 v1 (never accepted, number never reused; F-025 v1 versions BR-321 to v3, accepted on actual main `e857db3`). BR-353–BR-375, BR-378 and BR-379 v1 and BR-016 v3 and BR-178 v3 were accepted on actual main `163e701` on 2026-11-13 ([evidence](https://github.com/sstolz/kdrive-mcp-server/issues/2#issuecomment-6851666057)) and are active. The next unused feature ID was then F-025 and the next unused business-rule ID BR-380.
#2 allocates F-025 and versions BR-321 to v3 (BR-321 v2 is skipped: it names the withdrawn rule of F-024 v1) in its [changelog release-sections contract](../features/F-025-changelog-release-sections.md), with no new BR ID and no ADR; F-025 v1 and BR-321 v3 were accepted on actual main `e857db3` on 2026-11-13 ([evidence](https://github.com/sstolz/kdrive-mcp-server/issues/2#issuecomment-6852513497)). The next unused feature ID was then F-026 and the next unused business-rule ID BR-380.
#16 allocates F-026 / BR-380–BR-388 v1 and versions BR-258 to v2, BR-070 to v3 and BR-118 to v2 in its [bounded invocation queue contract](../features/F-026-bounded-invocation-queue.md), with no ADR; F-026 v1, BR-380–BR-388 v1 and BR-070 v3, BR-118 v2 and BR-258 v2 were accepted on actual main `2d10e19` on 2026-11-13 and are active ([evidence](https://github.com/sstolz/kdrive-mcp-server/issues/16#issuecomment-6863879656)). The next unused feature ID was then F-027 and the next unused business-rule ID BR-389.
#12 allocates F-027 / BR-389–BR-392 v1, versions BR-122 to v3, BR-315 to v2, BR-318 to v2, BR-320 to v3 and BR-321 to v4, supersedes BR-317 by BR-390 and writes ADR-010 in its [direct image codecs contract](../features/F-027-direct-image-codecs.md); all were accepted on actual main `75bd9bb` on 2026-11-14 (#12 comment `12-acceptance-1-orchestrator`) and are active. The next unused feature ID was then F-028 and the next unused business-rule ID BR-393.
#3 allocates F-028 / BR-291, BR-305–BR-311 (reserved for this work as archive #109) and BR-393–BR-395 v1, versions BR-023 to v3, BR-024 to v4, BR-125 to v2, BR-128 to v3, BR-129 to v2, BR-136 to v2, BR-143 to v3, BR-169 to v3, BR-295 to v2, BR-298 to v2, BR-299 to v2 and BR-302 to v2, and writes ADR-011 in its [Client ID Metadata Documents contract](../features/F-028-client-id-metadata-documents.md); all were accepted on actual main `aa540d4` on 2026-11-14 (#3 comment `3-acceptance-1-orchestrator`) and are active; the owner-run claude.ai check is not done; it is unblocked (F-029, #25, accepted on main `3428df5`) and follows the owner-run procedure of the [F-029 contract](../features/F-029-acceptance-launcher-oauth-state.md), which replaces the F-028 "with the state file set" wording.
#25 allocates F-029 / BR-396–BR-398 v1 and versions BR-171 to v3 in its [acceptance launcher OAuth state contract](../features/F-029-acceptance-launcher-oauth-state.md), with no ADR; all were accepted on actual main `3428df5` on 2026-11-14 (#25 comment `25-acceptance-1-orchestrator`) and are active.
#23 allocates F-030 / BR-399–BR-403 v1 and versions BR-129 to v3 and BR-393 to v2 in its [OAuth proxy page design contract](../features/F-030-oauth-proxy-page-design.md), with no ADR; all were accepted on actual main `f747072` on 2026-11-14 (#23 comment `23-acceptance-1-orchestrator`) and are active.
#31 allocates F-031 / BR-404–BR-410 v1 and versions BR-129 to v4, BR-143 to v4, BR-393 to v3, BR-399 to v2, BR-402 to v2 and BR-403 to v2 in its [OAuth proxy page languages contract](../features/F-031-oauth-proxy-page-languages.md), with no ADR; all were accepted on actual main `901f7af` on 2026-11-14 (#31 comment `31-acceptance-1-orchestrator`) and are active. #33 allocates F-032 / BR-411 v1 and versions BR-129 to v5 and BR-142 to v3 in its [repeated consent POST contract](../features/F-032-repeated-consent-post.md), with no ADR; all were accepted on actual main `89be2ba` on 2026-11-14 (#33 comment `33-acceptance-1-orchestrator`) and are active. #26 versions BR-129 to v6 and BR-306, BR-307, BR-309 and BR-394 to v2 in F-033's [CIMD hardening contract](../features/F-033-cimd-hardening.md), with no new BR ID and no ADR; all were accepted on actual main `6ef8b55` on 2026-11-14 (#26 comment `26-acceptance-1-orchestrator`) and are active. #4 allocates F-034 / BR-412–BR-420 v1, versions BR-114, BR-173, BR-226 and BR-392 to v2 and writes ADR-012 in its [PDF extraction profile contract](../features/F-034-pdf-extraction-profile.md); all were accepted on actual main `570c4b2` on 2026-11-15 (#4 comment `4-acceptance-1-orchestrator`) and are active. #46 allocates F-035 / BR-421–BR-422 v1 and versions BR-023 to v4, BR-024 to v5, BR-131, BR-133, BR-137 and BR-186 to v2 and BR-162, BR-167 and BR-184 to v3 in its [OAuth proxy hardening contract](../features/F-035-oauth-proxy-hardening.md), with no ADR; all were accepted on actual main `703bece` on 2026-11-15 (#46 comment `6891311411`) and are active. #49 allocates F-036 and versions BR-137 to v3 in its [refused code event contract](../features/F-036-refused-code-event.md), with no new BR ID or ADR; accepted on actual main `14f5266` on 2026-11-15 (#49 comment `6893052881`) and active. #47 lot A allocates F-037 and versions BR-248, BR-249, BR-250 and BR-268 v2 in its [mutation rate-limit stop contract](../features/F-037-mutation-rate-limit-stop.md), with no new BR ID or ADR; all four v2 definitions were accepted on actual main `8b92e07` on 2026-11-15 (#47 comment `6894142807`) and are active. #47 lot B allocates F-038 and versions BR-070 to v4 and BR-205 and BR-384 to v2 in its [stream-budget and weak-validator contract](../features/F-038-stream-budget-and-weak-etags.md); all three versions were accepted on actual main `2ae303c` on 2026-11-15 (#47 comment `6895105510`) and are active. No new BR ID or ADR is allocated; D-1 preserves existing operation charging points, with physical HTTP request counting out of scope. The next unused feature ID is F-042; the next unused business-rule ID is BR-428 (BR-376 and BR-377 are withdrawn).

#47 lot C allocates F-039 and versions BR-070 to v5 and BR-240, BR-241, BR-254 and BR-259 to v2 in its [bounded audit-sink contract](../features/F-039-bounded-audit-sink.md). All five versions were accepted on actual main `8bc1780` on 2026-11-15 (#47 comment `6897083907`) and are active. No new BR ID or ADR is allocated. Next free IDs: F-042, BR-428, ADR-013.

#47 lot D allocates F-040 / BR-423–BR-426 v1 and versions BR-118 to v3 in its [process-wide extraction admission contract](../features/F-040-process-wide-extraction-admission.md). All five versions were accepted on actual main `67c101a` on 2026-11-15 (#47 comment `6897680463`) and are active. Its failed/overdue-termination exception is recorded in BR-118 v3. No ADR is allocated. Next free IDs: F-041, BR-427, ADR-013 (BR-376 and BR-377 are withdrawn).

#47 lot E allocates F-041 / BR-427 v1 and versions BR-277 and BR-278 to v2 in its [ancestor-protection contract](../features/F-041-configured-root-ancestors.md). All three versions were accepted on actual main `448a48f` on 2026-11-15 (#47 comment `6898895634`) and are active. R-17-2's known-ancestor bypass is addressed; the external-mutation check-then-act window remains. No ADR is allocated. Next free IDs after lot E were F-042, BR-428, ADR-013 (BR-376 and BR-377 are withdrawn).

#42 allocates F-042 / BR-428–BR-430 v1 in its [MCP description catalog](../features/F-042-mcp-tool-descriptions.md). All three versions were accepted on actual main `3b035b8` on 2026-11-15 (#42 comment `6900828692`) and are active. BR-068 v1, BR-263 v2, BR-283 v2 and BR-424 v1 remain active and unchanged. No ADR is allocated.

#67 allocates F-043 in the [queue changelog release-sections contract](../features/F-043-queue-changelog-release-sections.md)
and versions BR-387 to v2, active after acceptance on actual main `f72a15b`
on 2026-11-15 (#67 comment `6902168340`). No new BR or ADR. Next free IDs: **F-044, BR-431, ADR-013**
(BR-376 and BR-377 remain withdrawn).

Issue #110 allocates [F-048 v1](../features/F-048-deny-pattern-root-warning.md)
and BR-434–BR-435 v1 for conservative deny/root diagnostics, including
the enabled received-share namespace, and versions BR-021 and BR-207 to v3
and BR-027 to v2. F-048 v1 is done, accepted on main `f4487a2` on 2026-11-21
([#110 acceptance](https://github.com/sstolz/kdrive-mcp-server/issues/110#issuecomment-7062590216)); all five rule versions are active.
BR-023 v4 remains unchanged. Next free IDs after F-048 were F-049, BR-436.

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
acceptance report (private archive). F-002 markers now follow its
successful actual-main acceptance report (private archive), not the
freeze or merge alone. #35 synchronizes these accepted states.

### Architecture-decision ledger

F-003 allocates [BR-029–BR-046](../business-rules/README.md#accepted--configured-tree-access-policy),
all v1, accepted on 2026-11-09 (BR-042 at v2). No existing rule is superseded. The next unused
feature and rule IDs were F-005 and BR-059 after #7 allocated F-004 and
BR-047–BR-058; #8 now allocates F-005 and BR-059–BR-071 as recorded above.
#7 freezes BR-042 v2 with F-003 v2 and F-004 v1 after fresh
independent round 2 approval (private archive) of
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
ADR-008 stays allocated to F-019 (#103) and is not written yet (live issue #81).
#104 allocates [ADR-009](../architecture-decisions/ADR-009-dependency-overrides-skiplibcheck.md)
(dependency overrides and `skipLibCheck`, F-020), accepted with F-020 on main `b6acf86`.
#12 allocates [ADR-010](../architecture-decisions/ADR-010-direct-image-codecs.md)
(direct image codecs, F-027), which supersedes ADR-009 and the image-codec
choice (Jimp modules) of ADR-004, accepted with F-027 on main `75bd9bb`;
ADR-004 and ADR-009 keep their text.
#3 allocates [ADR-011](../architecture-decisions/ADR-011-oauth-state-format-v2-cimd.md)
(OAuth state file version 2 for CIMD families, F-028), accepted with F-028 on
main `aa540d4`. #25 (F-029), #23 (F-030), #31 (F-031), #33 (F-032), #26 (F-033), #46 (F-035), #49 (F-036) and #47 lots A/B/C/D (F-037/F-038/F-039/F-040) write no ADR.
#4 allocates [ADR-012](../architecture-decisions/ADR-012-projected-pdf-text-profile.md)
(projected PDF text profile, F-034), which supersedes the PDF admission
profile of ADR-004, accepted with F-034 on main `570c4b2`; ADR-004 keeps its
text.
The next unused architecture-decision identifier is ADR-013. ADR-001 stays
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

The current VERSION is 1.0.1; this index creates no
release. Product decisions D-03–D-07 and probes E-01–E-03 remain with their
affected backlog tickets (archive `docs/github-backlog.md`). F-002 validates local configuration
and an injected preflight boundary only; it does not qualify a real provider,
resolve a real account or implement an MCP/HTTP server. Successful actual-main
#4/#31/#33 acceptance establishes only that bounded local/synthetic scope.

Issue #117 allocates [F-049 v1](../features/F-049-secret-file-bom-refusal.md)
and versions [BR-026](../business-rules/BR-026.md) and
[BR-027](../business-rules/BR-027.md) to v3. F-049 v1 is done, accepted
on main `e3c63b8` on 2026-11-22
([#117 acceptance](https://github.com/sstolz/kdrive-mcp-server/issues/117#issuecomment-7087203460)); both rule versions are active.
No new BR or ADR is allocated. Next free IDs after F-049 were F-050, BR-436, ADR-013.

Issue #75 allocates [F-050 v1](../features/F-050-info-size-and-modification-time.md)
and BR-436–BR-437 v1 for info size and modification-time validation, and
prepares BR-063 v2 and BR-428 v2. F-050 v1 is frozen; all four rule records
are pending acceptance in the implementation PR and no new version is accepted
or active. Accepted BR-063 v1 and BR-428 v1 remain active. Other tool
outputs retain their five-field projections through a separate guarded info
consumer port that reuses existing read evaluation without changing operation,
mode or received capability contracts. Only live adapter inspection paths carry
the optional scalars. Real-account timestamp shape and unit remain unverified;
the owner observation includes an optional received-share item and records its
absence as a residual risk. No ADR is allocated.
Next free IDs after F-050 were **F-051, BR-438, ADR-013**.

Issue #77 allocates [F-051 v1](../features/F-051-transport-edge-cases.md)
and BR-438–BR-439 v1, and versions BR-268 and BR-216 to v3. F-051 v1
is done, accepted on main `b249860` on 2026-11-24
([#77 acceptance](https://github.com/sstolz/kdrive-mcp-server/issues/77#issuecomment-7143986357)); all four rule versions are active.
Mutation socket handoff errors,
close without a response and response statuses below 200 settle under
BR-267 v1 without replay. Observer totals and bounds count request attempts
with unchanged timing, keys and numerical bounds. No ADR is allocated;
the separate read-deadline decision stays open on #77.
Next free IDs after F-051 were **F-052, BR-440, ADR-013**.

Issue #72 allocates [F-052 v1](../features/F-052-oauth-qualification-proxy-hardening.md)
and [BR-440](../business-rules/BR-440.md), [BR-441](../business-rules/BR-441.md)
and [BR-442](../business-rules/BR-442.md) v1 for hidden terminal reads.
It versions [BR-096](../business-rules/BR-096.md),
[BR-103](../business-rules/BR-103.md) and [BR-127](../business-rules/BR-127.md)
to v2, [BR-143](../business-rules/BR-143.md) to v5, and
[BR-306](../business-rules/BR-306.md) and [BR-394](../business-rules/BR-394.md)
to v3. F-052 v1 is done, accepted on main `019f0f5` on 2026-11-25
([#72 acceptance](https://github.com/sstolz/kdrive-mcp-server/issues/72#issuecomment-7147678234)); all nine rule versions are active.
Previous accepted versions are preserved as superseded history. No ADR is allocated.
Next free IDs after F-052 were **F-053, BR-443, ADR-013**.

Issue #73 allocates [F-053 v2](../features/F-053-http-lifecycle-hardening.md)
and [BR-443](../business-rules/BR-443.md), [BR-444](../business-rules/BR-444.md),
[BR-445](../business-rules/BR-445.md) and [BR-446](../business-rules/BR-446.md)
v1. It versions [BR-164](../business-rules/BR-164.md) and
[BR-166](../business-rules/BR-166.md) to v2 and
[BR-167](../business-rules/BR-167.md) and [BR-169](../business-rules/BR-169.md)
to v4. F-053 v2 is done (v1 in `features/history/F-053-v1.md`), accepted on main `4492616` on 2026-11-25
([#73 acceptance](https://github.com/sstolz/kdrive-mcp-server/issues/73#issuecomment-7155904032)); all eight rule versions are active; previous accepted versions are preserved as superseded history.
Its D-4 reverses F-026 D-8 for queued calls that have not started; F-026
(closed) is not edited. No ADR is allocated.
Next free IDs after F-053 were **F-054, BR-447, ADR-013**.

#139 allocates F-054 / [BR-447](../business-rules/BR-447.md) and
[BR-448](../business-rules/BR-448.md) v1 and versions BR-069/254 to v3 and
BR-210/262 to v2 in its [process and stdio lifecycle contract](../features/F-054-process-stdio-lifecycle.md).
F-054 v2 is done, accepted on main `23174da` on 2026-11-26
([#139 acceptance](https://github.com/sstolz/kdrive-mcp-server/issues/139#issuecomment-7185165708)); all six rule versions are active.
V2 records the earlier, stricter cleanup timing implemented on accepted main;
previous accepted rule versions remain superseded history. No ADR is allocated.
Deferred minor findings are tracked in #144.
Next free IDs: **F-055, BR-449, ADR-013**.
