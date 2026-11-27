# Business-rule index

All **446 allocated rules** (BR-218–BR-233 belong to F-015, BR-234–BR-259 to F-016, BR-260–BR-278 to F-017, BR-279–BR-289 to F-018, BR-290 and BR-292–BR-314 to F-019, BR-315–BR-321 to F-020, BR-322–BR-327 to F-021, BR-328–BR-340 to F-022, BR-341–BR-352 to F-023, BR-353–BR-375, BR-378 and BR-379 to F-024, BR-380–BR-388 to F-026, BR-389–BR-392 to F-027, BR-291, BR-305–BR-311 and BR-393–BR-395 to F-028 (#3; reserved for this work by F-019 as archive #109), BR-396–BR-398 to F-029 (#25), BR-399–BR-403 to F-030 (#23), BR-404–BR-410 to F-031 (#31), BR-411 to F-032 (#33), BR-412–BR-420 to F-034 (#4), BR-421 and BR-422 to F-035 (#46), BR-423–BR-426 to F-040 (#47 lot D), BR-427 to F-041 (#47 lot E), BR-428–BR-430 to F-042 (#42); BR-431–BR-433 to F-024 v4 (#91); BR-434–BR-435 to F-048 (#110); BR-436–BR-437 to F-050 (#75, pending acceptance); BR-438–BR-439 to F-051 (#77, accepted); BR-440–BR-442 to F-052 (#72, accepted); BR-443–BR-446 to F-053 (#73, accepted); BR-447–BR-448 to F-054 (#139, accepted); BR-376 and BR-377 were withdrawn in F-024 v2, were never accepted, have no record and are never reused) now have a canonical record with YAML metadata, Rule,
Rationale, concrete Given / When / Then Examples, Verification and History. Every
new record begins its initial BR version1; BR-042 is now version2 under F-003 v2; BR-024 and BR-100
version 2 were accepted with F-010 (#21) on main `3fc14c3`. BR-010, BR-012 and BR-014 v2 and BR-015 v3
were accepted under F-011 v3 (#50) on main `bc09d56`.
BR-001–BR-028 were migrated in #35. Source
feature versions are separate provenance and do not imply earlier BR versions.
The summaries below are navigation aids, not replacement contracts.

Current statuses follow actual-main acceptance on 2026-11-01: the
F-001 acceptance (private archive) on
`f2d38b32dbbd78059da6754bb11d9b8e561fd645` and
F-002 acceptance (private archive) on
`88bf8caa7412988e11099a4a01f9e600aa38eeee`, recorded in completed
#4 (archive issue 4),
#31 (archive issue 31) and
#33 (archive issue 33).
There are **436 active rules, 8 superseded rules, 2 pending new rules and 2 pending successor versions** (F-054 v2 (#139) allocates BR-447–BR-448 v1 and versions BR-069/254 to v3 and BR-210/262 to v2, all active after acceptance on main `23174da` on 2026-11-26 ([#139 acceptance](https://github.com/sstolz/kdrive-mcp-server/issues/139#issuecomment-7185165708)); F-053 v2 (#73) allocates BR-443–BR-446 v1 and versions BR-164 and BR-166 to v2 and BR-167 and BR-169 to v4, all active after acceptance on main `4492616` on 2026-11-25 ([#73 acceptance](https://github.com/sstolz/kdrive-mcp-server/issues/73#issuecomment-7155904032)); F-052 v1 (#72) allocates BR-440–BR-442 v1 and versions BR-096/103/127 to v2, BR-143 to v5 and BR-306/394 to v3, all active after acceptance on main `019f0f5` on 2026-11-25 ([#72 acceptance](https://github.com/sstolz/kdrive-mcp-server/issues/72#issuecomment-7147678234)); F-051 v1 (#77) allocates BR-438 and BR-439 v1 and versions BR-216 and BR-268 to v3, all active after acceptance on main `b249860` on 2026-11-24 ([#77 acceptance](https://github.com/sstolz/kdrive-mcp-server/issues/77#issuecomment-7143986357)); F-049 v1 (#117) versions BR-026 and BR-027 to v3, both active after acceptance on main `e3c63b8` on 2026-11-22 ([#117 acceptance](https://github.com/sstolz/kdrive-mcp-server/issues/117#issuecomment-7087203460)); F-048 v1 (#110) allocates BR-434 and BR-435 v1 and versions BR-021 to v3, BR-027 to v2 and BR-207 to v3, all active after acceptance on main `f4487a2`; F-047 v1 (#111) activates BR-026 v2 on main `c58e7bb`, 2026-11-19 ([#111 acceptance](https://github.com/sstolz/kdrive-mcp-server/issues/111#issuecomment-7021357708)); F-046 v1 (#112) activates BR-184 v4, BR-186 v3 and BR-187 v4 on main `e8ae20d`, 2026-11-19 ([#112 acceptance](https://github.com/sstolz/kdrive-mcp-server/issues/112#issuecomment-7014711154)); F-045 v1 (#96) versions BR-239/293 to v2 and BR-295 to v3, active after acceptance on main `b65a1e5` ([#96 acceptance](https://github.com/sstolz/kdrive-mcp-server/issues/96#issuecomment-7007926600)); F-024 v4 (#91) versions BR-354, BR-363, BR-372 and BR-373 to v3 and allocates BR-431–BR-433 v1, all active after acceptance on main `d30b3ff`; F-043 v1 (#67) versions BR-387 to v2, active after acceptance on main `f72a15b`; F-042 v1 (#42) allocates BR-428–BR-430 v1, all active after acceptance on main `3b035b8`; F-041 v1 (#47 lot E) allocates BR-427 v1 and versions BR-277 and BR-278 to v2, all active after acceptance on main `448a48f`; F-040 v1 (#47 lot D) allocates BR-423–BR-426 v1 and versions BR-118 to v3, all active after acceptance on main `67c101a`; F-039 v1 (#47 lot C) versions BR-070 to v5 and BR-240, BR-241, BR-254 and BR-259 to v2, all active after acceptance on main `8bc1780`; F-038 v1 (#47 lot B) versions BR-070 to v4 and BR-205 and BR-384 to v2, all active after acceptance on main `2ae303c`; F-037 v1 (#47 lot A) versions BR-248, BR-249, BR-250 and BR-268 to v2, all active after acceptance on main `8b92e07`; F-036 v1 (#49) versions BR-137 to v3, active after acceptance on main `14f5266`; F-035 v1 (#46) allocates BR-421 and BR-422 v1 and versions BR-023 to v4, BR-024 to v5, BR-131, BR-133, BR-137 and BR-186 to v2 and BR-162, BR-167 and BR-184 to v3, all active after acceptance on main `703bece`; F-034 v1 (#4) allocates BR-412–BR-420 v1 and versions BR-114 to v2, and F-034 v2 versions BR-173, BR-226 and BR-392 to v2, all active after acceptance on main `570c4b2`; F-033 v1 (#26) versions BR-129 to v6 and BR-306, BR-307, BR-309 and BR-394 to v2, all active after acceptance on main `6ef8b55`; F-032 v1 (#33) allocates BR-411 v1 and versions BR-129 to v5 and BR-142 to v3, all active after acceptance on main `89be2ba`; F-031 v1 (#31) allocates BR-404–BR-410 v1 and versions BR-129 to v4, BR-143 to v4, BR-393 to v3, BR-399 to v2, BR-402 to v2 and BR-403 to v2, all active after acceptance on main `901f7af`; F-030 v1 (#23) allocates BR-399–BR-403 v1 and versions BR-129 to v3 and BR-393 to v2, all active after acceptance on main `f747072`; F-029 v2 (#25) allocates BR-396–BR-398 v1 and versions BR-171 to v3, all active after acceptance on main `3428df5`; F-028 v2, with BR-291, BR-305–BR-311 and BR-393–BR-395 v1 and BR-023 v3, BR-024 v4, BR-125 v2, BR-128 v3, BR-129 v2, BR-136 v2, BR-143 v3, BR-169 v3, BR-295 v2, BR-298 v2, BR-299 v2 and BR-302 v2, was accepted on actual main `aa540d4` on 2026-11-14; the owner-run claude.ai check is not done and is unblocked since #25 was accepted; F-027 v2, with BR-389–BR-392 v1 and BR-122 v3, BR-315 v2, BR-318 v2, BR-320 v3 and BR-321 v4, and BR-317 superseded by BR-390, was accepted on actual main `75bd9bb` on 2026-11-14; F-026 v1, with BR-380–BR-388 v1 and BR-070 v3, BR-118 v2 and BR-258 v2, was accepted on actual main `2d10e19` on 2026-11-13; F-025 v1, with BR-321 v3, was accepted on actual main `e857db3` on 2026-11-13; F-024 v2, with BR-353–BR-375, BR-378 and BR-379 v1 and BR-016 v3 and BR-178 v3, was accepted on actual main `163e701` on 2026-11-13; BR-376, BR-377 and the BR-321 v2 of F-024 v1 were withdrawn in F-024 v2, and BR-321 v2 is never reused; F-023 v1, with BR-341–BR-352 v1 and BR-015 v7, BR-149 v3, BR-183 v3, BR-225 v3, BR-227 v3, BR-229 v2 and BR-320 v2, was accepted on actual main `ad25fa2` on 2026-11-12; F-022 v2, with BR-328–BR-340 (BR-335 v2, the others v1) and BR-146 v2, was accepted on actual main `e7d6367` on 2026-11-12; F-021 v1, with BR-322–BR-327 v1 and BR-154 v2, BR-156 v2, BR-162 v2, BR-167 v2, BR-168 v2, BR-180 v2, BR-181 v2, BR-184 v2 and BR-187 v3, was accepted on actual main `e208996` on 2026-11-11; F-020 v1, with BR-315–BR-321 v1 and BR-015 v6, BR-122 v2, BR-225 v2 and BR-227 v2, was accepted on actual main `b6acf86` on 2026-11-11; F-019 v1, with BR-290, BR-292–BR-304 and BR-312–BR-314 v1 and BR-023 v2, BR-024 v3, BR-124 v2, BR-128 v2, BR-139 v2, BR-140 v2, BR-142 v2, BR-143 v2, BR-152 v2 and BR-169 v2, was accepted on actual main `68209fe` on 2026-11-11; F-018 v1, with BR-279–BR-289 and BR-035 v2, BR-060 v6, BR-190 v3, BR-266 v2 and BR-274 v2, was accepted on actual main `0f1852c` on 2026-11-10; F-017 v1, with BR-260–BR-278 and BR-039 v2, BR-060 v5, BR-190 v2 and BR-200 v2, was accepted on actual main `4b59c52` on 2026-11-10; F-016 v1, with BR-234–BR-259 and BR-069/BR-070 v2, was accepted on actual main `005b9ba` on 2026-11-10; F-003 v2 and F-004 v1, with BR-029–BR-058, were accepted on 2026-11-09 through the F-014 production acceptance; F-014 v7, with BR-190–BR-217 and BR-016, BR-028, BR-071, BR-123 and BR-175 v2, was accepted on actual main `2a9c1e3` on 2026-11-09). Acceptance covers local
configuration, synthetic injected preflight, accepted #8/#9/#10 injected scopes and the accepted #11 OIDC qualification tooling and validator, and the accepted #14 injected bounded extraction (F-009); F-008 qualified Infomaniak and Gitea as `proxy-only`. The #12 authenticated HTTP
listener in proxy mode is accepted with one real claude.ai connection over a synthetic drive. The production read-only
kDrive adapter and the stdio and HTTP runtime of the packaged CLI are accepted with F-014.

| ID / canonical record | BR version | Rule summary / examples                                                                                                                    | Source feature                                                                                                     | Current status / successor                                                   |
| --------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| [BR-001](BR-001.md)   | v1         | Diagnostic ESM executable; original no-configuration ordinary invocation. [Examples](BR-001.md#examples)                                   | [F-001 v3](../features/history/F-001-v3.md), accepted under [v4](../features/F-001-typescript-foundation.md)       | Superseded by [BR-016 v1](BR-016.md)                                         |
| [BR-002](BR-002.md)   | v1         | Isolated validated drive binding; validate IDs before one adapter call. [Examples](BR-002.md#examples)                                     | [F-001 v3](../features/history/F-001-v3.md), accepted under [v4](../features/F-001-typescript-foundation.md)       | Active                                                                       |
| [BR-003](BR-003.md)   | v1         | Injected metadata dependency only; preserve results/errors without retry or construction I/O. [Examples](BR-003.md#examples)               | [F-001 v3](../features/history/F-001-v3.md), accepted under [v4](../features/F-001-typescript-foundation.md)       | Active                                                                       |
| [BR-004](BR-004.md)   | v1         | Distribution and provenance boundary; package allowlist and private-file exclusions. [Examples](BR-004.md#examples)                        | [F-001 v3](../features/history/F-001-v3.md), accepted under [v4](../features/F-001-typescript-foundation.md)       | Active                                                                       |
| [BR-005](BR-005.md)   | v1         | Original reproducible npm quality commands before Docker-only development. [Examples](BR-005.md#examples)                                  | [F-001 v1](../features/history/F-001-v1.md)                                                                        | Superseded by [BR-007 v1](BR-007.md); never active                           |
| [BR-006](BR-006.md)   | v1         | Original mandatory CI jobs, read-only permissions and no release path. [Examples](BR-006.md#examples)                                      | [F-001 v1](../features/history/F-001-v1.md)                                                                        | Superseded by [BR-008 v1](BR-008.md); never active                           |
| [BR-007](BR-007.md)   | v1         | Reproducible quality commands delegated by Make to Compose dev. [Examples](BR-007.md#examples)                                             | [F-001 v2](../features/history/F-001-v2.md)                                                                        | Superseded by [BR-010 v1](BR-010.md); never active                           |
| [BR-008](BR-008.md)   | v1         | Mandatory CI using the same Docker/Make setup and gates. [Examples](BR-008.md#examples)                                                    | [F-001 v2](../features/history/F-001-v2.md)                                                                        | Superseded by [BR-011 v1](BR-011.md); never active                           |
| [BR-009](BR-009.md)   | v1         | Docker-only Make development, isolated mounts/volumes and no automatic deletion. [Examples](BR-009.md#examples)                            | [F-001 v2](../features/history/F-001-v2.md), retained through [v4](../features/F-001-typescript-foundation.md)     | Active                                                                       |
| [BR-010](BR-010.md)   | v2         | Separate reproducible local quality checks with strict failure behavior. [Examples](BR-010.md#examples)                                    | [F-001 v3](../features/history/F-001-v3.md), accepted under [v4](../features/F-001-typescript-foundation.md)       | v2 Active (F-011, main `bc09d56`); supersedes [BR-007 v1](BR-007.md)         |
| [BR-011](BR-011.md)   | v1         | Mandatory CI and trusted conditional remote analysis. [Examples](BR-011.md#examples)                                                       | [F-001 v3](../features/history/F-001-v3.md)                                                                        | Superseded by [BR-015 v1](BR-015.md)                                         |
| [BR-012](BR-012.md)   | v2         | Fresh bound coverage with input digests and stale-report rejection. [Examples](BR-012.md#examples)                                         | [F-001 v3](../features/history/F-001-v3.md), accepted under [v4](../features/F-001-typescript-foundation.md)       | v2 Active (F-011, main `bc09d56`)                                            |
| [BR-013](BR-013.md)   | v1         | Earlier private trusted-main remote-analysis prerequisites. [Examples](BR-013.md#examples)                                                 | [F-001 v3](../features/history/F-001-v3.md)                                                                        | Superseded by [BR-014 v1](BR-014.md)                                         |
| [BR-014](BR-014.md)   | v2         | Official scanner authentication/gate waiting with the existing Project analysis token and guarded inputs. [Examples](BR-014.md#examples)   | [F-001 v4](../features/F-001-typescript-foundation.md)                                                             | v2 Active (F-011, main `bc09d56`); supersedes [BR-013 v1](BR-013.md)         |
| [BR-015](BR-015.md)   | v4         | Mandatory CI with separately enabled official-scanner analysis on trusted main. [Examples](BR-015.md#examples)                             | [F-001 v4](../features/F-001-typescript-foundation.md)                                                             | v4 Active (F-013, main `25e79ba`); supersedes [BR-011 v1](BR-011.md)         |
| [BR-016](BR-016.md)   | v1         | Locally validated single executable; deployment-free information commands and explicit unavailable runtime. [Examples](BR-016.md#examples) | [F-002 v1](../features/history/F-002-v1.md), accepted under [v2](../features/F-002-configuration.md)               | Active; supersedes [BR-001 v1](BR-001.md); v2 active since F-014 (see below) |
| [BR-017](BR-017.md)   | v1         | Deterministic configuration precedence, list replacement and atomic credential-source selection. [Examples](BR-017.md#examples)            | [F-002 v1](../features/history/F-002-v1.md), clarified and accepted under [v2](../features/F-002-configuration.md) | Active                                                                       |
| [BR-018](BR-018.md)   | v1         | Explicit bounded YAML input with a restricted flat schema. [Examples](BR-018.md#examples)                                                  | [F-002 v1](../features/history/F-002-v1.md), accepted under [v2](../features/F-002-configuration.md)               | Active                                                                       |
| [BR-019](BR-019.md)   | v1         | Explicit configured-drive allowlist; token visibility never expands exposure. [Examples](BR-019.md#examples)                               | [F-002 v1](../features/history/F-002-v1.md), accepted under [v2](../features/F-002-configuration.md)               | Active                                                                       |
| [BR-020](BR-020.md)   | v1         | Complete explicit root coverage for every configured drive. [Examples](BR-020.md#examples)                                                 | [F-002 v1](../features/history/F-002-v1.md), accepted under [v2](../features/F-002-configuration.md)               | Active                                                                       |
| [BR-021](BR-021.md)   | v1 / v2    | Fail-closed injected drive/root preflight with exact numeric-root binding. [Examples](BR-021.md#examples)                                  | [F-002 v1](../features/history/F-002-v1.md), accepted under [v2](../features/F-002-configuration.md)               | v2 active (#88; see acceptance below)                                        |
| [BR-022](BR-022.md)   | v1         | Cumulative read/write/share levels and safe effective feature switches. [Examples](BR-022.md#examples)                                     | [F-002 v1](../features/history/F-002-v1.md), accepted under [v2](../features/F-002-configuration.md)               | Active                                                                       |
| [BR-023](BR-023.md)   | v2         | Bounded configuration values and exact domain/email/subject allowlists. [Examples](BR-023.md#examples)                                     | [F-002 v1](../features/history/F-002-v1.md), accepted under [v2](../features/F-002-configuration.md)               | Active (v2, #103); v3 active since F-028 (see below)                         |
| [BR-024](BR-024.md)   | v3         | Safe transport and authenticated HTTP configuration without provider verification. [Examples](BR-024.md#examples)                          | [F-002 v1](../features/history/F-002-v1.md), v2 accepted under [v3](../features/F-002-configuration.md)            | Active (v3, #103); v4 active since F-028 (see below)                         |
| [BR-025](BR-025.md)   | v2         | Loopback-only insecure HTTP selection; the listener it enables binds `127.0.0.1` only (F-012). [Examples](BR-025.md#examples)              | [F-002 v1](../features/history/F-002-v1.md), v2 in [F-002 v4](../features/F-002-configuration.md) (F-012)          | v2 Active (F-012, accepted `00e6fe3`); v1 history                            |
| [BR-026](BR-026.md)   | v1         | Explicit guarded credential sources with bounded selected-file reads. [Examples](BR-026.md#examples)                                       | [F-002 v1](../features/history/F-002-v1.md), accepted under [v2](../features/F-002-configuration.md)               | Active                                                                       |
| [BR-027](BR-027.md)   | v1         | Stable redacted configuration diagnostics with deterministic phase order. [Examples](BR-027.md#examples)                                   | [F-002 v1](../features/history/F-002-v1.md), accepted under [v2](../features/F-002-configuration.md)               | Active                                                                       |
| [BR-028](BR-028.md)   | v1         | Separate local preparation from resolved readiness through types and synthetic preflight. [Examples](BR-028.md#examples)                   | [F-002 v1](../features/history/F-002-v1.md), accepted under [v2](../features/F-002-configuration.md)               | Active; v2 active since F-014 (see below)                                    |

<a id="accepted--configured-tree-access-policy"></a>

## Accepted — configured-tree access policy

[F-003 v2](../features/F-003-tree-access-policy.md), #6/#7: AC-01–AC-18 by unit tests (green on main `5ede9d6`);
production AC-19/AC-20 passed through F-014 AC-23/AC-24 on main `2a9c1e3` on 2026-11-09 (evidence (private archive)).

| ID                  | Version | Rule                               | Status                                    |
| ------------------- | ------- | ---------------------------------- | ----------------------------------------- |
| [BR-029](BR-029.md) | v1      | Trust successful preflight         | Active                                    |
| [BR-030](BR-030.md) | v1      | Configured-root membership         | Active                                    |
| [BR-031](BR-031.md) | v1      | Identity-bound roots               | Active                                    |
| [BR-032](BR-032.md) | v1      | Fresh decision evidence            | Active                                    |
| [BR-033](BR-033.md) | v1      | Complete consistent evidence       | Active                                    |
| [BR-034](BR-034.md) | v1      | Exact deny matching                | Active                                    |
| [BR-035](BR-035.md) | v1      | Derived operation effects          | Active                                    |
| [BR-036](BR-036.md) | v1      | Folder descendant effects          | Active                                    |
| [BR-037](BR-037.md) | v1      | Traversal ceilings and termination | Active                                    |
| [BR-038](BR-038.md) | v1      | Empty-deny optimization            | Active                                    |
| [BR-039](BR-039.md) | v1      | Original-trash restore proof       | Active; v2 active since F-017 (see below) |
| [BR-040](BR-040.md) | v1      | Conservative folder sharing        | Active                                    |
| [BR-041](BR-041.md) | v1      | Cumulative levels                  | Active                                    |
| [BR-042](BR-042.md) | v2      | Separate received-share route      | Active                                    |
| [BR-043](BR-043.md) | v1      | Immediate guarded dispatch         | Active                                    |
| [BR-044](BR-044.md) | v1      | Fresh collection filtering         | Active                                    |
| [BR-045](BR-045.md) | v1      | Independent all-target batches     | Active                                    |
| [BR-046](BR-046.md) | v1      | Bounded refusal diagnostics        | Active                                    |

<a id="accepted--received-share-access-policy"></a>

## Accepted — received-share access policy

[F-004 v1](../features/F-004-received-share-policy.md), #7: AC-01–AC-13 by unit tests (green on main `5ede9d6`);
production AC-14/AC-15 passed through F-014 AC-25 on main `2a9c1e3` on 2026-11-09 (evidence (private archive)).

| ID                  | Version | Rule                                | Status |
| ------------------- | ------- | ----------------------------------- | ------ |
| [BR-047](BR-047.md) | v1      | Explicit opt-in                     | Active |
| [BR-048](BR-048.md) | v1      | Complete validated discovery        | Active |
| [BR-049](BR-049.md) | v1      | Anchor-relative membership          | Active |
| [BR-050](BR-050.md) | v1      | Recipient-path effects              | Active |
| [BR-051](BR-051.md) | v1      | Bounded list-only read cache        | Active |
| [BR-052](BR-052.md) | v1      | Fresh mutation evidence             | Active |
| [BR-053](BR-053.md) | v1      | Flags, level and exact capabilities | Active |
| [BR-054](BR-054.md) | v1      | Re-sharing always denied            | Active |
| [BR-055](BR-055.md) | v1      | External-root enumeration denied    | Active |
| [BR-056](BR-056.md) | v1      | Fail-closed bounded evidence        | Active |
| [BR-057](BR-057.md) | v1      | Shared immediate facade             | Active |
| [BR-058](BR-058.md) | v1      | Ordinary common/team folders        | Active |

## Preserved supersession chains

- BR-001 → BR-016.
- BR-005 → BR-007 → BR-010.
- BR-006 → BR-008 → BR-011 → BR-015.
- BR-013 → BR-014.

BR-005–BR-008 never became active. Their new historical records extract their
existing definitions verbatim from frozen F-001 v1/v2; they allocate no new rule
and claim no implemented unit coverage. BR-001/011/013 retain their superseded
meaning and historical test references. Follow each record's source and
Verification section for provenance, exact test cases and explicit gaps.

## Verification and boundaries

Examples state concrete Given / When / Then conditions and observable outcomes.
Implemented examples identify one actual test case or parameter row each.
The user requested completing the 122 missing active-rule verification entries
before publication: 121 now have automated cases and one has an identified
manual GNU Make 3.81 test. See boundary-development evidence (private archive)
for actual results; documentation rows and matrix expansions are not counts of
unique tests. Historical-only rules retain their original AC targets without
invented obsolete implementations. See the migration evidence (private archive)
and each record's Verification for preserved historical limits.

All 446 allocated IDs have records, including the pending F-050 rules.
Withdrawn BR-376/BR-377 remain excluded and never reused. Next free BR-449.

## Maintaining this index

Apply the current [AGENTS.md](../AGENTS.md) record/version policy prospectively.
Keep an existing BR ID and increment its version for a same-purpose change;
append History, update tests and cite `BR-NNN vN` in specs, tests and PRs. A
different-purpose replacement receives a new sequential ID with explicit
`supersedes` metadata. Preserve all historical IDs and successor chains; this
migration creates their first versioned record without inventing earlier BR
versions or retroactively reclassifying their supersession.

Keep navigation aligned with the [allocation ledger](../docs/spec-index.md),
canonical records, examples and actual-main acceptance evidence in the same
appropriately scoped, reviewed PR. Pending precedes acceptance; accepted markers
are synchronized according to the existing workflow before release. The next
unused BR ID is BR-423 (BR-376 and BR-377 are withdrawn and never reused). No new delivery step, product contract or release
authorization is introduced. The [capability map](../capability-map.md) describes
accepted user-facing scope and explicitly provisional entries.

## Accepted — injected stdio navigation

F-005 allocated BR-059–BR-071 v1 for #8, accepted on actual main
209a68de956b328e04e2d98d6745128a587184bd. BR-060/065 v2 were accepted under #9;
BR-060 v3 is accepted under #10; v4 is accepted under #14 (main `7b046a0`). The other eleven remain active for their injected scope only.
Production #6/#7 ACs passed through F-014 on 2026-11-09.

| ID                  | Version | Rule                                                                                                                                                                                                     | Source                                                    | Status                                                     |
| ------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| [BR-059](BR-059.md) | v2      | Runtime construction requires the exact successful preflight object (stdio or http) and explicit trusted dependencies, no I/O until started; the stdio runner refuses HTTP configuration.                | [F-005 v2](../features/F-005-stdio-navigation.md) (F-012) | v2 Active (F-012, accepted `00e6fe3`)                      |
| [BR-060](BR-060.md) | v4      | Every operation mode registers exactly the ten declared cumulative read tools and the single existing complete-binary resource template, with no mutation tool, prompt or enumerated resource.           | [F-009 v1](../features/F-009-bounded-content-reading.md)  | Active (v4, #14); v5 active since F-017 (see below)        |
| [BR-061](BR-061.md) | v1      | Item navigation uses the configured default drive when its drive argument is omitted, catalogue omission enumerates configured drives, and an explicit drive never changes or falls back to the default. | [F-005 v1](../features/F-005-stdio-navigation.md)         | Active (injected scope)                                    |
| [BR-062](BR-062.md) | v1      | Drive enumeration exposes only configured drives and their currently authorized root descriptors.                                                                                                        | [F-005 v1](../features/F-005-stdio-navigation.md)         | Active (injected scope)                                    |
| [BR-063](BR-063.md) | v1      | Metadata output is a fixed scalar projection of the exact normalized live item authorized by the policy invocation.                                                                                      | [F-005 v1](../features/F-005-stdio-navigation.md)         | Active (injected scope)                                    |
| [BR-064](BR-064.md) | v1      | Listing returns only authorized direct children of the exact authorized directory scope, optionally filtered by file/directory type.                                                                     | [F-005 v1](../features/F-005-stdio-navigation.md)         | Active (injected scope)                                    |
| [BR-065](BR-065.md) | v2      | Each paged collection response exposes only a bounded authorized batch with continuation exactly when the session retains unfinished work.                                                               | [F-006 v1](../features/F-006-filtered-pagination.md)      | Active (injected scope)                                    |
| [BR-066](BR-066.md) | v1      | Path resolution uses only authorized anchors and successive guarded direct-child listings and returns an item only for an exact canonical path match.                                                    | [F-005 v1](../features/F-005-stdio-navigation.md)         | Active (injected scope)                                    |
| [BR-067](BR-067.md) | v1      | Explicit external-drive reads and scoped listings use the existing opt-in received-share proof route and never external-root enumeration.                                                                | [F-005 v1](../features/F-005-stdio-navigation.md)         | Active (injected scope)                                    |
| [BR-068](BR-068.md) | v1      | Session instructions and every tool description identify the server as unofficial and returned names/paths as untrusted data, never commands or authorization.                                           | [F-005 v1](../features/F-005-stdio-navigation.md)         | Active (injected scope)                                    |
| [BR-069](BR-069.md) | v1      | The stdio runtime writes only MCP protocol messages with sanitized tool/protocol error text to stdout and emits only fixed sanitized diagnostics to stderr.                                              | [F-005 v1](../features/F-005-stdio-navigation.md)         | Active (injected scope); v2 active since F-016 (see below) |
| [BR-070](BR-070.md) | v1      | Every active tool invocation obeys the stated request/output bounds and stops publishing results or starting dependency calls after cancellation, deadline or session close.                             | [F-005 v1](../features/F-005-stdio-navigation.md)         | Active (injected scope); v2 active since F-016 (see below) |
| [BR-071](BR-071.md) | v1      | The packaged CLI retains the exact accepted F-002/BR-016 local preparation diagnostics, status and streams without starting a synthetic session or production runtime.                                   | [F-005 v1](../features/F-005-stdio-navigation.md)         | Active (injected scope); v2 active since F-014 (see below) |

## Accepted — filtered pagination

F-006 v1 rules and BR-060/065 v2 were accepted for injected scope on actual main
`30e059ef8ef3540c4aa4bb6a0de0bf209c963b12`; see #9 acceptance (private archive).
BR-060 v3 is accepted under #10; v4 is accepted under #14 (main `7b046a0`). The #6/#7 production ACs passed through F-014 on 2026-11-09.

| Rule                | Version | Statement                                                                                                                                 | Source                                               | Status                  |
| ------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------- |
| [BR-072](BR-072.md) | v1      | Configured collection scopes execute in configuration order and preserve upstream page order without global sorting.                      | [F-006 v1](../features/F-006-filtered-pagination.md) | Active (injected scope) |
| [BR-073](BR-073.md) | v1      | A paged tool invocation starts at most five upstream list-type dependency calls, counting authorization discovery and traversal calls.    | [F-006 v1](../features/F-006-filtered-pagination.md) | Active (injected scope) |
| [BR-074](BR-074.md) | v1      | A continuation traversal emits each `(drive_id,id)` at most once across pages and overlapping roots.                                      | [F-006 v1](../features/F-006-filtered-pagination.md) | Active (injected scope) |
| [BR-075](BR-075.md) | v1      | Every continuation belongs to one live session, tool, effective argument set and immutable configuration/authorization context.           | [F-006 v1](../features/F-006-filtered-pagination.md) | Active (injected scope) |
| [BR-076](BR-076.md) | v1      | Continuation state is bounded in age, count and retained data and fails without a partial success when those bounds cannot be maintained. | [F-006 v1](../features/F-006-filtered-pagination.md) | Active (injected scope) |
| [BR-077](BR-077.md) | v1      | Every resumed collection invocation obtains current policy authorization before publishing its items; retained state is never a grant.    | [F-006 v1](../features/F-006-filtered-pagination.md) | Active (injected scope) |
| [BR-078](BR-078.md) | v1      | Collection output contains only the five declared metadata fields in every mode and never serializes raw or nested sharing metadata.      | [F-006 v1](../features/F-006-filtered-pagination.md) | Active (injected scope) |
| [BR-079](BR-079.md) | v1      | Configured collection entries satisfy the requested scope and external entries satisfy the existing opt-in received-share proof route.    | [F-006 v1](../features/F-006-filtered-pagination.md) | Active (injected scope) |
| [BR-080](BR-080.md) | v1      | An invalid, expired or unavailable continuation produces one fixed sanitized error and starts no dependency call.                         | [F-006 v1](../features/F-006-filtered-pagination.md) | Active (injected scope) |
| [BR-081](BR-081.md) | v1      | Cancellation, timeout, close or a failed page invalidates the affected traversal and publishes no partial batch or reusable continuation. | [F-006 v1](../features/F-006-filtered-pagination.md) | Active (injected scope) |

<a id="accepted--raw-content-and-resources"></a>

## Accepted — raw content and resources

F-007 v1 and BR-082–093 / BR-060 v3 are accepted for injected scope on
main4f84e4bb5343274d779ff43061effb60aa3cb64b; see #10 acceptance (private archive).
No production adapter or version qualification is established.

| Rule                | Version | Statement                                                                                                                                                                                     | Source                                             | Status                  |
| ------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------- |
| [BR-082](BR-082.md) | v1      | Each content attempt and each publication uses the existing live read policy for the exact owner drive and file; denial starts no protected content call and publishes no bytes.              | [F-007 v1](../features/F-007-bounded-downloads.md) | Active (injected scope) |
| [BR-083](BR-083.md) | v1      | Raw continuation offsets count bytes, and every successful chunk is bound to one qualified strong file version.                                                                               | [F-007 v1](../features/F-007-bounded-downloads.md) | Active (injected scope) |
| [BR-084](BR-084.md) | v1      | A successful range contains exactly the requested identity, inclusive byte bounds, total size, strong ETag and body length, with no ignored range or full-body fallback.                      | [F-007 v1](../features/F-007-bounded-downloads.md) | Active (injected scope) |
| [BR-085](BR-085.md) | v1      | Raw body consumption and successful serialization stay within the stated byte, time, call and base64-inclusive output limits without partial publication.                                     | [F-007 v1](../features/F-007-bounded-downloads.md) | Active (injected scope) |
| [BR-086](BR-086.md) | v1      | A resource success contains one complete raw binary blob and never a truncated blob, extracted text or sliced MCP image.                                                                      | [F-007 v1](../features/F-007-bounded-downloads.md) | Active (injected scope) |
| [BR-087](BR-087.md) | v1      | Unsupported resource representations refuse explicitly before any protected dependency call.                                                                                                  | [F-007 v1](../features/F-007-bounded-downloads.md) | Active (injected scope) |
| [BR-088](BR-088.md) | v1      | A retry starts only for a branded pre-body normalized read failure with status429 or500–599, and never exceeds three attempts for that logical call or the invocation's shared limits.        | [F-007 v1](../features/F-007-bounded-downloads.md) | Active (injected scope) |
| [BR-089](BR-089.md) | v1      | Cancellation, deadline and close prevent new attempts and late publication, settle owned waits and close any opened body.                                                                     | [F-007 v1](../features/F-007-bounded-downloads.md) | Active (injected scope) |
| [BR-090](BR-090.md) | v1      | Errors and diagnostics contain only declared fixed strings and never serialize content, credentials, raw headers, URLs or dependency errors.                                                  | [F-007 v1](../features/F-007-bounded-downloads.md) | Active (injected scope) |
| [BR-091](BR-091.md) | v1      | Content envelopes are validated from own data properties before use and output is copied into the declared scalar/blob projection without invoking dependency getters or serialization hooks. | [F-007 v1](../features/F-007-bounded-downloads.md) | Active (injected scope) |
| [BR-092](BR-092.md) | v1      | Missing qualified content dependencies fail explicitly and leave the existing diagnostic production CLI unchanged.                                                                            | [F-007 v1](../features/F-007-bounded-downloads.md) | Active (injected scope) |
| [BR-093](BR-093.md) | v1      | The central retry wrapper applies to injected read ports only and never changes abstract policy dispatch or retries `execute`.                                                                | [F-007 v1](../features/F-007-bounded-downloads.md) | Active (injected scope) |

<a id="accepted--oidc-provider-qualification"></a>

## Accepted — OIDC provider qualification

F-008 v1 and BR-094–BR-108 are accepted: AC-01–AC-19 on actual main
`2cec566ab8e2f030dbbbf47f04bf541e5eb48dc4` and the owner-run AC-20 on actual main
`7b046a0446930ab6a935510314c6c1b975d13550` (Infomaniak discover (private archive), Infomaniak token (private archive), Gitea discover (private archive) and Gitea token (private archive)). Both providers are `proxy-only`;
no HTTP/OAuth runtime or real client connection is established.

| ID                  | Version | Rule                                                                                                              | Source                                              | Status                     |
| ------------------- | ------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------- |
| [BR-094](BR-094.md) | v1      | Discovery accepts only a plain `https` issuer and uses OIDC/RFC 8414 documents whose `issuer` matches exactly.    | [F-008 v1](../features/F-008-oidc-qualification.md) | Active                     |
| [BR-095](BR-095.md) | v1      | Per-document `yes`/`no`/`unknown` capabilities with an effective value and listed contradictions.                 | [F-008 v1](../features/F-008-oidc-qualification.md) | Active                     |
| [BR-096](BR-096.md) | v1      | The `token` step starts only for a qualifying provider and owner inputs; PKCE S256, `state`, `nonce`, `resource`. | [F-008 v1](../features/F-008-oidc-qualification.md) | Accepted; superseded by v2 |
| [BR-097](BR-097.md) | v1      | Validated redirect paste, token exchange client authentication and no-echo client secret.                         | [F-008 v1](../features/F-008-oidc-qualification.md) | Active                     |
| [BR-098](BR-098.md) | v1      | Access-token validator: algorithms, `crit`, signature, `iss`, `aud`, `sub`, `exp`, `nbf`; canonical audience.     | [F-008 v1](../features/F-008-oidc-qualification.md) | Active                     |
| [BR-099](BR-099.md) | v1      | A `nonce` claim or ID-token `typ` is rejected with 401 `id-token`.                                                | [F-008 v1](../features/F-008-oidc-qualification.md) | Active                     |
| [BR-100](BR-100.md) | v2      | `(iss, sub)` and verified-email allowlists; 403 `identity`; empty lists are a configuration error.                | [F-008 v1](../features/F-008-oidc-qualification.md) | Active (v2, #21)           |
| [BR-101](BR-101.md) | v1      | Token analysis, positive/negative identity checks, ID-token usability and RFC 9207 consistency.                   | [F-008 v1](../features/F-008-oidc-qualification.md) | Active                     |
| [BR-102](BR-102.md) | v1      | Provider verdict from discovery and real-token evidence.                                                          | [F-008 v1](../features/F-008-oidc-qualification.md) | Active                     |
| [BR-103](BR-103.md) | v1      | Per-client mode decision from the matrix and the P-21 promotion flag.                                             | [F-008 v1](../features/F-008-oidc-qualification.md) | Accepted; superseded by v2 |
| [BR-104](BR-104.md) | v1      | No token, code, verifier, secret or identity value in the report or terminal; pre-write leak scan.                | [F-008 v1](../features/F-008-oidc-qualification.md) | Active                     |
| [BR-105](BR-105.md) | v1      | The command and reports stay out of the package; `dist/auth/` and pinned `jose` are packed.                       | [F-008 v1](../features/F-008-oidc-qualification.md) | Active                     |
| [BR-106](BR-106.md) | v1      | Provider-controlled values are bounded, sanitized code spans; error codes only.                                   | [F-008 v1](../features/F-008-oidc-qualification.md) | Active                     |
| [BR-107](BR-107.md) | v1      | Usable JWKS keys; a private member makes the whole set unusable.                                                  | [F-008 v1](../features/F-008-oidc-qualification.md) | Active                     |
| [BR-108](BR-108.md) | v1      | Dated client compatibility matrix with allowed values and reference-version comparison.                           | [F-008 v1](../features/F-008-oidc-qualification.md) | Active                     |

<a id="accepted--bounded-extracted-content"></a>

## Accepted — bounded extracted content

F-009 allocates BR-109–123 v1 and versions BR-060 to v4 for #14. All are
accepted on actual main `7b046a0` (acceptance (private archive)). Only the declared injected profile is covered.

| Rule                | Version | Statement                                                                                                                                                                            | Source                                                   | Status                                    |
| ------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | ----------------------------------------- |
| [BR-109](BR-109.md) | v1      | Each read download attempt and each final publication passes the existing fresh owner-drive/file read policy, with no protected content call or content disclosure after denial.     | [F-009 v1](../features/F-009-bounded-content-reading.md) | Active                                    |
| [BR-110](BR-110.md) | v1      | Every extracted continuation uses Unicode code-point offsets in one qualified strong source version and exactly the declared selection.                                              | [F-009 v1](../features/F-009-bounded-content-reading.md) | Active                                    |
| [BR-111](BR-111.md) | v1      | Every extraction downloads one entire bounded source version through exact F-007 range/body evidence before decoding any source bytes.                                               | [F-009 v1](../features/F-009-bounded-content-reading.md) | Active                                    |
| [BR-112](BR-112.md) | v1      | Text decoding accepts only the declared encodings with strict validation, preserves text after one leading BOM removal and never silently substitutes malformed input.               | [F-009 v1](../features/F-009-bounded-content-reading.md) | Active                                    |
| [BR-113](BR-113.md) | v1      | Text/selected-page output truncates only at code-point boundaries and reports exact progress while counting the entire serialized output budget.                                     | [F-009 v1](../features/F-009-bounded-content-reading.md) | Active                                    |
| [BR-114](BR-114.md) | v1      | PDF extraction accepts only the bounded preflight profile and never starts PDF.js on unsupported, malformed or over-budget containers.                                               | [F-009 v1](../features/F-009-bounded-content-reading.md) | Active; v2 active since F-034 (see below) |
| [BR-115](BR-115.md) | v1      | PDF text contains only the requested ordered pages with declared separators, and a selection without extractable non-whitespace text returns an explicit no-text result without OCR. | [F-009 v1](../features/F-009-bounded-content-reading.md) | Active                                    |
| [BR-116](BR-116.md) | v1      | Image decoding starts only after bounded format/dimension/ decompression admission and publishes exactly one complete valid resized PNG with metadata, or an explicit refusal.       | [F-009 v1](../features/F-009-bounded-content-reading.md) | Active                                    |
| [BR-117](BR-117.md) | v1      | All input, decoded/decompressed, structural, processing-time and serialized-output ceilings are cumulative within one invocation and equality is permitted.                          | [F-009 v1](../features/F-009-bounded-content-reading.md) | Active                                    |
| [BR-118](BR-118.md) | v1      | Cancellation, deadline and close terminate owned extraction work before the invocation slot is released and suppress late publication.                                               | [F-009 v1](../features/F-009-bounded-content-reading.md) | Active; v2 active since F-026 (see below) |
| [BR-119](BR-119.md) | v1      | Unsupported binary and unsupported containers return declared fixed results and never fall back to lossy text or a different representation.                                         | [F-009 v1](../features/F-009-bounded-content-reading.md) | Active                                    |
| [BR-120](BR-120.md) | v1      | Content/worker errors and diagnostics serialize only declared fixed strings and never dependency messages, content, URLs or credentials.                                             | [F-009 v1](../features/F-009-bounded-content-reading.md) | Active                                    |
| [BR-121](BR-121.md) | v1      | Source envelopes and worker outputs are validated from own data properties and copied into declared projections without invoking hooks.                                              | [F-009 v1](../features/F-009-bounded-content-reading.md) | Active                                    |
| [BR-122](BR-122.md) | v1      | Extraction/image dependencies execute without external requests, optional native/WASM codecs, eval or document-supplied JavaScript.                                                  | [F-009 v1](../features/F-009-bounded-content-reading.md) | Active; v3 active since F-027 (see below) |
| [BR-123](BR-123.md) | v1      | Missing qualified content dependencies refuse authorized reads explicitly while existing raw/resources/navigation and the production diagnostic retain their accepted contracts.     | [F-009 v1](../features/F-009-bounded-content-reading.md) | Active; v2 active since F-014 (see below) |

<a id="accepted--oauth-proxy"></a>

## Accepted — bounded OAuth proxy

F-010 v1 and BR-124–BR-143 v1, with BR-100 v2 and BR-024 v2 (F-002 v3), are
accepted on actual main `3fc14c3bbbd57b3c52ca4b74c07a512720f0d627` (`make check`
rc=0, 76 files / 1746 tests; PR #51 CI green; closure comment on #21). Real
MCP-client connections are deferred to #12/#13 and are not established.

| ID                  | Version | Rule                                                                                                  | Source                                       | Status                                               |
| ------------------- | ------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------- |
| [BR-124](BR-124.md) | v2      | Side-effect-free construction; PKCS#8 EC P-256 signing key only; RFC 7638 `kid`.                      | [F-010 v1](../features/F-010-oauth-proxy.md) | Active (v2, #103)                                    |
| [BR-125](BR-125.md) | v1      | RFC 8414 metadata with RFC 9207 `true`, no CIMD, and RFC 8414/OIDC well-known paths.                  | [F-010 v1](../features/F-010-oauth-proxy.md) | Active; v2 active since F-028 (see below)            |
| [BR-126](BR-126.md) | v1      | Byte-exact redirect matching; only the port of `127.0.0.1`, `[::1]` and `localhost` HTTP URIs varies. | [F-010 v1](../features/F-010-oauth-proxy.md) | Active                                               |
| [BR-127](BR-127.md) | v1      | Dynamic registration limited to the redirect allowlist; three client authentication methods.          | [F-010 v1](../features/F-010-oauth-proxy.md) | Accepted; superseded by v2                           |
| [BR-128](BR-128.md) | v2      | Authorization validation: error page for unverified targets, ordered client redirects otherwise.      | [F-010 v1](../features/F-010-oauth-proxy.md) | Active (v2, #103); v3 active since F-028 (see below) |
| [BR-129](BR-129.md) | v1      | Consent page on every authorization; one-use 600-second consent; security headers.                    | [F-010 v1](../features/F-010-oauth-proxy.md) | Active; v6 active since F-033 (see below)            |
| [BR-130](BR-130.md) | v1      | `__Host-kdrive-oauth` browser binding cookie, refreshed by each state-creating response.              | [F-010 v1](../features/F-010-oauth-proxy.md) | Active                                               |
| [BR-131](BR-131.md) | v1      | Upstream discovery, PKCE S256, `state`, `nonce` and bounded upstream requests.                        | [F-010 v1](../features/F-010-oauth-proxy.md) | Active; v2 active since F-035 (see below)            |
| [BR-132](BR-132.md) | v1      | Ordered callback checks; RFC 9207 `iss`; fixed error mapping; upstream code exchange.                 | [F-010 v1](../features/F-010-oauth-proxy.md) | Active                                               |
| [BR-133](BR-133.md) | v1      | Strict upstream ID-token verification with bounded JWKS caching and refetch.                          | [F-010 v1](../features/F-010-oauth-proxy.md) | Active; v2 active since F-035 (see below)            |
| [BR-134](BR-134.md) | v1      | Upstream `(iss, sub)` or verified-email allowlist at login; else `access_denied`.                     | [F-010 v1](../features/F-010-oauth-proxy.md) | Active                                               |
| [BR-135](BR-135.md) | v1      | One-use 60-second code bound to client, redirect, PKCE, resource and identity.                        | [F-010 v1](../features/F-010-oauth-proxy.md) | Active                                               |
| [BR-136](BR-136.md) | v1      | Token-endpoint client authentication; `401 invalid_client` for unknown clients.                       | [F-010 v1](../features/F-010-oauth-proxy.md) | Active; v2 active since F-028 (see below)            |
| [BR-137](BR-137.md) | v1      | Authorization-code grant checks; consumption before `await`; reuse revokes the family.                | [F-010 v1](../features/F-010-oauth-proxy.md) | Active; v3 active since F-036 (see below)            |
| [BR-138](BR-138.md) | v1      | One-hour ES256 `at+jwt` access token with `kid`, `upstream_iss` and `client_id`.                      | [F-010 v1](../features/F-010-oauth-proxy.md) | Active                                               |
| [BR-139](BR-139.md) | v2      | Hashed refresh tokens; 30-day family and 7-day inactivity bounds; rotation.                           | [F-010 v1](../features/F-010-oauth-proxy.md) | Active (v2, #103)                                    |
| [BR-140](BR-140.md) | v2      | Ordered refresh checks; reuse or cross-client use revokes the family.                                 | [F-010 v1](../features/F-010-oauth-proxy.md) | Active (v2, #103)                                    |
| [BR-141](BR-141.md) | v1      | Proxy verifier is the F-008 validator with `upstreamIssuer` (BR-100 v2).                              | [F-010 v1](../features/F-010-oauth-proxy.md) | Active                                               |
| [BR-142](BR-142.md) | v2      | Single-instance in-memory state, restart semantics and 1,000-entry store bounds.                      | [F-010 v1](../features/F-010-oauth-proxy.md) | Active (v2, #103); v3 active since F-032 (see below) |
| [BR-143](BR-143.md) | v2      | No secret, code, token, cookie or identity in refusals or fixed-event logs.                           | [F-010 v1](../features/F-010-oauth-proxy.md) | Accepted; superseded by v5                           |

<a id="accepted--http-image"></a>

## Accepted — multi-architecture HTTP container image

F-013 v2 (#13, frozen 2026-11-05) allocates BR-172–BR-188 v1 and versions BR-015
to v4 (the `image` CI job). All were accepted on actual main `25e79ba` on 2026-11-05 (evidence (private archive)).

| ID                  | Version | Rule                                                                                                                   | Source                                      | Status                                    |
| ------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------- |
| [BR-172](BR-172.md) | v1      | Production Dockerfile stages, native build stages, digest-pinned Node 26.13.0 bases.                                   | [F-013 v2](../features/F-013-http-image.md) | Active                                    |
| [BR-173](BR-173.md) | v1      | `deps` installs production dependencies without optional ones; `runtime` copies an allowlist and runs no npm.          | [F-013 v2](../features/F-013-http-image.md) | Active; v2 active since F-034 (see below) |
| [BR-174](BR-174.md) | v1      | Runtime runs as UID/GID 1000; `/app` is root-owned and not group/other-writable.                                       | [F-013 v2](../features/F-013-http-image.md) | Active                                    |
| [BR-175](BR-175.md) | v1      | Runtime environment, stop signal, port and CLI entrypoint; honest not-implemented diagnostic.                          | [F-013 v2](../features/F-013-http-image.md) | Active; v2 active since F-014 (see below) |
| [BR-176](BR-176.md) | v1      | `smoke` stage adds only the dev-only acceptance composition.                                                           | [F-013 v2](../features/F-013-http-image.md) | Active                                    |
| [BR-177](BR-177.md) | v1      | `make image` builds and loads `runtime` and `smoke` per platform and checks the loaded platform.                       | [F-013 v2](../features/F-013-http-image.md) | Active                                    |
| [BR-178](BR-178.md) | v1      | No image push, publication or registry login anywhere.                                                                 | [F-013 v2](../features/F-013-http-image.md) | Active                                    |
| [BR-179](BR-179.md) | v1      | `.dockerignore` excludes secrets and local state; no secret-named ARG/ENV.                                             | [F-013 v2](../features/F-013-http-image.md) | Active                                    |
| [BR-180](BR-180.md) | v1      | Smoke runner: hardened containers, exact smoke launch, synthetic secrets in tmpfs.                                     | [F-013 v2](../features/F-013-http-image.md) | Active                                    |
| [BR-181](BR-181.md) | v1      | Smoke pass conditions: startup, UID/PID 1, metadata 200, unauthenticated 401, SIGTERM exit 0, runtime checks.          | [F-013 v2](../features/F-013-http-image.md) | Active                                    |
| [BR-182](BR-182.md) | v1      | Smoke runner fails fast, names the check, removes only its own containers.                                             | [F-013 v2](../features/F-013-http-image.md) | Active                                    |
| [BR-183](BR-183.md) | v1      | CI job `image`: per-architecture matrix, read-only, bounded, Make-only steps.                                          | [F-013 v2](../features/F-013-http-image.md) | Active                                    |
| [BR-184](BR-184.md) | v1      | Compose example: hardened single service, file secrets, Traefik routing, required variables.                           | [F-013 v2](../features/F-013-http-image.md) | Active; v4 active since F-046 (see below) |
| [BR-185](BR-185.md) | v1      | YAML configuration example for `--config`, file credentials only.                                                      | [F-013 v2](../features/F-013-http-image.md) | Active                                    |
| [BR-186](BR-186.md) | v1      | Examples and deployment doc use only reserved hosts, two addresses and no installation path.                           | [F-013 v2](../features/F-013-http-image.md) | Active; v3 active since F-046 (see below) |
| [BR-187](BR-187.md) | v2      | Deployment doc sections incl. personal-server guide and Troubleshooting, truthful status phrases, no readiness claims. | [F-013 v3](../features/F-013-http-image.md) | Active; v4 active since F-046 (see below) |
| [BR-188](BR-188.md) | v1      | `make image-binfmt`: opt-in, digest-pinned arm64 emulation registration.                                               | [F-013 v2](../features/F-013-http-image.md) | Active                                    |

<a id="accepted--authenticated-http"></a>

## Accepted — authenticated Streamable HTTP (proxy mode)

F-012 v1, BR-152–BR-171 v1, BR-025 v2 (F-002 v4) and BR-059 v2 (F-005 v2) are
accepted on actual main `00e6fe340a505ce57967b486a0bda6f7c2f4d2d9` (`make check`
rc=0, 94 files / 2031 tests; PR #53 CI green; owner-run AC-21 with claude.ai web,
evidence (private archive)).
F-012 v2 (#63, autonomous freeze 2026-11-05) versions BR-171 to v2 and allocates
BR-189 v1; both were accepted on actual main `7b8b52d` on 2026-11-05
(evidence (private archive)).

| ID                  | Version | Rule                                                                                                                   | Source                                              | Status                                    |
| ------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------- |
| [BR-152](BR-152.md) | v2      | Startup validation: resolved HTTP configuration, proxy mode, path-bearing public URL, upstream port; one source for P. | [F-012 v1](../features/F-012-authenticated-http.md) | Active (v2, #103)                         |
| [BR-153](BR-153.md) | v1      | Bind the effective host and port; insecure mode binds literal 127.0.0.1 and is verified after listen.                  | [F-012 v1](../features/F-012-authenticated-http.md) | Active                                    |
| [BR-154](BR-154.md) | v1      | Exact route table; byte-exact matching; 404 and 405 with Allow.                                                        | [F-012 v1](../features/F-012-authenticated-http.md) | Active                                    |
| [BR-155](BR-155.md) | v1      | Protected-resource metadata with exactly three members.                                                                | [F-012 v1](../features/F-012-authenticated-http.md) | Active                                    |
| [BR-156](BR-156.md) | v1      | Host check before routing, authentication and body reads.                                                              | [F-012 v1](../features/F-012-authenticated-http.md) | Active                                    |
| [BR-157](BR-157.md) | v1      | Origin check on the MCP endpoint and the consent form.                                                                 | [F-012 v1](../features/F-012-authenticated-http.md) | Active                                    |
| [BR-158](BR-158.md) | v1      | Credential only from the Authorization header; 400 and 401 mapping.                                                    | [F-012 v1](../features/F-012-authenticated-http.md) | Active                                    |
| [BR-159](BR-159.md) | v1      | Every MCP request verified; one 401 for every rejection; 403 for a denied identity.                                    | [F-012 v1](../features/F-012-authenticated-http.md) | Active                                    |
| [BR-160](BR-160.md) | v1      | Body limits, framing, media types and single JSON-RPC messages.                                                        | [F-012 v1](../features/F-012-authenticated-http.md) | Active                                    |
| [BR-161](BR-161.md) | v1      | 120 requests per 60 seconds per identity.                                                                              | [F-012 v1](../features/F-012-authenticated-http.md) | Active                                    |
| [BR-162](BR-162.md) | v1      | Process-wide windows for the unauthenticated OAuth routes.                                                             | [F-012 v1](../features/F-012-authenticated-http.md) | Active                                    |
| [BR-163](BR-163.md) | v1      | Sessions bound to an identity; JSON responses; identical 404 for any mismatch.                                         | [F-012 v1](../features/F-012-authenticated-http.md) | Active                                    |
| [BR-164](BR-164.md) | v1      | Session idle, lifetime, per-identity and process bounds; 503 for in-flight requests of a closing session.              | [F-012 v1](../features/F-012-authenticated-http.md) | Accepted; superseded by v2                |
| [BR-165](BR-165.md) | v1      | OAuth routes call the F-010 handlers unchanged.                                                                        | [F-012 v1](../features/F-012-authenticated-http.md) | Active                                    |
| [BR-166](BR-166.md) | v1      | No client credential reaches the SDK, tools or the upstream port.                                                      | [F-012 v1](../features/F-012-authenticated-http.md) | Accepted; superseded by v2                |
| [BR-167](BR-167.md) | v1      | No secret, token, session ID or identity in responses or logs; request_refused, session_opened, session_closed events. | [F-012 v1](../features/F-012-authenticated-http.md) | Accepted; superseded by v4                |
| [BR-168](BR-168.md) | v1      | Loopback-only unauthenticated mode with only the MCP endpoint.                                                         | [F-012 v1](../features/F-012-authenticated-http.md) | Active                                    |
| [BR-169](BR-169.md) | v2      | Fixed server timeouts and bounds; ordered shutdown.                                                                    | [F-012 v1](../features/F-012-authenticated-http.md) | Accepted; superseded by v4                |
| [BR-170](BR-170.md) | v1      | node:http adapter from raw headers and target; 500 for any exception; close after an unread body.                      | [F-012 v1](../features/F-012-authenticated-http.md) | Active                                    |
| [BR-171](BR-171.md) | v2      | Dev-only owner-run acceptance composition; secrets from an external directory mounted read-only.                       | [F-012 v2](../features/F-012-authenticated-http.md) | Active; v3 active since F-029 (see below) |
| [BR-189](BR-189.md) | v1      | The local Sonar entry refuses a checkout holding a `secrets` path.                                                     | [F-012 v2](../features/F-012-authenticated-http.md) | Active (#63, main `7b8b52d`)              |

<a id="accepted--pre-merge-quality-gates"></a>

## Accepted — pre-merge quality gates

F-011 v1 allocates BR-144–BR-151 v1 for #50 and versions BR-010, BR-012,
BR-014 and BR-015 to v2. F-011 v2 (after PR #52 review 1, frozen 2026-11-03) versions BR-144,
BR-150 and BR-151 to v2 and BR-015 to v3. F-011 v3 (2026-11-04) versions BR-151 to v3
(`.git/config.worktree` saved and compared). All are active, accepted on main `bc09d56`
(acceptance (private archive)).

| ID                  | Version | Rule                                                                                                          | Source                                                   | Status |
| ------------------- | ------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------ |
| [BR-144](BR-144.md) | v2      | Named, justified lint suppressions; upstream error rules kept; bounded tests allowlist; no Sonar line marker. | [F-011 v2](../features/F-011-pre-merge-quality-gates.md) | Active |
| [BR-145](BR-145.md) | v1      | Exactly one canonical `https` Sonar host from `SONAR_HOST_URL` or an external `SONAR_HOST_URL_FILE`.          | [F-011 v1](../features/F-011-pre-merge-quality-gates.md) | Active |
| [BR-146](BR-146.md) | v1      | The host is never printed; case-insensitive redaction of the host name across chunks and streams.             | [F-011 v1](../features/F-011-pre-merge-quality-gates.md) | Active |
| [BR-147](BR-147.md) | v1      | No host property; analysed set is `src/` and `tests/`; analysis fails when it names the host.                 | [F-011 v1](../features/F-011-pre-merge-quality-gates.md) | Active |
| [BR-148](BR-148.md) | v1      | `make sonar-pr` analyses only a same-repository PR merge commit into `kdrive-mcp-server-pr`.                  | [F-011 v1](../features/F-011-pre-merge-quality-gates.md) | Active |
| [BR-149](BR-149.md) | v1      | `sonar-pr` CI job: after the gates, serialized, fork refusal, disabled notice, exact analysis environment.    | [F-011 v1](../features/F-011-pre-merge-quality-gates.md) | Active |
| [BR-150](BR-150.md) | v2      | Secrets reach only the analysis service; read-only prep; pristine snapshot; fixed mode; manifest binding.     | [F-011 v2](../features/F-011-pre-merge-quality-gates.md) | Active |
| [BR-151](BR-151.md) | v3      | Inline pristine export and Git-metadata save before setup, comparison, final `.git` quarantine step.          | [F-011 v3](../features/F-011-pre-merge-quality-gates.md) | Active |

<a id="accepted--production-kdrive-adapter"></a>

## Accepted — production kDrive adapter

F-014 v1 (#70, frozen 2026-11-05) allocates BR-190–BR-217 v1 and versions
BR-016, BR-028, BR-071, BR-123 and BR-175 to v2. F-014 v2–v7 version further
rules (see each record's History). All were accepted with F-014 v7 on actual
main `2a9c1e3` on 2026-11-09 (evidence (private archive)); the v2
statements of the five versioned rules replace their v1 statements listed above.

| ID                  | Version | Rule                                                                                                          | Source                                                     | Status                                    |
| ------------------- | ------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------- |
| [BR-190](BR-190.md) | v1      | The adapter issues only `GET` requests, only to origin `https://api.infomaniak.com` (port 443) on the ….      | [F-014 v1](../features/F-014-production-kdrive-adapter.md) | Active; v2 active since F-017 (see below) |
| [BR-191](BR-191.md) | v1      | Before each connection the adapter resolves the host, refuses the connection unless every resolved address …. | [F-014 v1](../features/F-014-production-kdrive-adapter.md) | Active                                    |
| [BR-192](BR-192.md) | v1      | A JSON route response with any 3xx status is refused.                                                         | [F-014 v1](../features/F-014-production-kdrive-adapter.md) | Active                                    |
| [BR-193](BR-193.md) | v1      | Each JSON request completes, body included, within 5,000 ms; each download open reaches its final response …. | [F-014 v1](../features/F-014-production-kdrive-adapter.md) | Active                                    |
| [BR-194](BR-194.md) | v1      | The adapter counts body bytes before parsing or keeping them and refuses a JSON success body above 4 MiB, ….  | [F-014 v1](../features/F-014-production-kdrive-adapter.md) | Active                                    |
| [BR-195](BR-195.md) | v1      | At most 8 upstream requests are in flight per process; further requests wait first-in first-out in a queue …. | [F-014 v1](../features/F-014-production-kdrive-adapter.md) | Active                                    |
| [BR-196](BR-196.md) | v1      | The adapter never retries.                                                                                    | [F-014 v1](../features/F-014-production-kdrive-adapter.md) | Active                                    |
| [BR-197](BR-197.md) | v1      | Every port call issues its own fresh upstream requests: the adapter keeps no response, ancestry, role, ….     | [F-014 v1](../features/F-014-production-kdrive-adapter.md) | Active                                    |
| [BR-198](BR-198.md) | v1      | `inspect` of a `live` target returns the normalized complete item when the BR-199 checks pass, ….             | [F-014 v1](../features/F-014-production-kdrive-adapter.md) | Active                                    |
| [BR-199](BR-199.md) | v2      | Root `1` normalizes to the sentinel root with an empty chain; any other provider item normalizes only when …. | [F-014 v2](../features/F-014-production-kdrive-adapter.md) | Active                                    |
| [BR-200](BR-200.md) | v1      | `inspect` with location `original-trash` and every `execute` call return `{status:"unavailable"}` without ….  | [F-014 v1](../features/F-014-production-kdrive-adapter.md) | Active; v2 active since F-017 (see below) |
| [BR-201](BR-201.md) | v3      | `children` requests `limit=50` with `with=path,parents,capabilities` and the request cursor; it returns ….    | [F-014 v5](../features/F-014-production-kdrive-adapter.md) | Active                                    |
| [BR-202](BR-202.md) | v3      | `collection` serves `list` (children route), `search` (`query`, plus `directory_id` when the scope is not ….  | [F-014 v5](../features/F-014-production-kdrive-adapter.md) | Active                                    |
| [BR-203](BR-203.md) | v3      | Received `list` uses only the unscoped `/3/drive/files/shared_with_me`; received `inspect` uses the ….        | [F-014 v4](../features/F-014-production-kdrive-adapter.md) | Active                                    |
| [BR-204](BR-204.md) | v1      | Normalized received capabilities set `read` to the provider `can_read === true`, set `list` and `search` ….   | [F-014 v1](../features/F-014-production-kdrive-adapter.md) | Active                                    |
| [BR-205](BR-205.md) | v1      | `describe` reads fresh metadata, then issues one download with `Range: bytes=0-0`; it returns ….              | [F-014 v1](../features/F-014-production-kdrive-adapter.md) | Active; v2 active since F-038 (see below) |
| [BR-206](BR-206.md) | v1      | `open` sends `Range: bytes=<start>-<end>` and `Accept-Encoding: identity`; before exposing a body it ….       | [F-014 v1](../features/F-014-production-kdrive-adapter.md) | Active                                    |
| [BR-207](BR-207.md) | v1 / v2 | `inspectDrive` returns `{id, role}` with the provider role of that drive from one ….                          | [F-014 v1](../features/F-014-production-kdrive-adapter.md) | v2 active (#88; see acceptance below)     |
| [BR-208](BR-208.md) | v1      | The token is read only through the existing F-002 sources.                                                    | [F-014 v1](../features/F-014-production-kdrive-adapter.md) | Active                                    |
| [BR-209](BR-209.md) | v1      | The extraction worker starts with `env: {}`, `argv: []` and `execArgv: []`.                                   | [F-014 v1](../features/F-014-production-kdrive-adapter.md) | Active                                    |
| [BR-210](BR-210.md) | v1      | In HTTP mode the CLI composes `startHttpServer` with the resolved configuration, the production adapter, ….   | [F-014 v1](../features/F-014-production-kdrive-adapter.md) | Active                                    |
| [BR-211](BR-211.md) | v3      | `make kdrive-record` runs only inside the dev Compose service, reads the token and the private fixture ….     | [F-014 v5](../features/F-014-production-kdrive-adapter.md) | Active                                    |
| [BR-212](BR-212.md) | v1      | `make kdrive-record` and `make kdrive-acceptance` refuse, before any Docker command, a ….                     | [F-014 v1](../features/F-014-production-kdrive-adapter.md) | Active                                    |
| [BR-213](BR-213.md) | v3      | A sanitized recording keeps only the JSON members of the Recorded-members list and drops every other ….       | [F-014 v5](../features/F-014-production-kdrive-adapter.md) | Active                                    |
| [BR-214](BR-214.md) | v2      | CI runs the adapter contract suite against the committed recordings through an injected transport with no ….  | [F-014 v3](../features/F-014-production-kdrive-adapter.md) | Active                                    |
| [BR-215](BR-215.md) | v2      | `make kdrive-acceptance` runs on an actual main checkout inside the dev Compose service with at most 400 ….   | [F-014 v2](../features/F-014-production-kdrive-adapter.md) | Active                                    |
| [BR-216](BR-216.md) | v2      | The API origin, the storage-host suffix, port 443 and the BR-191 address policy are constants of ….           | [F-014 v2](../features/F-014-production-kdrive-adapter.md) | Accepted; superseded by v3                |
| [BR-217](BR-217.md) | v2      | When an upstream response has status 401 or 403, the adapter reports it to the composition, which emits at …. | [F-014 v2](../features/F-014-production-kdrive-adapter.md) | Active                                    |
| [BR-016](BR-016.md) | v2      | Ordinary invocation runs production preflight and the selected runtime.                                       | [F-014 v1](../features/F-014-production-kdrive-adapter.md) | Active                                    |
| [BR-028](BR-028.md) | v2      | Separate configuration types; synthetic credentials in tests; real token only in owner-run targets.           | [F-014 v1](../features/F-014-production-kdrive-adapter.md) | Active                                    |
| [BR-071](BR-071.md) | v2      | The packaged CLI composes `startStdioNavigation` with the production adapter.                                 | [F-014 v1](../features/F-014-production-kdrive-adapter.md) | Active                                    |
| [BR-123](BR-123.md) | v2      | The production composition always supplies the content port.                                                  | [F-014 v1](../features/F-014-production-kdrive-adapter.md) | Active                                    |
| [BR-175](BR-175.md) | v2      | The runtime image under `--network none` prints the exact preflight failure line.                             | [F-014 v1](../features/F-014-production-kdrive-adapter.md) | Active                                    |

## Accepted — mutation audit gate

F-016 v1 (#17, frozen 2026-11-09 at `c547802`) allocates BR-234–BR-259 v1 and
versions BR-069 and BR-070 to v2. All were accepted on actual main
005b9ba8e5b4115c5b14844e3fc23b7ea8079242 on 2026-11-10 (evidence (private archive)); BR-069 v2 and
BR-070 v2 replace the v1 statements listed above.

| ID                  | Version | Rule                                                                                                                     | Source                                               | Status                                    |
| ------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ----------------------------------------- |
| [BR-234](BR-234.md) | v1      | One JSON object plus LF per record, exact schema members.                                                                | [F-016 v1](../features/F-016-mutation-audit-gate.md) | Active                                    |
| [BR-235](BR-235.md) | v1      | No names, paths, queries, domains, content, secrets, URLs, provider text or exception text.                              | [F-016 v1](../features/F-016-mutation-audit-gate.md) | Active                                    |
| [BR-236](BR-236.md) | v1      | Escaped printable-ASCII line of at most 8,192 bytes; identity bounds refused at admission.                               | [F-016 v1](../features/F-016-mutation-audit-gate.md) | Active                                    |
| [BR-237](BR-237.md) | v1      | Identity `stdio`, verified `oauth` (iss, sub) or `insecure`; none refused.                                               | [F-016 v1](../features/F-016-mutation-audit-gate.md) | Active                                    |
| [BR-238](BR-238.md) | v1      | Records on fd 2 or the configured file; sink opened only in write/share modes.                                           | [F-016 v1](../features/F-016-mutation-audit-gate.md) | Active                                    |
| [BR-239](BR-239.md) | v1      | File sink `O_APPEND`/`O_NOFOLLOW`, mode 0600, owner and 0o077 checks.                                                    | [F-016 v1](../features/F-016-mutation-audit-gate.md) | Active                                    |
| [BR-240](BR-240.md) | v1      | Append resolves after one full write plus `fdatasync` or the stderr callback.                                            | [F-016 v1](../features/F-016-mutation-audit-gate.md) | Active; v2 active since F-039 (see below) |
| [BR-241](BR-241.md) | v1      | Any write failure latches the sink for the process lifetime.                                                             | [F-016 v1](../features/F-016-mutation-audit-gate.md) | Active; v2 active since F-039 (see below) |
| [BR-242](BR-242.md) | v1      | Appends serialized in call order, single write of at most 8,192 bytes.                                                   | [F-016 v1](../features/F-016-mutation-audit-gate.md) | Active                                    |
| [BR-243](BR-243.md) | v1      | Durable intent before the first attempt; outcome after classification; shared `op`.                                      | [F-016 v1](../features/F-016-mutation-audit-gate.md) | Active                                    |
| [BR-244](BR-244.md) | v1      | Failed intent append: zero attempts, `AUDIT_UNAVAILABLE`.                                                                | [F-016 v1](../features/F-016-mutation-audit-gate.md) | Active                                    |
| [BR-245](BR-245.md) | v1      | Admission refusals with zero records, zero policy calls, zero attempts.                                                  | [F-016 v1](../features/F-016-mutation-audit-gate.md) | Active                                    |
| [BR-246](BR-246.md) | v1      | Decision by the shared guarded facade; denial records one `denied` record.                                               | [F-016 v1](../features/F-016-mutation-audit-gate.md) | Active                                    |
| [BR-247](BR-247.md) | v1      | Attempt classification table; unknown or malformed results are `uncertain`.                                              | [F-016 v1](../features/F-016-mutation-audit-gate.md) | Active                                    |
| [BR-248](BR-248.md) | v1      | Only 429 is retried, at most 3 attempts, bounded `Retry-After`.                                                          | [F-016 v1](../features/F-016-mutation-audit-gate.md) | Active; v2 active since F-037 (see below) |
| [BR-249](BR-249.md) | v1      | 60 s run deadline; each attempt aborted after min(30 s, time left).                                                      | [F-016 v1](../features/F-016-mutation-audit-gate.md) | Active; v2 active since F-037 (see below) |
| [BR-250](BR-250.md) | v1      | Cancellation rules before and after the intent append.                                                                   | [F-016 v1](../features/F-016-mutation-audit-gate.md) | Active; v2 active since F-037 (see below) |
| [BR-251](BR-251.md) | v1      | `uncertain` ends the run with `UPSTREAM_UNCERTAIN` and the fixed message.                                                | [F-016 v1](../features/F-016-mutation-audit-gate.md) | Active                                    |
| [BR-252](BR-252.md) | v1      | Outcome append failure keeps the real classification with `audit:"outcome_unrecorded"`.                                  | [F-016 v1](../features/F-016-mutation-audit-gate.md) | Active                                    |
| [BR-253](BR-253.md) | v1      | A crash between intent and outcome leaves the intent as the last record of its `op`.                                     | [F-016 v1](../features/F-016-mutation-audit-gate.md) | Active                                    |
| [BR-254](BR-254.md) | v1      | Gate close drains in-flight runs; shutdown order transport, gate, exit.                                                  | [F-016 v1](../features/F-016-mutation-audit-gate.md) | Active; v2 active since F-039 (see below) |
| [BR-255](BR-255.md) | v1      | Gate result members are a closed set.                                                                                    | [F-016 v1](../features/F-016-mutation-audit-gate.md) | Active                                    |
| [BR-256](BR-256.md) | v1      | Policy `execute` bound to the gate executor; production evidence and cap for decisions.                                  | [F-016 v1](../features/F-016-mutation-audit-gate.md) | Active                                    |
| [BR-257](BR-257.md) | v1      | Received-share mutation reloads `shared_with_me` and is denied.                                                          | [F-016 v1](../features/F-016-mutation-audit-gate.md) | Active                                    |
| [BR-258](BR-258.md) | v1      | `mutate` entry point; navigation bounds stop at the intent append.                                                       | [F-016 v1](../features/F-016-mutation-audit-gate.md) | Active; v2 active since F-026 (see below) |
| [BR-259](BR-259.md) | v1      | File append bounded at 5,000 ms; a late intent gives zero attempts.                                                      | [F-016 v1](../features/F-016-mutation-audit-gate.md) | Active; v2 active since F-039 (see below) |
| [BR-069](BR-069.md) | v2      | Stdio stdout carries only MCP frames; stderr carries fixed diagnostics and, with `auditLog=stderr`, F-016 audit records. | [F-016 v1](../features/F-016-mutation-audit-gate.md) | Active                                    |
| [BR-070](BR-070.md) | v2      | Invocation bounds, except a gate run past its intent append, which F-016 bounds.                                         | [F-016 v1](../features/F-016-mutation-audit-gate.md) | Active; v3 active since F-026 (see below) |

## Accepted — controlled tree mutations

F-017 v1 (#18, frozen 2026-11-10 at `e6e96e5`) allocates BR-260–BR-278 v1 and
versions BR-039 to v2, BR-060 to v5, BR-190 to v2 and BR-200 to v2. All were
accepted on actual main `4b59c52` on 2026-11-10
(acceptance (private archive)); the new versions are active.

| ID                  | Version | Rule                                                                                                                                     | Source                                                                                              | Status                                    |
| ------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| [BR-260](BR-260.md) | v3      | Strict arguments of the five write tools; NFC, well-formed `name` (create, rename); Tool-table operation; `INVALID_ARGUMENTS` otherwise. | [F-017 v1](../features/F-017-controlled-tree-mutations.md), [F-018 v3](../features/F-018-upload.md) | Active (v3, F-018 v3, #100)               |
| [BR-261](BR-261.md) | v1      | Write annotations; `destructiveHint` true for `kdrive_trash` only.                                                                       | [F-017 v1](../features/F-017-controlled-tree-mutations.md)                                          | Active                                    |
| [BR-262](BR-262.md) | v1      | One `mutate` call; one text item with the gate result JSON; `isError` unless `succeeded`.                                                | [F-017 v1](../features/F-017-controlled-tree-mutations.md)                                          | Active                                    |
| [BR-263](BR-263.md) | v2      | Fixed description sentences and the uncertain-result sentence.                                                                           | [F-017 v1](../features/F-017-controlled-tree-mutations.md), [F-018 v2](../features/F-018-upload.md) | Active (v2, F-018 v2, #91)                |
| [BR-264](BR-264.md) | v1      | Original-trash evidence from trash metadata plus the live former parent.                                                                 | [F-017 v1](../features/F-017-controlled-tree-mutations.md)                                          | Active                                    |
| [BR-265](BR-265.md) | v1      | `missing`/`incomplete` trash evidence cases.                                                                                             | [F-017 v1](../features/F-017-controlled-tree-mutations.md)                                          | Active                                    |
| [BR-266](BR-266.md) | v1      | New TLS connection per mutation; `Connection: close`; explicit `Content-Length`; no redirect.                                            | [F-017 v1](../features/F-017-controlled-tree-mutations.md)                                          | Active                                    |
| [BR-267](BR-267.md) | v1      | `NotSent` before the TLS handshake, `MUTATION_UNKNOWN` after it.                                                                         | [F-017 v1](../features/F-017-controlled-tree-mutations.md)                                          | Active                                    |
| [BR-268](BR-268.md) | v1      | Raw port result; the mutator alone validates a complete 2xx body.                                                                        | [F-017 v1](../features/F-017-controlled-tree-mutations.md)                                          | Accepted; superseded by v3                |
| [BR-269](BR-269.md) | v1      | No adapter deadline; the gate attempt abort destroys the socket.                                                                         | [F-017 v1](../features/F-017-controlled-tree-mutations.md)                                          | Active                                    |
| [BR-270](BR-270.md) | v1      | No permanent deletion and no `DELETE` on a `/trash` path.                                                                                | [F-017 v1](../features/F-017-controlled-tree-mutations.md)                                          | Active                                    |
| [BR-271](BR-271.md) | v1      | One request per attempt on the kind's route; no read-back.                                                                               | [F-017 v1](../features/F-017-controlled-tree-mutations.md)                                          | Active                                    |
| [BR-272](BR-272.md) | v1      | Folder-create check; `created` and `value` with the new ID.                                                                              | [F-017 v1](../features/F-017-controlled-tree-mutations.md)                                          | Active                                    |
| [BR-273](BR-273.md) | v1      | Cancellable-action check; `cancel_id` never exposed.                                                                                     | [F-017 v1](../features/F-017-controlled-tree-mutations.md)                                          | Active                                    |
| [BR-274](BR-274.md) | v1      | Production registers exactly the five mutators.                                                                                          | [F-017 v1](../features/F-017-controlled-tree-mutations.md)                                          | Active                                    |
| [BR-275](BR-275.md) | v1      | Single-drive move; different evidence drives are denied.                                                                                 | [F-017 v1](../features/F-017-controlled-tree-mutations.md)                                          | Active                                    |
| [BR-276](BR-276.md) | v1      | Owner-run `make kdrive-write-acceptance` with a sanitized summary.                                                                       | [F-017 v1](../features/F-017-controlled-tree-mutations.md)                                          | Active                                    |
| [BR-277](BR-277.md) | v1      | README and `SECURITY.md` write-tool limits and residual risks R-17-1, R-17-2.                                                            | [F-017 v1](../features/F-017-controlled-tree-mutations.md)                                          | Active; v2 active since F-041 (see below) |
| [BR-278](BR-278.md) | v1      | Configured roots are never trashed, renamed or moved.                                                                                    | [F-017 v1](../features/F-017-controlled-tree-mutations.md)                                          | Active; v2 active since F-041 (see below) |
| [BR-039](BR-039.md) | v2      | Restore carries only `target`; destination derived from the evidence's immediate parent.                                                 | [F-017 v1](../features/F-017-controlled-tree-mutations.md)                                          | Active                                    |
| [BR-060](BR-060.md) | v5      | `write`/`share` add the five mutation tools.                                                                                             | [F-017 v1](../features/F-017-controlled-tree-mutations.md)                                          | Active                                    |
| [BR-190](BR-190.md) | v2      | Trash-metadata `GET` and `POST`/`DELETE` on the five mutation routes.                                                                    | [F-017 v1](../features/F-017-controlled-tree-mutations.md)                                          | Active                                    |
| [BR-200](BR-200.md) | v2      | Trashed-tree `children` and adapter `execute` stay unavailable.                                                                          | [F-017 v1](../features/F-017-controlled-tree-mutations.md)                                          | Active                                    |

## Accepted — upload

F-018 v1 (#19, frozen 2026-11-10 at `0c9a542`) allocates BR-279–BR-289 v1 and
versions BR-035 to v2, BR-060 to v6, BR-190 to v3, BR-266 to v2 and BR-274 to
v2. All were accepted on actual main `0f1852c` on 2026-11-10
(acceptance (private archive)); the new versions are active.

| ID                  | Version | Rule                                                                                | Source                                  | Status                     |
| ------------------- | ------- | ----------------------------------------------------------------------------------- | --------------------------------------- | -------------------------- |
| [BR-279](BR-279.md) | v2      | Strict `kdrive_upload` arguments; NFC `name`; `file_id` only with `overwrite:true`. | [F-018 v2](../features/F-018-upload.md) | Active (v2, F-018 v2, #91) |
| [BR-280](BR-280.md) | v1      | UTF-8 `text` or canonical `base64`; at most 524,288 bytes; refusal order.           | [F-018 v1](../features/F-018-upload.md) | Active                     |
| [BR-281](BR-281.md) | v1      | One `mutate` call with the upload or replace operation; gate result envelope.       | [F-018 v1](../features/F-018-upload.md) | Active                     |
| [BR-282](BR-282.md) | v1      | Upload annotations; `destructiveHint` true.                                         | [F-018 v1](../features/F-018-upload.md) | Active                     |
| [BR-283](BR-283.md) | v2      | Fixed upload description sentences and the Overwrite sentence.                      | [F-018 v2](../features/F-018-upload.md) | Active (v2, F-018 v2, #91) |
| [BR-284](BR-284.md) | v1      | `conflict=error` for upload-new, `conflict=version` for replace, nothing else.      | [F-018 v1](../features/F-018-upload.md) | Active                     |
| [BR-285](BR-285.md) | v1      | Upload-new response check incl. `parent_id`; `created` and `value`.                 | [F-018 v1](../features/F-018-upload.md) | Active                     |
| [BR-286](BR-286.md) | v1      | Replace response check; another `id` or `parent_id` is `uncertain`.                 | [F-018 v1](../features/F-018-upload.md) | Active                     |
| [BR-287](BR-287.md) | v2      | Owner-run `make kdrive-upload-acceptance` with a sanitized summary.                 | [F-018 v2](../features/F-018-upload.md) | Active (v2, F-018 v2, #91) |
| [BR-288](BR-288.md) | v2      | README and `SECURITY.md` upload limits and residual risks R-18-1–R-18-5.            | [F-018 v2](../features/F-018-upload.md) | Active (v2, F-018 v2, #91) |
| [BR-289](BR-289.md) | v1      | No automatic attempt after an `uncertain` upload.                                   | [F-018 v1](../features/F-018-upload.md) | Active                     |
| [BR-035](BR-035.md) | v2      | `replace` carries `destination` and `name` bound to the target.                     | [F-018 v1](../features/F-018-upload.md) | Active                     |
| [BR-060](BR-060.md) | v6      | `write`/`share` add `kdrive_upload`.                                                | [F-018 v1](../features/F-018-upload.md) | Active                     |
| [BR-190](BR-190.md) | v3      | `POST` on the upload route.                                                         | [F-018 v1](../features/F-018-upload.md) | Active                     |
| [BR-266](BR-266.md) | v2      | Upload payload as `application/octet-stream`.                                       | [F-018 v1](../features/F-018-upload.md) | Active                     |
| [BR-274](BR-274.md) | v2      | Production registers seven mutators.                                                | [F-018 v1](../features/F-018-upload.md) | Active                     |

## Accepted — persistent OAuth proxy state

F-019 v1 (#103) allocates BR-290 and BR-292–BR-314 v1 and
versions BR-023 to v2, BR-024 to v3, BR-124, BR-128, BR-139, BR-140, BR-142,
BR-143, BR-152 and BR-169 to v2. BR-291 and BR-305–BR-311 were reserved for #109
(client ID metadata documents); F-028 (#3) now allocates them (see below).
All were accepted on actual main `68209fe` on 2026-11-11
(evidence (archive issue 103));
for the versioned rules the new version is the active rule. The owner-run
real-client restart check has not been run.

| ID                  | Version | Rule                                                                               | Source                                                  | Status                                    |
| ------------------- | ------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------- |
| [BR-290](BR-290.md) | v1      | The `oauthStateFile` setting: bounds, proxy-only, no collision with the audit log. | [F-019 v1](../features/F-019-persistent-oauth-state.md) | Active                                    |
| [BR-292](BR-292.md) | v1      | Memory without the setting; clients and refresh families persisted with it.        | [F-019 v1](../features/F-019-persistent-oauth-state.md) | Active                                    |
| [BR-293](BR-293.md) | v1      | File and directory ownership, mode, symlink and link checks before use.            | [F-019 v1](../features/F-019-persistent-oauth-state.md) | Active                                    |
| [BR-294](BR-294.md) | v1      | Exclusive lock for a single instance; `OAUTH_STATE_LOCKED`.                        | [F-019 v1](../features/F-019-persistent-oauth-state.md) | Active                                    |
| [BR-295](BR-295.md) | v1      | Version 1 SQLite format and ordered open checks.                                   | [F-019 v1](../features/F-019-persistent-oauth-state.md) | Active; v2 active since F-028 (see below) |
| [BR-296](BR-296.md) | v1      | File bound to issuer, audience and upstream issuer.                                | [F-019 v1](../features/F-019-persistent-oauth-state.md) | Active                                    |
| [BR-297](BR-297.md) | v1      | Fixed startup refusal lines for the five `OAUTH_STATE_*` codes.                    | [F-019 v1](../features/F-019-persistent-oauth-state.md) | Active                                    |
| [BR-298](BR-298.md) | v1      | Durable commit before the response; journal and synchronous settings.              | [F-019 v1](../features/F-019-persistent-oauth-state.md) | Active; v2 active since F-028 (see below) |
| [BR-299](BR-299.md) | v1      | A failed write latches the store and answers 503.                                  | [F-019 v1](../features/F-019-persistent-oauth-state.md) | Active; v2 active since F-028 (see below) |
| [BR-300](BR-300.md) | v1      | No upstream token or reusable secret in the file.                                  | [F-019 v1](../features/F-019-persistent-oauth-state.md) | Active                                    |
| [BR-301](BR-301.md) | v1      | Identity re-check at refresh against the current allowlists.                       | [F-019 v1](../features/F-019-persistent-oauth-state.md) | Active                                    |
| [BR-302](BR-302.md) | v1      | Purge of expired state and disallowed clients.                                     | [F-019 v1](../features/F-019-persistent-oauth-state.md) | Active; v2 active since F-028 (see below) |
| [BR-303](BR-303.md) | v1      | Entry and file size bounds.                                                        | [F-019 v1](../features/F-019-persistent-oauth-state.md) | Active                                    |
| [BR-304](BR-304.md) | v1      | Single owner and one close of the store.                                           | [F-019 v1](../features/F-019-persistent-oauth-state.md) | Active                                    |
| [BR-312](BR-312.md) | v1      | `store_loaded` and `store_write_failed` events; no path or value in logs.          | [F-019 v1](../features/F-019-persistent-oauth-state.md) | Active                                    |
| [BR-313](BR-313.md) | v1      | `docs/oauth-proxy.md` states the persistent state and its risks.                   | [F-019 v1](../features/F-019-persistent-oauth-state.md) | Active                                    |
| [BR-314](BR-314.md) | v1      | `docs/deployment.md` and examples cover the state file.                            | [F-019 v1](../features/F-019-persistent-oauth-state.md) | Active                                    |
| [BR-023](BR-023.md) | v2      | Adds the 4,096-character bound of `oauthStateFile`.                                | [F-019 v1](../features/F-019-persistent-oauth-state.md) | Active; v3 active since F-028 (see below) |
| [BR-024](BR-024.md) | v3      | Adds `oauthStateFile` to the proxy-only settings.                                  | [F-019 v1](../features/F-019-persistent-oauth-state.md) | Active; v4 active since F-028 (see below) |
| [BR-124](BR-124.md) | v2      | `createOAuthProxy` takes an optional state-store port.                             | [F-019 v1](../features/F-019-persistent-oauth-state.md) | Active                                    |
| [BR-128](BR-128.md) | v2      | `redirect_uri` must also match the current allowlist.                              | [F-019 v1](../features/F-019-persistent-oauth-state.md) | Active; v3 active since F-028 (see below) |
| [BR-139](BR-139.md) | v2      | Refresh token `<family id>.<secret>`; one stored hash per family.                  | [F-019 v1](../features/F-019-persistent-oauth-state.md) | Active                                    |
| [BR-140](BR-140.md) | v2      | Family-ID based refresh checks; BR-301 after step (3).                             | [F-019 v1](../features/F-019-persistent-oauth-state.md) | Active                                    |
| [BR-142](BR-142.md) | v2      | State in memory only without `oauthStateFile`; purge and eviction persisted.       | [F-019 v1](../features/F-019-persistent-oauth-state.md) | Active; v3 active since F-032 (see below) |
| [BR-143](BR-143.md) | v2      | Event list adds the store events and the `clients`/`families` fields.              | [F-019 v1](../features/F-019-persistent-oauth-state.md) | Accepted; superseded by v5                |
| [BR-152](BR-152.md) | v2      | The handler opens the store before the proxy and any socket.                       | [F-019 v1](../features/F-019-persistent-oauth-state.md) | Active                                    |
| [BR-169](BR-169.md) | v2      | `close()` waits for the listener, then closes the store.                           | [F-019 v1](../features/F-019-persistent-oauth-state.md) | Accepted; superseded by v4                |

## Accepted — dependency audit

F-020 v1 (#104) allocates BR-315–BR-321 v1 and versions BR-015 to v6 and
BR-122, BR-225 and BR-227 to v2. All were accepted on actual main `b6acf86` on
2026-11-11 (evidence (archive issue 104)); for the versioned rules the new version is the
active rule.

| ID                  | Version | Rule                                                                | Source                                            | Status                                                                                                                 |
| ------------------- | ------- | ------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [BR-315](BR-315.md) | v1      | `package.json` overrides: Jimp `zod` to `$zod`, `minimatch` 11.0.8. | [F-020 v1](../features/F-020-dependency-audit.md) | Active; v2 active since F-027 (see below)                                                                              |
| [BR-316](BR-316.md) | v1      | Lockfile: one root `zod` >= 4.6.6, every `minimatch` >= 11.0.1.     | [F-020 v1](../features/F-020-dependency-audit.md) | Active                                                                                                                 |
| [BR-317](BR-317.md) | v1      | Jimp resolves the root Zod; image route and Zod errors unchanged.   | [F-020 v1](../features/F-020-dependency-audit.md) | Superseded by [BR-390](BR-390.md)                                                                                      |
| [BR-318](BR-318.md) | v1      | `skipLibCheck: true` only; locally typed `image.resize` options.    | [F-020 v1](../features/F-020-dependency-audit.md) | Active; v2 active since F-027 (see below)                                                                              |
| [BR-319](BR-319.md) | v1      | `make audit` runs `npm audit --audit-level=high`; not in `check`.   | [F-020 v1](../features/F-020-dependency-audit.md) | Active                                                                                                                 |
| [BR-320](BR-320.md) | v1      | CI `audit` job, needed by `ci-result`, not a Sonar gate.            | [F-020 v1](../features/F-020-dependency-audit.md) | Active; v3 active since F-027 (see below)                                                                              |
| [BR-321](BR-321.md) | v1      | Audit documentation: development, `SECURITY.md`, changelog.         | [F-020 v1](../features/F-020-dependency-audit.md) | Active; v3 active since [F-025 v1](../features/F-025-changelog-release-sections.md); v4 active since F-027 (see below) |
| [BR-015](BR-015.md) | v6      | Job set adds `audit`; `make audit` admitted only there.             | [F-020 v1](../features/F-020-dependency-audit.md) | Active                                                                                                                 |
| [BR-122](BR-122.md) | v2      | Jimp schemas run on the single root Zod 4.                          | [F-020 v1](../features/F-020-dependency-audit.md) | Active; v3 active since F-027 (see below)                                                                              |
| [BR-225](BR-225.md) | v2      | `audit` on the label array, `timeout-minutes` 20.                   | [F-020 v1](../features/F-020-dependency-audit.md) | Active                                                                                                                 |
| [BR-227](BR-227.md) | v2      | `audit` gated on `changes`; `ci-result` needs it.                   | [F-020 v1](../features/F-020-dependency-audit.md) | Active                                                                                                                 |

## Accepted — container health check

F-021 v1 (#105) allocates BR-322–BR-327 v1 and versions BR-154, BR-156,
BR-162, BR-167, BR-168, BR-180, BR-181 and BR-184 to v2 and BR-187 to v3. All
were accepted on actual main `e208996` on 2026-11-11 (evidence (archive issue 105)); for the
versioned rules the new version is the active rule.

| ID                  | Version | Rule                                                                         | Source                                                  | Status                                    |
| ------------------- | ------- | ---------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------- |
| [BR-322](BR-322.md) | v1      | `GET /healthz` in both modes; fixed check order; constant 200 body.          | [F-021 v1](../features/F-021-container-health-check.md) | Active                                    |
| [BR-323](BR-323.md) | v1      | `/healthz` ignores credentials, sessions and mode; no dependency call.       | [F-021 v1](../features/F-021-container-health-check.md) | Active                                    |
| [BR-324](BR-324.md) | v1      | Loopback `Host` forms accepted on `/healthz` only.                           | [F-021 v1](../features/F-021-container-health-check.md) | Active                                    |
| [BR-325](BR-325.md) | v1      | `health_loopback` and `health_public` windows, 120 per 60 s each.            | [F-021 v1](../features/F-021-container-health-check.md) | Active                                    |
| [BR-326](BR-326.md) | v1      | `dist/healthcheck.js` probe: `node:http` only, exit codes and failure codes. | [F-021 v1](../features/F-021-container-health-check.md) | Active                                    |
| [BR-327](BR-327.md) | v1      | Runtime `HEALTHCHECK` exec form, 10 s / 10 s / 30 s / 3.                     | [F-021 v1](../features/F-021-container-health-check.md) | Active                                    |
| [BR-154](BR-154.md) | v2      | Route table adds `/healthz` (GET).                                           | [F-021 v1](../features/F-021-container-health-check.md) | Active                                    |
| [BR-156](BR-156.md) | v2      | `Host` check except the BR-324 loopback allowance.                           | [F-021 v1](../features/F-021-container-health-check.md) | Active                                    |
| [BR-162](BR-162.md) | v2      | Process-wide windows add the two health windows.                             | [F-021 v1](../features/F-021-container-health-check.md) | Active; v3 active since F-035 (see below) |
| [BR-167](BR-167.md) | v2      | `request_refused` route may be `health`; no event for a 200.                 | [F-021 v1](../features/F-021-container-health-check.md) | Accepted; superseded by v4                |
| [BR-168](BR-168.md) | v2      | Insecure mode also serves `/healthz`.                                        | [F-021 v1](../features/F-021-container-health-check.md) | Active                                    |
| [BR-180](BR-180.md) | v2      | Smoke launch adds `--health-interval=2s`; a no-server probe container.       | [F-021 v1](../features/F-021-container-health-check.md) | Active                                    |
| [BR-181](BR-181.md) | v2      | Image-smoke checks (7)–(10) for the health check.                            | [F-021 v1](../features/F-021-container-health-check.md) | Active                                    |
| [BR-184](BR-184.md) | v2      | Compose: no `healthcheck` key; comment pointing to the docs.                 | [F-021 v1](../features/F-021-container-health-check.md) | Active; v4 active since F-046 (see below) |
| [BR-187](BR-187.md) | v3      | Deployment doc: Health check section; step 7 waits for `healthy`.            | [F-021 v1](../features/F-021-container-health-check.md) | Active; v4 active since F-046 (see below) |

## Accepted — Quality Gate failure summary

F-022 v2 (#114) allocates BR-328–BR-340 (BR-335 v2) and versions BR-146 to
v2. All were accepted on actual main `e7d6367` on 2026-11-12 (evidence (archive issue 114));
for BR-146 the new version is the active rule.

| ID                  | Version | Rule                                                                       | Source                                              | Status |
| ------------------- | ------- | -------------------------------------------------------------------------- | --------------------------------------------------- | ------ |
| [BR-328](BR-328.md) | v1      | Summary only on a nonzero scanner exit within the deadline.                | [F-022 v1](../features/F-022-sonar-gate-summary.md) | Active |
| [BR-329](BR-329.md) | v1      | Bounded `O_NOFOLLOW` read of verified task metadata, else one fixed line.  | [F-022 v1](../features/F-022-sonar-gate-summary.md) | Active |
| [BR-330](BR-330.md) | v1      | At most three ordered requests: task, conditions, issues.                  | [F-022 v1](../features/F-022-sonar-gate-summary.md) | Active |
| [BR-331](BR-331.md) | v1      | Relative fixed paths, `redirect: "error"`, Basic token only, 15 s each.    | [F-022 v1](../features/F-022-sonar-gate-summary.md) | Active |
| [BR-332](BR-332.md) | v1      | Streamed 1 MiB bodies, aborted stages, fixed stage failure lines.          | [F-022 v1](../features/F-022-sonar-gate-summary.md) | Active |
| [BR-333](BR-333.md) | v1      | 401/403 on issues prints the Browse permission line.                       | [F-022 v1](../features/F-022-sonar-gate-summary.md) | Active |
| [BR-334](BR-334.md) | v1      | Header and at most 20 `ERROR` condition lines.                             | [F-022 v1](../features/F-022-sonar-gate-summary.md) | Active |
| [BR-335](BR-335.md) | v2      | Issues only after an `ERROR`; quality filter, new code only for `new_*`.   | [F-022 v2](../features/F-022-sonar-gate-summary.md) | Active |
| [BR-336](BR-336.md) | v1      | Project-only issue lines, at most 20, with the omitted count.              | [F-022 v1](../features/F-022-sonar-gate-summary.md) | Active |
| [BR-337](BR-337.md) | v1      | Escape, redact, then truncate server fields on safe boundaries.            | [F-022 v1](../features/F-022-sonar-gate-summary.md) | Active |
| [BR-338](BR-338.md) | v1      | Own 60 s timer, internal-error line, scanner exit code returned.           | [F-022 v1](../features/F-022-sonar-gate-summary.md) | Active |
| [BR-339](BR-339.md) | v1      | No change to `ci.yml` or `compose.yaml`.                                   | [F-022 v1](../features/F-022-sonar-gate-summary.md) | Active |
| [BR-340](BR-340.md) | v1      | Development docs: formats, degraded line, upgrade path.                    | [F-022 v1](../features/F-022-sonar-gate-summary.md) | Active |
| [BR-146](BR-146.md) | v2      | Summary lines pass through `redact`; fixed messages name no host or token. | [F-022 v1](../features/F-022-sonar-gate-summary.md) | Active |

## Accepted — hosted CI and privacy scan

F-023 v1 (#1) allocates BR-341–BR-352 v1 and versions BR-015 to v7, BR-149,
BR-183, BR-225 and BR-227 to v3, and BR-229 and BR-320 to v2. All were accepted
on actual main `ad25fa2` on 2026-11-12 (#1 comment `1-acceptance-1-orchestrator`);
for each versioned rule the new version is the active rule.

| ID                  | Version | Rule                                                                 | Source                                                  | Status                                    |
| ------------------- | ------- | -------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------- |
| [BR-341](BR-341.md) | v1      | CI `privacy-scan` job: hosted, read-only, 20 min, three exact steps. | [F-023 v1](../features/F-023-hosted-ci-privacy-scan.md) | Active                                    |
| [BR-342](BR-342.md) | v1      | Deny secret only in the scan step; passed by name; never printed.    | [F-023 v1](../features/F-023-hosted-ci-privacy-scan.md) | Active                                    |
| [BR-343](BR-343.md) | v1      | Secret format: lines, `#` comments, `giu` regexes, physical numbers. | [F-023 v1](../features/F-023-hosted-ci-privacy-scan.md) | Active                                    |
| [BR-344](BR-344.md) | v1      | Exit 2 with a fixed message on a missing secret or invalid regex.    | [F-023 v1](../features/F-023-hosted-ci-privacy-scan.md) | Active                                    |
| [BR-345](BR-345.md) | v1      | Tracked entries from the object database; decoders and views.        | [F-023 v1](../features/F-023-hosted-ci-privacy-scan.md) | Active                                    |
| [BR-346](BR-346.md) | v1      | Commit range or full history: messages, identities, changed blobs.   | [F-023 v1](../features/F-023-hosted-ci-privacy-scan.md) | Active                                    |
| [BR-347](BR-347.md) | v1      | PR title and body scanned only on `pull_request`.                    | [F-023 v1](../features/F-023-hosted-ci-privacy-scan.md) | Active                                    |
| [BR-348](BR-348.md) | v1      | Hit lines: location and pattern number only; `file #k` paths.        | [F-023 v1](../features/F-023-hosted-ci-privacy-scan.md) | Active                                    |
| [BR-349](BR-349.md) | v1      | Summary line, exit 0/1, one fixed internal-error line, exit 2.       | [F-023 v1](../features/F-023-hosted-ci-privacy-scan.md) | Active                                    |
| [BR-350](BR-350.md) | v1      | Fork PR notice step, exit 0.                                         | [F-023 v1](../features/F-023-hosted-ci-privacy-scan.md) | Active                                    |
| [BR-351](BR-351.md) | v1      | Runner guide: safe only privately, never attached here.              | [F-023 v1](../features/F-023-hosted-ci-privacy-scan.md) | Active                                    |
| [BR-352](BR-352.md) | v1      | Node built-ins only; `make privacy-scan` without `make setup`.       | [F-023 v1](../features/F-023-hosted-ci-privacy-scan.md) | Active                                    |
| [BR-015](BR-015.md) | v7      | Job set adds `privacy-scan`; hosted runners; deny secret placement.  | [F-023 v1](../features/F-023-hosted-ci-privacy-scan.md) | Active                                    |
| [BR-149](BR-149.md) | v3      | `sonar-pr` on `ubuntu-24.04`.                                        | [F-023 v1](../features/F-023-hosted-ci-privacy-scan.md) | Active                                    |
| [BR-183](BR-183.md) | v3      | `image` on `ubuntu-24.04`.                                           | [F-023 v1](../features/F-023-hosted-ci-privacy-scan.md) | Active                                    |
| [BR-225](BR-225.md) | v3      | Every `ci.yml` job on `ubuntu-24.04`; `privacy-scan` 20.             | [F-023 v1](../features/F-023-hosted-ci-privacy-scan.md) | Active                                    |
| [BR-227](BR-227.md) | v3      | `ci-result` needs `privacy-scan` and fails unless it succeeded.      | [F-023 v1](../features/F-023-hosted-ci-privacy-scan.md) | Active                                    |
| [BR-229](BR-229.md) | v2      | Runner acceptance guarded off this repository.                       | [F-023 v1](../features/F-023-hosted-ci-privacy-scan.md) | Active                                    |
| [BR-320](BR-320.md) | v2      | `audit` on `ubuntu-24.04`.                                           | [F-023 v1](../features/F-023-hosted-ci-privacy-scan.md) | Active; v3 active since F-027 (see below) |

## Accepted rules — stable release lifecycle

F-024 v4 (#91) versions BR-354, BR-363, BR-372 and BR-373 to v3 and
allocates BR-431–BR-433 v1. All seven rules are active after acceptance on
main `d30b3ff` on 2026-11-18 ([#91 acceptance](https://github.com/sstolz/kdrive-mcp-server/issues/91#issuecomment-6992434783)).
F-024 v4 is done; counts above classify records by their latest version
status. No release go is granted.

F-024 v3 (#89) versions BR-354, BR-356–BR-359, BR-363, BR-368–BR-370,
BR-372, BR-373 and BR-375 to v2. These rules are active after acceptance on
main `6a508ab` on 2026-11-17 (#89 comments `89-acceptance-1-claude` and
`89-acceptance-2-owner`). F-024 v3 is done: AC-35 passed on 2026-11-17
(release run 44054183190,
[#89 comment `89-acceptance-3-claude`](https://github.com/sstolz/kdrive-mcp-server/issues/89#issuecomment-6945807239));
`1.0.0` is published on npm `latest` and GHCR `1.0.0`/`latest` at OCI index
`sha256:6f14301d4e9b0c4cd7c2f39b45f15c9b1222e92879ee10ea1131d06dac806708`.

## Accepted — gated beta publication

F-024 v2 (#2) allocates BR-353–BR-375, BR-378 and BR-379 v1 and versions
BR-016 and BR-178 to v3. All were accepted on actual main `163e701` on
2026-11-13 (#2 comments `2-acceptance-1-orchestrator` and
`2-acceptance-2-orchestrator`); for BR-016 and BR-178 the new version is the
active rule. BR-376 and BR-377 (the
production shrinkwrap of F-024 v1) and the BR-321 v2 of F-024 v1 were
withdrawn in F-024 v2: they were never accepted, have no record, and BR-376
and BR-377 are never reused; BR-321 v2 is never reused. [F-025 v1](../features/F-025-changelog-release-sections.md) versions BR-321
to v3, accepted on actual main `e857db3` on 2026-11-13; v3 is the active rule.

| ID                  | Version | Rule                                                                           | Source                                             | Status      |
| ------------------- | ------- | ------------------------------------------------------------------------------ | -------------------------------------------------- | ----------- |
| [BR-353](BR-353.md) | v1      | Scoped lockfile names; `make pack` writes one scoped tarball.                  | [F-024 v2](../features/F-024-gated-publication.md) | Active      |
| [BR-354](BR-354.md) | v3      | Stable/beta lifecycle guide, recovery and version-dependent installs.          | [F-024 v4](../features/F-024-gated-publication.md) | Active (v3) |
| [BR-355](BR-355.md) | v1      | `release.yml`: dispatch-only, three inputs, `{}` permissions, four jobs.       | [F-024 v2](../features/F-024-gated-publication.md) | Active      |
| [BR-356](BR-356.md) | v2      | Image digest job output and read-back dependency; existing gates retained.     | [F-024 v3](../features/F-024-gated-publication.md) | Active (v2) |
| [BR-357](BR-357.md) | v2      | Exact release step order with release-image and release-npm IDs.               | [F-024 v3](../features/F-024-gated-publication.md) | Active (v2) |
| [BR-358](BR-358.md) | v2      | Closed workflow sets with phase-specific image digest forwarding.              | [F-024 v3](../features/F-024-gated-publication.md) | Active (v2) |
| [BR-359](BR-359.md) | v2      | Stable/beta validation and phase-specific image digest inputs.                 | [F-024 v3](../features/F-024-gated-publication.md) | Active (v2) |
| [BR-360](BR-360.md) | v1      | Release commit: `VERSION`, `package.json` and lockfile versions.               | [F-024 v2](../features/F-024-gated-publication.md) | Active      |
| [BR-361](BR-361.md) | v1      | Tag on the commit, commit on `main`, `GITHUB_SHA` equals the sha.              | [F-024 v2](../features/F-024-gated-publication.md) | Active      |
| [BR-362](BR-362.md) | v1      | Green `ci-result` on a `main` push or dispatch run of the sha.                 | [F-024 v2](../features/F-024-gated-publication.md) | Active      |
| [BR-363](BR-363.md) | v3      | Union-history ordering, validated npm defaults and phase-specific GHCR checks. | [F-024 v4](../features/F-024-gated-publication.md) | Active (v3) |
| [BR-364](BR-364.md) | v1      | Checks only read and all run after input validation.                           | [F-024 v2](../features/F-024-gated-publication.md) | Active      |
| [BR-365](BR-365.md) | v1      | One line per check and a summary; no token or body in output.                  | [F-024 v2](../features/F-024-gated-publication.md) | Active      |
| [BR-366](BR-366.md) | v1      | One internal-error line on stderr and exit 2.                                  | [F-024 v2](../features/F-024-gated-publication.md) | Active      |
| [BR-367](BR-367.md) | v1      | Endpoint overrides for doubles; refused in CI with exit 2.                     | [F-024 v2](../features/F-024-gated-publication.md) | Active      |
| [BR-368](BR-368.md) | v2      | Beta version tag; stable npm latest and both image tags.                       | [F-024 v3](../features/F-024-gated-publication.md) | Active (v2) |
| [BR-369](BR-369.md) | v2      | Checked tarball and OIDC-only exact npm argv with kind-specific tag.           | [F-024 v3](../features/F-024-gated-publication.md) | Active (v2) |
| [BR-370](BR-370.md) | v2      | Two-platform build, stable tags and validated buildx digest output.            | [F-024 v3](../features/F-024-gated-publication.md) | Active (v2) |
| [BR-371](BR-371.md) | v1      | `publish-npm` needs `publish-image`.                                           | [F-024 v2](../features/F-024-gated-publication.md) | Active      |
| [BR-372](BR-372.md) | v3      | Kind-specific npm read-back, provenance and verified tarball.                  | [F-024 v4](../features/F-024-gated-publication.md) | Active (v3) |
| [BR-373](BR-373.md) | v3      | Stable run digest on both tags; beta checks against the stable default.        | [F-024 v4](../features/F-024-gated-publication.md) | Active (v3) |
| [BR-374](BR-374.md) | v1      | `ci.yml` and `runner-acceptance.yml` unchanged.                                | [F-024 v2](../features/F-024-gated-publication.md) | Active      |
| [BR-375](BR-375.md) | v2      | Release target digest forwarding and image GITHUB_OUTPUT.                      | [F-024 v3](../features/F-024-gated-publication.md) | Active (v2) |
| [BR-378](BR-378.md) | v1      | `release` environment requires a reviewer and admits only `main`.              | [F-024 v2](../features/F-024-gated-publication.md) | Active      |
| [BR-379](BR-379.md) | v1      | Published npm tarball digest equals the `verify` digest.                       | [F-024 v2](../features/F-024-gated-publication.md) | Active      |
| [BR-431](BR-431.md) | v1      | Beta candidate ordering.                                                       | [F-024 v4](../features/F-024-gated-publication.md) | Active (v1) |
| [BR-432](BR-432.md) | v1      | Deprecated stable default recovery.                                            | [F-024 v4](../features/F-024-gated-publication.md) | Active (v1) |
| [BR-433](BR-433.md) | v1      | Restore the prior stable image before cleanup.                                 | [F-024 v4](../features/F-024-gated-publication.md) | Active (v1) |
| [BR-016](BR-016.md) | v3      | Scoped package name; command, server-info name and User-Agent unchanged.       | [F-024 v2](../features/F-024-gated-publication.md) | Active      |
| [BR-178](BR-178.md) | v3      | Publish markers admitted once in the release scripts only; adds `npm publish`. | [F-024 v2](../features/F-024-gated-publication.md) | Active      |

## Accepted — bounded invocation queue

[F-026 v1](../features/F-026-bounded-invocation-queue.md) (#16) allocates
BR-380–BR-388 v1 and versions BR-258 to v2, BR-070 to v3 and BR-118 to v2.
All were accepted on actual main `2d10e19` on 2026-11-13 ([evidence](https://github.com/sstolz/kdrive-mcp-server/issues/16#issuecomment-6863879656)).

| ID                  | Version | Rule                                                                          | Source                                                    | Status                                    |
| ------------------- | ------- | ----------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------- |
| [BR-380](BR-380.md) | v1      | One invocation per session; other calls join a per-session FIFO wait queue.   | [F-026 v1](../features/F-026-bounded-invocation-queue.md) | Active                                    |
| [BR-381](BR-381.md) | v1      | At most 4 waiting calls; a further call gets `SERVER_BUSY`, zero requests.    | [F-026 v1](../features/F-026-bounded-invocation-queue.md) | Active                                    |
| [BR-382](BR-382.md) | v1      | A call waits at most 12,000 ms, then `SERVER_BUSY`; tie with release defined. | [F-026 v1](../features/F-026-bounded-invocation-queue.md) | Active                                    |
| [BR-383](BR-383.md) | v1      | Synchronous FIFO hand-off at release; taker re-checks close and abort.        | [F-026 v1](../features/F-026-bounded-invocation-queue.md) | Active                                    |
| [BR-384](BR-384.md) | v1      | Deadline, budgets and output bounds start when the slot is taken.             | [F-026 v1](../features/F-026-bounded-invocation-queue.md) | Active; v2 active since F-038 (see below) |
| [BR-385](BR-385.md) | v1      | Abort while waiting: `ACCESS_DENIED`, zero requests, listeners removed.       | [F-026 v1](../features/F-026-bounded-invocation-queue.md) | Active                                    |
| [BR-386](BR-386.md) | v1      | Close while waiting: every waiter `ACCESS_DENIED` at once.                    | [F-026 v1](../features/F-026-bounded-invocation-queue.md) | Active                                    |
| [BR-387](BR-387.md) | v1      | README and client docs describe the queue and retryable `SERVER_BUSY`.        | [F-026 v1](../features/F-026-bounded-invocation-queue.md) | Active; v2 active since F-043 (see below) |
| [BR-388](BR-388.md) | v1      | Stdio outbound FIFO of 6 waiting frames; overflow closes; 1,000 ms per frame. | [F-026 v1](../features/F-026-bounded-invocation-queue.md) | Active                                    |
| [BR-258](BR-258.md) | v2      | `mutate` waits in the shared queue instead of refusing at once.               | [F-026 v1](../features/F-026-bounded-invocation-queue.md) | Active                                    |
| [BR-070](BR-070.md) | v3      | A second stdio outbound frame waits (BR-388) instead of closing.              | [F-026 v1](../features/F-026-bounded-invocation-queue.md) | Active; v4 active since F-038 (see below) |
| [BR-118](BR-118.md) | v2      | Rule unchanged; the concurrent-call example now waits.                        | [F-026 v1](../features/F-026-bounded-invocation-queue.md) | Active; v3 active since F-040 (see below) |

## Accepted — direct image codecs

[F-027 v2](../features/F-027-direct-image-codecs.md) (#12) allocates
BR-389–BR-392 v1, versions BR-122 to v3, BR-315 to v2, BR-318 to v2, BR-320 to
v3 and BR-321 to v4, and supersedes BR-317 by BR-390. All were accepted on
actual main `75bd9bb` on 2026-11-14 (#12 comment `12-acceptance-1-orchestrator`).

| ID                  | Version | Rule                                                                            | Source                                               | Status                                    |
| ------------------- | ------- | ------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------- |
| [BR-389](BR-389.md) | v1      | No `@jimp/` package or import; `pngjs` 7.0.0 and `jpeg-js` 0.4.4 exact.         | [F-027 v2](../features/F-027-direct-image-codecs.md) | Active                                    |
| [BR-390](BR-390.md) | v1      | Direct codec calls with Jimp's options; codec errors propagate unchanged.       | [F-027 v2](../features/F-027-direct-image-codecs.md) | Active; supersedes BR-317                 |
| [BR-391](BR-391.md) | v1      | Local nearest-neighbour resize on the current bitmap; characterization digests. | [F-027 v2](../features/F-027-direct-image-codecs.md) | Active                                    |
| [BR-392](BR-392.md) | v1      | `make install-check`: install the packed tarball, no `zod` < 4.6.6, no Jimp.    | [F-027 v2](../features/F-027-direct-image-codecs.md) | Active; v2 active since F-034 (see below) |
| [BR-122](BR-122.md) | v3      | Jimp clauses removed; the image codecs declare no dependencies.                 | [F-027 v2](../features/F-027-direct-image-codecs.md) | Active                                    |
| [BR-315](BR-315.md) | v2      | `overrides` equal `{"minimatch": "11.0.8"}`.                                    | [F-027 v2](../features/F-027-direct-image-codecs.md) | Active                                    |
| [BR-318](BR-318.md) | v2      | No `skipLibCheck`; every third-party declaration checked.                       | [F-027 v2](../features/F-027-direct-image-codecs.md) | Active                                    |
| [BR-320](BR-320.md) | v3      | CI `audit` job adds a fourth step `make install-check`.                         | [F-027 v2](../features/F-027-direct-image-codecs.md) | Active                                    |
| [BR-321](BR-321.md) | v4      | Audit docs without Jimp; `SECURITY.md` #12 limit; #12 changelog lines.          | [F-027 v2](../features/F-027-direct-image-codecs.md) | Active                                    |
| [BR-317](BR-317.md) | v1      | Superseded by BR-390 on the acceptance of F-027.                                | [F-020 v1](../features/F-020-dependency-audit.md)    | Superseded by BR-390                      |

## Accepted — Client ID Metadata Documents

[F-028 v2](../features/F-028-client-id-metadata-documents.md) (#3) allocates
BR-291, BR-305–BR-311 and BR-393–BR-395 v1 and versions BR-023 to v3, BR-024 to
v4, BR-125 to v2, BR-128 to v3, BR-129 to v2, BR-136 to v2, BR-143 to v3,
BR-169 to v3, BR-295 to v2, BR-298 to v2, BR-299 to v2 and BR-302 to v2, with
[ADR-011](../architecture-decisions/ADR-011-oauth-state-format-v2-cimd.md)
(accepted). All were accepted on actual main `aa540d4` on 2026-11-14 (#3 comment
`3-acceptance-1-orchestrator`) and are active; for the versioned rules the new
version is the active rule. The owner-run claude.ai check is not done; #25
unblocked it (F-029 accepted on main `3428df5`).

| ID                  | Version | Rule                                                                            | Source                                                        | Status                                    |
| ------------------- | ------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------- |
| [BR-291](BR-291.md) | v1      | `oauthAllowedClientIdOrigins`: at most 16 `https` origins, proxy mode only.     | [F-028 v2](../features/F-028-client-id-metadata-documents.md) | Active                                    |
| [BR-305](BR-305.md) | v1      | Acceptable CIMD client ID: syntax, not a proxy identity, listed origin.         | [F-028 v2](../features/F-028-client-id-metadata-documents.md) | Active                                    |
| [BR-306](BR-306.md) | v1      | One pinned HTTPS GET after one c-ares resolution; 5,120 bytes, 5,000 ms.        | [F-028 v2](../features/F-028-client-id-metadata-documents.md) | Accepted; superseded by v3                |
| [BR-307](BR-307.md) | v1      | Address policy: blocked IPv4 ranges; IPv6 only inside `2000::/3`.               | [F-028 v2](../features/F-028-client-id-metadata-documents.md) | Active; v2 active since F-033 (see below) |
| [BR-308](BR-308.md) | v1      | Document validation, lenient filtering and the resolution snapshot.             | [F-028 v2](../features/F-028-client-id-metadata-documents.md) | Active                                    |
| [BR-309](BR-309.md) | v1      | Cache of 100 entries, 60–3,600 s, stale use, four fetches, cancellation.        | [F-028 v2](../features/F-028-client-id-metadata-documents.md) | Active; v2 active since F-033 (see below) |
| [BR-310](BR-310.md) | v1      | Token endpoint: method `none` only, decided before any lookup, no fetch.        | [F-028 v2](../features/F-028-client-id-metadata-documents.md) | Active                                    |
| [BR-311](BR-311.md) | v1      | CIMD families without a client row; content-dependent store version 2.          | [F-028 v2](../features/F-028-client-id-metadata-documents.md) | Active                                    |
| [BR-393](BR-393.md) | v1      | Consent page shows the client ID, its host and the loopback line.               | [F-028 v2](../features/F-028-client-id-metadata-documents.md) | Active; v3 active since F-031 (see below) |
| [BR-394](BR-394.md) | v1      | `client_metadata_refused` and `client_metadata_fetched`; one event per refusal. | [F-028 v2](../features/F-028-client-id-metadata-documents.md) | Accepted; superseded by v3                |
| [BR-395](BR-395.md) | v1      | Operator documentation and discovery procedure.                                 | [F-028 v2](../features/F-028-client-id-metadata-documents.md) | Active                                    |
| [BR-023](BR-023.md) | v3      | Adds the bounds of BR-291.                                                      | [F-028 v2](../features/F-028-client-id-metadata-documents.md) | Active; v4 active since F-035 (see below) |
| [BR-024](BR-024.md) | v4      | `oauthAllowedClientIdOrigins` is proxy-only; origin conflicts.                  | [F-028 v2](../features/F-028-client-id-metadata-documents.md) | Active; v5 active since F-035 (see below) |
| [BR-125](BR-125.md) | v2      | `client_id_metadata_document_supported` only with a nonempty list.              | [F-028 v2](../features/F-028-client-id-metadata-documents.md) | Active                                    |
| [BR-128](BR-128.md) | v3      | CIMD checks before any fetch; asynchronous handler; latch re-check.             | [F-028 v2](../features/F-028-client-id-metadata-documents.md) | Active                                    |
| [BR-129](BR-129.md) | v2      | Consent page content of BR-393 for CIMD clients.                                | [F-028 v2](../features/F-028-client-id-metadata-documents.md) | Active; v6 active since F-033 (see below) |
| [BR-136](BR-136.md) | v2      | A CIMD client ID is authenticated under BR-310.                                 | [F-028 v2](../features/F-028-client-id-metadata-documents.md) | Active                                    |
| [BR-143](BR-143.md) | v3      | Adds the BR-394 events and the `reason` field.                                  | [F-028 v2](../features/F-028-client-id-metadata-documents.md) | Accepted; superseded by v5                |
| [BR-169](BR-169.md) | v3      | `close()` step (2) cancels in-flight CIMD fetches.                              | [F-028 v2](../features/F-028-client-id-metadata-documents.md) | Accepted; superseded by v4                |
| [BR-295](BR-295.md) | v2      | Reads versions 1 and 2; row rules of the file's own version.                    | [F-028 v2](../features/F-028-client-id-metadata-documents.md) | Active                                    |
| [BR-298](BR-298.md) | v2      | Rows pass the rules of the version their transaction writes.                    | [F-028 v2](../features/F-028-client-id-metadata-documents.md) | Active                                    |
| [BR-299](BR-299.md) | v2      | A failed write breaks a rule of the version its transaction writes.             | [F-028 v2](../features/F-028-client-id-metadata-documents.md) | Active                                    |
| [BR-302](BR-302.md) | v2      | Startup purge of CIMD families not acceptable under BR-305.                     | [F-028 v2](../features/F-028-client-id-metadata-documents.md) | Active                                    |

## Accepted — acceptance launcher OAuth state

[F-029 v2](../features/F-029-acceptance-launcher-oauth-state.md) (#25)
allocates BR-396–BR-398 v1 and versions BR-171 to v3, all accepted on main
`3428df5` (#25 comment `25-acceptance-1-orchestrator`). The F-028 owner-run
claude.ai check is unblocked.

| ID                  | Version | Rule                                                                             | Source                                                           | Status |
| ------------------- | ------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------ |
| [BR-396](BR-396.md) | v1      | `acceptanceSettings`: the BR-171 settings plus `OAUTH_STATE_FILE`, used by main. | [F-029 v2](../features/F-029-acceptance-launcher-oauth-state.md) | Active |
| [BR-397](BR-397.md) | v1      | Private state directory guard; read-write mount at `/run/oauth-state`.           | [F-029 v2](../features/F-029-acceptance-launcher-oauth-state.md) | Active |
| [BR-398](BR-398.md) | v1      | Owner documentation of the state directory and the F-028 owner-run steps.        | [F-029 v2](../features/F-029-acceptance-launcher-oauth-state.md) | Active |
| [BR-171](BR-171.md) | v3      | Optional state directory mount; arguments exactly v2 without it.                 | [F-029 v2](../features/F-029-acceptance-launcher-oauth-state.md) | Active |

## Accepted — designed OAuth proxy pages

[F-030 v1](../features/F-030-oauth-proxy-page-design.md) (#23) allocates
BR-399–BR-403 v1 and versions BR-129 to v3 and BR-393 to v2, all accepted on
main `f747072` (#23 comment `23-acceptance-1-orchestrator`).

| ID                  | Version | Rule                                                                        | Source                                                   | Status                                    |
| ------------------- | ------- | --------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------- |
| [BR-399](BR-399.md) | v1      | One page shell: head, header mark and unofficial line, footer GitHub link.  | [F-030 v1](../features/F-030-oauth-proxy-page-design.md) | Active; v2 active since F-031 (see below) |
| [BR-400](BR-400.md) | v1      | One fixed light/dark stylesheet; token set, no external resource, contrast. | [F-030 v1](../features/F-030-oauth-proxy-page-design.md) | Active                                    |
| [BR-401](BR-401.md) | v1      | CSP `style-src` SHA-256 hash of the stylesheet; nothing else allowed.       | [F-030 v1](../features/F-030-oauth-proxy-page-design.md) | Active                                    |
| [BR-402](BR-402.md) | v1      | Consent page: intro, request details, primary/secondary buttons, note.      | [F-030 v1](../features/F-030-oauth-proxy-page-design.md) | Active; v2 active since F-031 (see below) |
| [BR-403](BR-403.md) | v1      | Error page: fixed text, fixed next-step paragraph, no request value.        | [F-030 v1](../features/F-030-oauth-proxy-page-design.md) | Active; v2 active since F-031 (see below) |
| [BR-129](BR-129.md) | v3      | BR-401 CSP; page follows BR-399–BR-402.                                     | [F-030 v1](../features/F-030-oauth-proxy-page-design.md) | Active; v6 active since F-033 (see below) |
| [BR-393](BR-393.md) | v2      | A registered client's page carries none of the BR-393 lines.                | [F-030 v1](../features/F-030-oauth-proxy-page-design.md) | Active; v3 active since F-031 (see below) |

## Accepted — OAuth proxy pages in English and French

[F-031 v1](../features/F-031-oauth-proxy-page-languages.md) (#31) allocates
BR-404–BR-410 v1 and versions BR-129 to v4, BR-143 to v4, BR-393 to v3,
BR-399 to v2, BR-402 to v2 and BR-403 to v2, all accepted on main `901f7af`
(#31 comment `31-acceptance-1-orchestrator`).

| ID                  | Version | Rule                                                                               | Source                                                      | Status                                    |
| ------------------- | ------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------- |
| [BR-404](BR-404.md) | v1      | Page language: valid `lang`, else `Accept-Language`, else English; never stored.   | [F-031 v1](../features/F-031-oauth-proxy-page-languages.md) | Active                                    |
| [BR-405](BR-405.md) | v1      | `lang` valid once as `en`/`fr`; otherwise ignored; never changes an OAuth outcome. | [F-031 v1](../features/F-031-oauth-proxy-page-languages.md) | Active                                    |
| [BR-406](BR-406.md) | v1      | Bounded `Accept-Language` parsing; `*` falls back to English, then French.         | [F-031 v1](../features/F-031-oauth-proxy-page-languages.md) | Active                                    |
| [BR-407](BR-407.md) | v1      | One typed catalogue per language; exact French texts; plain-text values.           | [F-031 v1](../features/F-031-oauth-proxy-page-languages.md) | Active                                    |
| [BR-408](BR-408.md) | v1      | Consent-page switcher; same query with the other `lang`; none on error pages.      | [F-031 v1](../features/F-031-oauth-proxy-page-languages.md) | Active                                    |
| [BR-409](BR-409.md) | v1      | A switch with the cookie replaces the oldest equal pending consent.                | [F-031 v1](../features/F-031-oauth-proxy-page-languages.md) | Active                                    |
| [BR-410](BR-410.md) | v1      | No new cookie, header, CSP change or stored language.                              | [F-031 v1](../features/F-031-oauth-proxy-page-languages.md) | Active                                    |
| [BR-129](BR-129.md) | v4      | Form posts to `/oauth/consent?lang=xx`; client labels in the page language.        | [F-031 v1](../features/F-031-oauth-proxy-page-languages.md) | Active; v6 active since F-033 (see below) |
| [BR-143](BR-143.md) | v4      | The consent page's switcher href may echo the request's own query.                 | [F-031 v1](../features/F-031-oauth-proxy-page-languages.md) | Accepted; superseded by v5                |
| [BR-393](BR-393.md) | v3      | BR-393 line texts in the page language.                                            | [F-031 v1](../features/F-031-oauth-proxy-page-languages.md) | Active                                    |
| [BR-399](BR-399.md) | v2      | `<html lang>`, title, header and footer texts in the page language; switcher link. | [F-031 v1](../features/F-031-oauth-proxy-page-languages.md) | Active                                    |
| [BR-402](BR-402.md) | v2      | Consent page texts in the page language.                                           | [F-031 v1](../features/F-031-oauth-proxy-page-languages.md) | Active                                    |
| [BR-403](BR-403.md) | v2      | Error page texts in the page language; no switcher.                                | [F-031 v1](../features/F-031-oauth-proxy-page-languages.md) | Active                                    |

## Accepted — Repeated consent POST answered idempotently

[F-032 v1](../features/F-032-repeated-consent-post.md) (#33) allocates BR-411
v1 and versions BR-129 to v5 and BR-142 to v3, all accepted on main `89be2ba`
(#33 comment `33-acceptance-1-orchestrator`).

| ID                  | Version | Rule                                                                         | Source                                                 | Status                                    |
| ------------------- | ------- | ---------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------- |
| [BR-411](BR-411.md) | v1      | A same-browser repeat within 10 s of consumption replays the decision's 302. | [F-032 v1](../features/F-032-repeated-consent-post.md) | Active                                    |
| [BR-129](BR-129.md) | v5      | A consumed identifier with a BR-411 record is answered under BR-411.         | [F-032 v1](../features/F-032-repeated-consent-post.md) | Active; v6 active since F-033 (see below) |
| [BR-142](BR-142.md) | v3      | Adds the memory-only BR-411 replay records, purged and evicted when settled. | [F-032 v1](../features/F-032-repeated-consent-post.md) | Active                                    |

## Accepted — CIMD document handling hardened

[F-033 v1](../features/F-033-cimd-hardening.md) (#26) versions BR-129 to v6
and BR-306, BR-307, BR-309 and BR-394 to v2, with no new BR ID, all accepted
on main `6ef8b55` (#26 comment `26-acceptance-1-orchestrator`).

| ID                  | Version | Rule                                                                                      | Source                                          | Status                     |
| ------------------- | ------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------- |
| [BR-129](BR-129.md) | v6      | A name with a Bidi_Control, U+2028 or U+2029 code point is shown as unnamed.              | [F-033 v1](../features/F-033-cimd-hardening.md) | Active                     |
| [BR-306](BR-306.md) | v2      | Every header block, `1xx` included, at most 8,192 bytes before parsing; `size`, status 0. | [F-033 v1](../features/F-033-cimd-hardening.md) | Accepted; superseded by v3 |
| [BR-307](BR-307.md) | v2      | Adds the AS112, AMT and AS112 direct-delegation blocks (IPv4 and IPv6).                   | [F-033 v1](../features/F-033-cimd-hardening.md) | Active                     |
| [BR-309](BR-309.md) | v2      | A usable stale entry is served before the four-fetch cap answers `busy`.                  | [F-033 v1](../features/F-033-cimd-hardening.md) | Active                     |
| [BR-394](BR-394.md) | v2      | A header-bound `size` (BR-306 v2) has `status` 0; a body-bound `size` keeps 200.          | [F-033 v1](../features/F-033-cimd-hardening.md) | Accepted; superseded by v3 |

## Accepted — PDF text extraction for common generator output

[F-034 v1](../features/F-034-pdf-extraction-profile.md) (#4) allocates
BR-412–BR-420 v1 and versions BR-114 to v2; F-034 v2 versions BR-173, BR-226 and
BR-392 to v2 so that the Apache-2.0 licence text ships with the package and the
image; all accepted on main `570c4b2` (#4 comment
`4-acceptance-1-orchestrator`).

| ID                  | Version | Rule                                                                                        | Source                                                  | Status |
| ------------------- | ------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------ |
| [BR-114](BR-114.md) | v2      | Profile of BR-412–BR-420; PDF.js sees only the canonical projection; refusal order.         | [F-034 v1](../features/F-034-pdf-extraction-profile.md) | Active |
| [BR-412](BR-412.md) | v1      | Cross-reference tables and streams through a bounded, cycle-checked `/Prev` chain.          | [F-034 v1](../features/F-034-pdf-extraction-profile.md) | Active |
| [BR-413](BR-413.md) | v1      | Objects by offset or object stream; indirect `/Length`; 4,096 resolved objects.             | [F-034 v1](../features/F-034-pdf-extraction-profile.md) | Active |
| [BR-414](BR-414.md) | v1      | Only needed streams are decoded (Flate, PNG predictors, ASCII filters); each use counts.    | [F-034 v1](../features/F-034-pdf-extraction-profile.md) | Active |
| [BR-415](BR-415.md) | v1      | The canonical document keeps the page tree and the selected pages' text inputs only.        | [F-034 v1](../features/F-034-pdf-extraction-profile.md) | Active |
| [BR-416](BR-416.md) | v1      | Content keeps text operators, drops graphics and inline images of known length.             | [F-034 v1](../features/F-034-pdf-extraction-profile.md) | Active |
| [BR-417](BR-417.md) | v1      | Simple, Type0 and Type3 fonts with a full mapping, canonical names, no program.             | [F-034 v1](../features/F-034-pdf-extraction-profile.md) | Active |
| [BR-418](BR-418.md) | v1      | Text-production bound weighted by each font's largest mapping, per execution.               | [F-034 v1](../features/F-034-pdf-extraction-profile.md) | Active |
| [BR-419](BR-419.md) | v1      | Form XObjects are inlined and every execution counted; nesting 8, executions 4,096.         | [F-034 v1](../features/F-034-pdf-extraction-profile.md) | Active |
| [BR-420](BR-420.md) | v1      | Simple-font codes resolve to explicit glyph names; Type 1 built-in encoding from cleartext. | [F-034 v1](../features/F-034-pdf-extraction-profile.md) | Active |
| [BR-173](BR-173.md) | v2      | `runtime` also copies `LICENSES/Apache-2.0.txt` into `/app/LICENSES/`.                      | [F-034 v2](../features/F-034-pdf-extraction-profile.md) | Active |
| [BR-226](BR-226.md) | v2      | A path under `LICENSES/` is an image input.                                                 | [F-034 v2](../features/F-034-pdf-extraction-profile.md) | Active |
| [BR-392](BR-392.md) | v2      | The install check also copies `LICENSES/`.                                                  | [F-034 v2](../features/F-034-pdf-extraction-profile.md) | Active |

## Accepted — OAuth proxy admission and grant handling hardened

[F-035 v1](../features/F-035-oauth-proxy-hardening.md) (#46) allocates
BR-421 and BR-422 v1 and versions BR-023 to v4, BR-024 to v5, BR-131, BR-133,
BR-137 and BR-186 to v2 and BR-162, BR-167 and BR-184 to v3; all accepted on
main `703bece` (#46 comment `6891311411`).

| ID                  | Version | Rule                                                                                              | Source                                                 | Status                                    |
| ------------------- | ------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------- |
| [BR-421](BR-421.md) | v1      | `httpTrustedProxies`: at most 64 IPv4/IPv6 addresses or prefixes (/8 or longer), proxy mode only. | [F-035 v1](../features/F-035-oauth-proxy-hardening.md) | Active                                    |
| [BR-422](BR-422.md) | v1      | Peer: socket address, or the `X-Forwarded-For` client behind a listed proxy; IPv6 per `/64`.      | [F-035 v1](../features/F-035-oauth-proxy-hardening.md) | Active                                    |
| [BR-023](BR-023.md) | v4      | Adds the bounds of BR-421.                                                                        | [F-035 v1](../features/F-035-oauth-proxy-hardening.md) | Active                                    |
| [BR-024](BR-024.md) | v5      | `httpTrustedProxies` is proxy-only.                                                               | [F-035 v1](../features/F-035-oauth-proxy-hardening.md) | Active                                    |
| [BR-131](BR-131.md) | v2      | Early upstream exits abort independently and initiate readable-body cancellation without waiting. | [F-035 v1](../features/F-035-oauth-proxy-hardening.md) | Active                                    |
| [BR-133](BR-133.md) | v2      | Shared JWKS fetch; ID-token time checks after verification; cache bounds from fetch start.        | [F-035 v1](../features/F-035-oauth-proxy-hardening.md) | Active                                    |
| [BR-137](BR-137.md) | v2      | Bindings first; single-URI omission profile; only success consumes and matching replay revokes.   | [F-035 v1](../features/F-035-oauth-proxy-hardening.md) | Active; v3 active since F-036 (see below) |
| [BR-162](BR-162.md) | v3      | Per-peer window (v1 limits) and global ceiling per OAuth route; bounded tables.                   | [F-035 v1](../features/F-035-oauth-proxy-hardening.md) | Active                                    |
| [BR-167](BR-167.md) | v3      | An OAuth-window 429 adds `window`; no peer address in responses or events.                        | [F-035 v1](../features/F-035-oauth-proxy-hardening.md) | Accepted; superseded by v4                |
| [BR-184](BR-184.md) | v3      | Compose: optional `MCP_HTTP_TRUSTED_PROXIES`, empty by default, with a comment.                   | [F-035 v1](../features/F-035-oauth-proxy-hardening.md) | Active; v4 active since F-046 (see below) |
| [BR-186](BR-186.md) | v2      | Required Compose values stay required; optional values may have empty defaults; header matches.   | [F-035 v1](../features/F-035-oauth-proxy-hardening.md) | Active; v3 active since F-046 (see below) |

## Accepted — refused authorization-code redemption events restored

[F-036 v1](../features/F-036-refused-code-event.md) (#49) versions
BR-137 to v3 with no new BR ID; accepted on main `14f5266` (#49 comment
`6893052881`). BR-143 v4's event catalogue and fields remain unchanged.

| ID                  | Version | Rule                                                                                                     | Source                                              | Status |
| ------------------- | ------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------ |
| [BR-137](BR-137.md) | v3      | Exactly one existing-shape `token_refused` per refused code redemption; no `reason` or new state change. | [F-036 v1](../features/F-036-refused-code-event.md) | Active |

## Accepted — rate-limited mutations stop after one attempt

[F-037 v1](../features/F-037-mutation-rate-limit-stop.md) (#47 lot A),
versions BR-248, BR-249, BR-250 and BR-268 to v2 with no
new BR ID; accepted on main `8b92e07` (#47 comment `6894142807`).
The v1 text/evidence is preserved in the canonical files. BR-249 keeps its 60 s run deadline
and 30 s attempt cap; BR-268 keeps its raw-port contract. Their obsolete
retry examples are replaced in v2. BR-247, BR-251 and the audit schema
remain unchanged. The supplied reviews and their dispositions are recorded
in F-037.

| ID                  | Version | Rule                                                                                                  | Source                                                    | Status                     |
| ------------------- | ------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------- |
| [BR-248](BR-248.md) | v2      | One attempt per mutation run; valid 429 returns `RATE_LIMITED` without waiting or retrying.           | [F-037 v1](../features/F-037-mutation-rate-limit-stop.md) | Active                     |
| [BR-249](BR-249.md) | v2      | Keep the 60 s run deadline and 30 s cap for the sole attempt; no second-attempt window.               | [F-037 v1](../features/F-037-mutation-rate-limit-stop.md) | Active                     |
| [BR-250](BR-250.md) | v2      | No retry-wait cancellation; cancellation during/after an attempt preserves its result.                | [F-037 v1](../features/F-037-mutation-rate-limit-stop.md) | Active                     |
| [BR-268](BR-268.md) | v2      | Keep the bounded raw port reply; a forwarded or omitted retry header never schedules another attempt. | [F-037 v1](../features/F-037-mutation-rate-limit-stop.md) | Accepted; superseded by v3 |

## Accepted — stream operation budgets and weak validators

[F-038 v1](../features/F-038-stream-budget-and-weak-etags.md) (#47 lot B)
versions BR-070 to v4 and BR-205 and BR-384 to v2 with no new BR ID;
accepted on main `2ae303c` (#47 comment `6895105510`).
The previous versions' text/evidence is preserved in the canonical files.
BR-088 keeps its retry rule; the obsolete fragment-budget assertion is
replaced in the tests. BR-206 continues using BR-205 normalization;
BR-207 keeps its 1,024-request / 120,000 ms preflight bounds. F-038 D-1
preserves the existing operation charging points; counting every physical
HTTP request is out of scope.

| ID                  | Version | Rule                                                                                                       | Source                                                        | Status                                    |
| ------------------- | ------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------- |
| [BR-070](BR-070.md) | v4      | Exclude body reads and EOF from the unchanged 512-operation budget; retain byte/deadline/lifecycle bounds. | [F-038 v1](../features/F-038-stream-budget-and-weak-etags.md) | Active; v5 active since F-039 (see below) |
| [BR-205](BR-205.md) | v2      | Normalize exact `W/` validators as absent in describe/open; preserve other derivation.                     | [F-038 v1](../features/F-038-stream-budget-and-weak-etags.md) | Active                                    |
| [BR-384](BR-384.md) | v2      | Slot-owned operation budgets exclude body reads; stream progress never resets the deadline.                | [F-038 v1](../features/F-038-stream-budget-and-weak-etags.md) | Active                                    |

## Accepted — bounded audit append and shutdown waits

[F-039 v1](../features/F-039-bounded-audit-sink.md) (#47 lot C)
versions BR-070 to v5 and BR-240, BR-241, BR-254 and BR-259 to v2;
accepted on main `8bc1780` (#47 comment `6897083907`).
The previous versions' text/evidence is preserved in the canonical files.
No new BR ID or ADR is allocated.
BR-242 serialization and BR-244/BR-252 before-/after-dispatch semantics stay
unchanged, including outcome_unrecorded after an upstream success.

| ID                  | Version | Rule                                                                                                     | Source                                              | Status |
| ------------------- | ------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------ |
| [BR-070](BR-070.md) | v5      | Bounded audit shutdown replaces unlimited stderr waits; committed results and idle stdio bound retained. | [F-039 v1](../features/F-039-bounded-audit-sink.md) | Active |
| [BR-240](BR-240.md) | v2      | Acknowledge complete writes only before the append deadline.                                             | [F-039 v1](../features/F-039-bounded-audit-sink.md) | Active |
| [BR-241](BR-241.md) | v2      | Errors/timeouts reject appends and latch until restart; one fixed diagnostic on any first latch.         | [F-039 v1](../features/F-039-bounded-audit-sink.md) | Active |
| [BR-254](BR-254.md) | v2      | Bounded sink/gate close; shared stdio exit helper with capped 250 ms flush; OS stalls excluded.          | [F-039 v1](../features/F-039-bounded-audit-sink.md) | Active |
| [BR-259](BR-259.md) | v2      | Both sinks get one 5,000 ms budget from append call, including queue time.                               | [F-039 v1](../features/F-039-bounded-audit-sink.md) | Active |

## Accepted — process-wide extraction admission

[F-040 v1](../features/F-040-process-wide-extraction-admission.md)
(#47 lot D) allocates BR-423–BR-426 v1 and versions BR-118 to v3;
accepted on main `67c101a` (#47 comment `6897680463`).
The previous BR-118 version's text/evidence is preserved in its canonical file.
No ADR is allocated. BR-070, BR-117 and BR-384 retain their bounds. F-040 D-4 explicitly
records the failed/overdue-termination exception in accepted BR-118 v3:
release the invocation slot within its deadline while a detached exit watcher
retains the permit/identity until exit, preserving BR-109 final authorization.
Detach/release offer fixed payload-free diagnostics through a process-owned
stderr sink in both transports, retained after session close. Each identity has at most
one live waiter; a detached charged identity refuses immediately with SERVER_BUSY.
When every permit is detached, all new extraction callers refuse immediately.

Lot C's F-039 and its BR-070 v5, BR-240 v2, BR-241 v2, BR-254 v2 and
BR-259 v2 are accepted above. Lot D neither versions those rules nor depends
on a BR-070 v6.

| ID                  | Version | Rule                                                                                                              | Source                                                             | Status |
| ------------------- | ------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------ |
| [BR-423](BR-423.md) | v1      | Two process-wide permits before buffering; at most one per identity.                                              | [F-040 v1](../features/F-040-process-wide-extraction-admission.md) | Active |
| [BR-424](BR-424.md) | v1      | Four waiters, at most one per identity; oldest eligible first; queue/identity refusal is `SERVER_BUSY`.           | [F-040 v1](../features/F-040-process-wide-extraction-admission.md) | Active |
| [BR-425](BR-425.md) | v1      | Extraction waiting spends the running invocation deadline and obeys cancel/close.                                 | [F-040 v1](../features/F-040-process-wide-extraction-admission.md) | Active |
| [BR-426](BR-426.md) | v1      | Release once after worker exit; detach ownership on failed/overdue termination; fixed detach/release diagnostics. | [F-040 v1](../features/F-040-process-wide-extraction-admission.md) | Active |
| [BR-118](BR-118.md) | v3      | Deadline-bounded session-slot release on detach; permit retained until exit; final authorization preserved.       | [F-040 v1](../features/F-040-process-wide-extraction-admission.md) | Active |

## Accepted — configured-root ancestor protection

[F-041 v1](../features/F-041-configured-root-ancestors.md) (#47 lot E)
versions BR-277 and BR-278 to v2 and allocates BR-427 v1;
accepted on main `448a48f` (#47 comment `6898895634`).
The previous BR-277 and BR-278 versions' text/evidence is preserved in their
canonical files. R-17-2's known-ancestor bypass is addressed; visibility
refusals and the external-mutation check-then-act window remain.
No ADR is allocated. F-040 and BR-423–BR-426 belong to accepted lot D (`67c101a`).

| ID                  | Version | Rule                                                                                             | Source                                                     | Status |
| ------------------- | ------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ------ |
| [BR-277](BR-277.md) | v2      | Document source ancestors, unknown ancestry and staged R-17-2 remediation.                       | [F-041 v1](../features/F-041-configured-root-ancestors.md) | Active |
| [BR-278](BR-278.md) | v2      | Refuse trash/rename/move of configured-root ancestors; preserve audit and destination semantics. | [F-041 v1](../features/F-041-configured-root-ancestors.md) | Active |
| [BR-427](BR-427.md) | v1      | Fresh same-drive configured-root ID ancestry; fail closed on unknown evidence.                   | [F-041 v1](../features/F-041-configured-root-ancestors.md) | Active |

## Accepted — MCP tool and parameter descriptions

[F-042 v1](../features/F-042-mcp-tool-descriptions.md) (#42)
allocates BR-428–BR-430 v1; accepted on main `3b035b8`
(#42 comment `6900828692`). BR-068 v1, BR-263 v2, BR-283 v2 and BR-424 v1 retain their
active wording; the new catalog preserves their mandatory text verbatim.
No existing active rule is replaced. No ADR. Next free IDs after F-042 were F-043,
BR-431, ADR-013.

| ID                  | Version | Rule                                                                                            | Source                                                 | Status |
| ------------------- | ------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------ |
| [BR-428](BR-428.md) | v1      | Exact purpose, result and continuation descriptions for all 16 tools.                           | [F-042 v1](../features/F-042-mcp-tool-descriptions.md) | Active |
| [BR-429](BR-429.md) | v1      | Exact descriptions of all 58 parameter occurrences and pages.items, consistent with validation. | [F-042 v1](../features/F-042-mcp-tool-descriptions.md) | Active |
| [BR-430](BR-430.md) | v1      | Fixed trusted text, catalog size budgets and unchanged non-description contracts.               | [F-042 v1](../features/F-042-mcp-tool-descriptions.md) | Active |

## Accepted — queue changelog release sections

[F-043 v1](../features/F-043-queue-changelog-release-sections.md) (#67) was
accepted on actual main `f72a15b` on 2026-11-15 (#67 comment `6902168340`).
BR-387 v2 is active and changes only the #16 Fixed entry location to the first
matching release section, with Unreleased fallback and the BR-321 v4 archive
cutoff. No new BR or ADR.
Next free IDs: F-044, BR-434, ADR-013.

| ID                  | Version | Rule                                                          | Source                                                            | Status |
| ------------------- | ------- | ------------------------------------------------------------- | ----------------------------------------------------------------- | ------ |
| [BR-387](BR-387.md) | v2      | Release-aware #16 Fixed entry; other documentation unchanged. | [F-043 v1](../features/F-043-queue-changelog-release-sections.md) | Active |

## Accepted — root path resolution errors

[F-044 v1](../features/F-044-root-path-resolution-errors.md) (#88) is done.
BR-021 v2 and BR-207 v2 are active after acceptance on actual main `3f6e291`
on 2026-11-19 ([#88 acceptance](https://github.com/sstolz/kdrive-mcp-server/issues/88#issuecomment-7005778721)).
No new rule version is allocated by this synchronization.

## Accepted — Linux-only explicit close-on-exec flag

[F-045 v1](../features/F-045-linux-only-cloexec.md) (#96) is done.
BR-239 v2, BR-293 v2 and BR-295 v3 are active after acceptance on actual main
`b65a1e5` on 2026-11-19 ([#96 acceptance](https://github.com/sstolz/kdrive-mcp-server/issues/96#issuecomment-7007926600)).
No new rule version is allocated by this synchronization.

| ID                  | Version | Rule                                                                   | Source                                              | Status |
| ------------------- | ------- | ---------------------------------------------------------------------- | --------------------------------------------------- | ------ |
| [BR-239](BR-239.md) | v2      | Audit flags include O_NONBLOCK and Linux-only explicit close-on-exec.  | [F-045 v1](../features/F-045-linux-only-cloexec.md) | Active |
| [BR-293](BR-293.md) | v2      | Creation flags include O_WRONLY and Linux-only explicit close-on-exec. | [F-045 v1](../features/F-045-linux-only-cloexec.md) | Active |
| [BR-295](BR-295.md) | v3      | Header flags use Linux-only explicit close-on-exec; no creation mode.  | [F-045 v1](../features/F-045-linux-only-cloexec.md) | Active |

## Accepted — Compose identity allowlists

[F-046 v1](../features/F-046-compose-example-allowlists.md) (#112) activates
BR-184 v4, BR-186 v3 and BR-187 v4. Accepted on actual main `e8ae20d`, 2026-11-19 ([#112 acceptance](https://github.com/sstolz/kdrive-mcp-server/issues/112#issuecomment-7014711154)).
F-046 is done. No new BR or ADR is allocated.

| ID                  | Version | Rule                                                                                | Source                                                      | Status |
| ------------------- | ------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------ |
| [BR-184](BR-184.md) | v4      | Compose: both optional allowlists, exact guidance and parsed loading matrix.        | [F-046 v1](../features/F-046-compose-example-allowlists.md) | Active |
| [BR-186](BR-186.md) | v3      | Exactly three empty defaults and the matching Compose header.                       | [F-046 v1](../features/F-046-compose-example-allowlists.md) | Active |
| [BR-187](BR-187.md) | v4      | Deployment tables, prose and .env explain either or both lists and prefer subjects. | [F-046 v1](../features/F-046-compose-example-allowlists.md) | Active |

## Accepted — Secret-file surrounding whitespace

[F-047 v1](../features/F-047-secret-file-surrounding-whitespace.md) (#111)
activates BR-026 v2. Accepted on actual main `c58e7bb`, 2026-11-19 ([#111 acceptance](https://github.com/sstolz/kdrive-mcp-server/issues/111#issuecomment-7021357708)). F-047 is done.

| ID                  | Version | Rule                                                                                                                                   | Source                                                              | Status |
| ------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------ |
| [BR-026](BR-026.md) | v2      | Four-byte boundary trimming of selected secret files after raw bounds; empty-result refusal; unchanged interior and inline validation. | [F-047 v1](../features/F-047-secret-file-surrounding-whitespace.md) | Active |

## Accepted — Deny-pattern root warning (#110)

[F-048 v1](../features/F-048-deny-pattern-root-warning.md) (#110) versions
BR-021 and BR-207 to v3 and BR-027 to v2 and allocates BR-434–BR-435 v1.
All five rules are active after acceptance on main `f4487a2` on 2026-11-21
([#110 acceptance](https://github.com/sstolz/kdrive-mcp-server/issues/110#issuecomment-7062590216)).
F-048 v1 is done; counts above classify records by their latest version status.

| ID                  | Version | Rule                                             | Status      |
| ------------------- | ------- | ------------------------------------------------ | ----------- |
| [BR-021](BR-021.md) | v3      | Separate identity-bound diagnostic root paths    | Active (v3) |
| [BR-207](BR-207.md) | v3      | Path evidence from existing resolution responses | Active (v3) |
| [BR-027](BR-027.md) | v2      | Redacted startup warning exception               | Active (v2) |
| [BR-434](BR-434.md) | v1      | Conservative outside-root pattern classification | Active (v1) |
| [BR-435](BR-435.md) | v1      | Exact redacted stderr startup warning            | Active (v1) |

## Accepted — Secret-file BOM refusal (#117)

[F-049 v1](../features/F-049-secret-file-bom-refusal.md) (#117) versions
BR-026 and BR-027 to v3; both are active after acceptance on main `e3c63b8`
on 2026-11-22 ([#117 acceptance](https://github.com/sstolz/kdrive-mcp-server/issues/117#issuecomment-7087203460)).
F-049 v1 is done; no new rule ID is allocated and active-rule counts remain unchanged.

| Rule                | Version | Change                                                                                                                                | Status      |
| ------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| [BR-026](BR-026.md) | v3      | Refuse raw EF BB BF anywhere in selected credential files after guarded reads and limits, before trim/decode; retain inline behavior. | Active (v3) |
| [BR-027](BR-027.md) | v3      | Permit the fixed redacted CREDENTIAL_BOM diagnostic with canonical settings.                                                          | Active (v3) |

## F-050 v1 — Info size and modification time (#75)

Pending acceptance: [BR-063 v2](BR-063.md), [BR-428 v2](BR-428.md),
[BR-436 v1](BR-436.md) and [BR-437 v1](BR-437.md). The accepted BR-063 v1
and BR-428 v1 definitions remain active until actual-main acceptance.
Only info gains the two scalars; all other navigation projections stay unchanged.
The new rule records are prepared; owner-run qualification is still pending.

| ID                  | Version | Rule                                                   | Source                                                           | Status                                |
| ------------------- | ------- | ------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------- |
| [BR-063](BR-063.md) | v2      | Seven-field info; five-field other navigation outputs. | [F-050 v1](../features/F-050-info-size-and-modification-time.md) | Pending acceptance; v1 remains active |
| [BR-428](BR-428.md) | v2      | Replace only info purpose P.                           | [F-050 v1](../features/F-050-info-size-and-modification-time.md) | Pending acceptance; v1 remains active |
| [BR-436](BR-436.md) | v1      | Validated file byte size, otherwise null.              | [F-050 v1](../features/F-050-info-size-and-modification-time.md) | Pending acceptance                    |
| [BR-437](BR-437.md) | v1      | Validated whole Unix seconds to UTC, otherwise null.   | [F-050 v1](../features/F-050-info-size-and-modification-time.md) | Pending acceptance                    |

## Accepted — Transport edge cases (#77)

[F-051 v1](../features/F-051-transport-edge-cases.md) (#77) allocates
[BR-438 v1](BR-438.md) and [BR-439 v1](BR-439.md), and versions
[BR-268](BR-268.md) and [BR-216](BR-216.md) to v3; all four are active
after acceptance on main `b249860` on 2026-11-24 ([#77 acceptance](https://github.com/sstolz/kdrive-mcp-server/issues/77#issuecomment-7143986357)).
F-051 v1 is done; counts above classify records by their latest version status.
Permanent mutation socket error handling and close settlement preserve
BR-267 v1's classification and never authorize replay. Observer timing stays
unchanged; totals and bounds describe request attempts, including pre-send
failures. The separate read-deadline decision stays open on #77.

| ID                  | Version | Rule                                                                                     | Source                                                | Status      |
| ------------------- | ------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------- |
| [BR-438](BR-438.md) | v1      | Permanent payload-free mutation socket error listener and no write after recorded error. | [F-051 v1](../features/F-051-transport-edge-cases.md) | Active (v1) |
| [BR-439](BR-439.md) | v1      | Close before a response settles unknown and releases the slot without abort or replay.   | [F-051 v1](../features/F-051-transport-edge-cases.md) | Active (v1) |
| [BR-268](BR-268.md) | v3      | Raw results require a final non-1xx response event; lower statuses reject as unknown.    | [F-051 v1](../features/F-051-transport-edge-cases.md) | Active (v3) |
| [BR-216](BR-216.md) | v3      | Count request attempts at the existing observation points.                               | [F-051 v1](../features/F-051-transport-edge-cases.md) | Active (v3) |

## Accepted — OAuth qualification and proxy hardening (#72)

[F-052 v1](../features/F-052-oauth-qualification-proxy-hardening.md) (#72)
allocates BR-440–BR-442 v1 and versions BR-096/103/127 to v2, BR-143 to v5
and BR-306/394 to v3; all nine are active after acceptance on main `019f0f5`
on 2026-11-25 ([#72 acceptance](https://github.com/sstolz/kdrive-mcp-server/issues/72#issuecomment-7147678234)).
F-052 v1 is done; counts above classify records by their latest version status.

| ID                  | Version | Rule                                                                       | Source                                                               | Status      |
| ------------------- | ------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------- |
| [BR-096](BR-096.md) | v2      | Refuse conflicting discovery endpoints before interactive token admission. | [F-052 v1](../features/F-052-oauth-qualification-proxy-hardening.md) | Active (v2) |
| [BR-103](BR-103.md) | v2      | Require issuer evidence only for potentially applicable delegation paths.  | [F-052 v1](../features/F-052-oauth-qualification-proxy-hardening.md) | Active (v2) |
| [BR-127](BR-127.md) | v2      | Apply registration defaults only to absent members; refuse explicit null.  | [F-052 v1](../features/F-052-oauth-qualification-proxy-hardening.md) | Active (v2) |
| [BR-143](BR-143.md) | v5      | Emit exactly one store/count capacity event per refusal or eviction.       | [F-052 v1](../features/F-052-oauth-qualification-proxy-hardening.md) | Active (v5) |
| [BR-306](BR-306.md) | v3      | Settle parser-accepted CIMD 101 immediately and release fetch capacity.    | [F-052 v1](../features/F-052-oauth-qualification-proxy-hardening.md) | Active (v3) |
| [BR-394](BR-394.md) | v3      | Record terminal CIMD status 101 and the superseding capacity-event rule.   | [F-052 v1](../features/F-052-oauth-qualification-proxy-hardening.md) | Active (v3) |
| [BR-440](BR-440.md) | v1      | Settle hidden-read EOF and errors without exposing payloads.               | [F-052 v1](../features/F-052-oauth-qualification-proxy-hardening.md) | Active (v1) |
| [BR-441](BR-441.md) | v1      | Refuse unsupported controls without silently stripping input.              | [F-052 v1](../features/F-052-oauth-qualification-proxy-hardening.md) | Active (v1) |
| [BR-442](BR-442.md) | v1      | Restore terminal state on every hidden-read exit and retain an error sink. | [F-052 v1](../features/F-052-oauth-qualification-proxy-hardening.md) | Active (v1) |

## F-053 v2 — HTTP lifecycle hardening (#73)

[F-053 v2](../features/F-053-http-lifecycle-hardening.md) (#73) allocates
[BR-443](BR-443.md)–[BR-446](BR-446.md) v1 and versions [BR-164](BR-164.md)
and [BR-166](BR-166.md) to v2 and [BR-167](BR-167.md) and [BR-169](BR-169.md)
to v4; all eight are active after acceptance on main `4492616` on 2026-11-25
([#73 acceptance](https://github.com/sstolz/kdrive-mcp-server/issues/73#issuecomment-7155904032)). BR-164 v1, BR-166 v1, BR-167 v3 and BR-169 v3 are accepted,
superseded. F-053 v2 is done. F-053 D-4 reverses F-026 D-8 for queued
calls that have not started; F-026 is not edited.

| ID                  | Version | Rule                                                                       | Source                                                    | Status      |
| ------------------- | ------- | -------------------------------------------------------------------------- | --------------------------------------------------------- | ----------- |
| [BR-164](BR-164.md) | v2      | Close a registered session whose `initialize` fails; settle a held DELETE. | [F-053 v2](../features/F-053-http-lifecycle-hardening.md) | Active (v2) |
| [BR-166](BR-166.md) | v2      | Explicit per-request disconnect signal, mapped from the SDK request.       | [F-053 v2](../features/F-053-http-lifecycle-hardening.md) | Active (v2) |
| [BR-167](BR-167.md) | v4      | `initialize_failed`, `listener_error` and the 431 `request_refused`.       | [F-053 v2](../features/F-053-http-lifecycle-hardening.md) | Active (v4) |
| [BR-169](BR-169.md) | v4      | `maxHeadersCount` 2,000 (Node 431 above); `maxHeaderSize` unchanged.       | [F-053 v2](../features/F-053-http-lifecycle-hardening.md) | Active (v4) |
| [BR-443](BR-443.md) | v1      | Prune ended `WindowLimiter` windows when a window opens.                   | [F-053 v2](../features/F-053-http-lifecycle-hardening.md) | Active (v1) |
| [BR-444](BR-444.md) | v1      | Keep serving after accept-time errors; one payload-free event per minute.  | [F-053 v2](../features/F-053-http-lifecycle-hardening.md) | Active (v1) |
| [BR-445](BR-445.md) | v1      | A disconnect cancels a not-yet-started queued call with `ACCESS_DENIED`.   | [F-053 v2](../features/F-053-http-lifecycle-hardening.md) | Active (v1) |
| [BR-446](BR-446.md) | v1      | Refuse 101–2,000 header lines with 431 before `handle()`.                  | [F-053 v2](../features/F-053-http-lifecycle-hardening.md) | Active (v1) |

## F-054 v2 — Process and stdio lifecycle (#139)

[F-054 v2](../features/F-054-process-stdio-lifecycle.md) (#139) allocates
[BR-447](BR-447.md) and [BR-448](BR-448.md) v1 and versions
[BR-069](BR-069.md) and [BR-254](BR-254.md) to v3 and
[BR-210](BR-210.md) and [BR-262](BR-262.md) to v2; all six are active
after acceptance on main `23174da` on 2026-11-26
([#139 acceptance](https://github.com/sstolz/kdrive-mcp-server/issues/139#issuecomment-7185165708)). F-054 v2 is done.
V2 records the earlier, stricter cleanup timing in BR-254 v3; the other
five rule texts are unchanged. Previous accepted versions remain superseded
history. No ADR is allocated. Deferred minor findings are tracked in #144.

| ID                  | Version | Rule                                                                    | Source                                                   | Status      |
| ------------------- | ------- | ----------------------------------------------------------------------- | -------------------------------------------------------- | ----------- |
| [BR-069](BR-069.md) | v3      | Re-serialize validated stdio gate-error JSON.                           | [F-054 v2](../features/F-054-process-stdio-lifecycle.md) | Active (v3) |
| [BR-210](BR-210.md) | v2      | Consume HTTP signal close failure and select exit 1.                    | [F-054 v2](../features/F-054-process-stdio-lifecycle.md) | Active (v2) |
| [BR-254](BR-254.md) | v3      | Start cleanup early, drain mutations and preserve close failure status. | [F-054 v2](../features/F-054-process-stdio-lifecycle.md) | Active (v3) |
| [BR-262](BR-262.md) | v2      | Require finite gate-error attempts and optional status.                 | [F-054 v2](../features/F-054-process-stdio-lifecycle.md) | Active (v2) |
| [BR-447](BR-447.md) | v1      | Retain permanent process stream error ownership.                        | [F-054 v2](../features/F-054-process-stdio-lifecycle.md) | Active (v1) |
| [BR-448](BR-448.md) | v1      | Classify stream failures and preserve dedicated failure status.         | [F-054 v2](../features/F-054-process-stdio-lifecycle.md) | Active (v1) |
