# Feature contract history

Preserve frozen snapshots unchanged. A revised contract retains its F identifier.
The historical revisions below allocated fresh BR identifiers as recorded at the
time; their chains remain unchanged. Under the current prospective AGENTS policy,
a same-purpose BR change keeps its ID and increments its BR version with History
and updated tests; a different-purpose replacement receives a new ID. The #35
documentation migration starts all existing records at BR version 1 without
inventing prior BR versions. No snapshot proves product acceptance. Relative links inside a verbatim snapshot retain their original
canonical-file context; use the live spec/index for current navigable references.

| Feature/version | Snapshot | State and successor |
|---|---|---|
| F-001 v1 | [Original frozen text](F-001-v1.md) | Frozen 2026-11-01; workflow superseded by [v2](F-001-v2.md) following the user's Docker/Make requirement; no implementation acceptance |
| F-001 v2 | [Original frozen text](F-001-v2.md) | Frozen 2026-11-01; [frozen v3](F-001-v3.md) supersedes quality/coverage/remote analysis scope; no implementation acceptance |
| F-001 v3 | [Original frozen text](F-001-v3.md) | Frozen 2026-11-01; [frozen v4](../F-001-typescript-foundation.md) revises project-token scanner and conditional CI contracts under #28; no acceptance claimed |
| F-002 v1 | [Original frozen text](F-002-v1.md) | Frozen 2026-11-01 21:18:28 UTC; [accepted v2](../F-002-configuration.md) clarifies narrow CLI budget diagnostics; accepted 2026-11-01 on `88bf8caa7412988e11099a4a01f9e600aa38eeee` |
| F-002 v2 | [Accepted text](F-002-v2.md) | Accepted 2026-11-01 on `88bf8caa7412988e11099a4a01f9e600aa38eeee`; [draft v3](../F-002-configuration.md) admits `localhost` HTTP redirect URIs under #21 (BR-024 v2); snapshot SHA-256 `522ade5d65faf3101c4cbaa91911de3c0a3ad2882cf3f5e0af28ff9233dbea96` |
| F-002 v3 | [Accepted text](F-002-v3.md) | Accepted on main `3fc14c3` with F-010 v1 (BR-024 v2); [frozen v4](../F-002-configuration.md) versions BR-025 to v2 under #12 (F-012); no acceptance of v4 claimed |
| F-003 v1 | [Original frozen text](F-003-v1.md) | Frozen 2026-11-02 07:44:57 UTC; abstract implementation accepted at `f31ee2f0e772c87d4ebfbe6a7aa77bc925d5b330`, production AC-19/AC-20 blocked; [frozen v2](../F-003-tree-access-policy.md) narrows BR-042 to its configured-tree route under #7 |
| F-005 v1 | [Accepted text](F-005-v1.md) | Accepted injected scope on main `209a68de956b328e04e2d98d6745128a587184bd`; [frozen v2](../F-005-stdio-navigation.md) versions BR-059 to v2 under #12 (F-012); no acceptance of v2 claimed |
| F-011 v1 | [Original frozen text](F-011-v1.md) | Frozen 2026-11-03 09:42:59 UTC (reviewed `b4abcfd`); [draft v2](../F-011-pre-merge-quality-gates.md) adds Git-metadata protection after PR #52 review 1 (M1); no acceptance; snapshot SHA-256 `ebe69ce1eb5f336bb6d8d15c65a90677d2bbed1c1030a0e6778a0a5156ed5cce` |
| F-012 v1 | [Accepted text](F-012-v1.md) | Accepted on main `00e6fe3` (2026-11-04, #12); [v2](../F-012-authenticated-http.md) moves acceptance secrets outside the checkout under #63 (BR-171 v2, BR-189, accepted on main `7b8b52d`); snapshot SHA-256 `e146c2af96cfd90baff57efd4263f29c13ea0fbbeffb161fbf308410c12d8e8c` |
| F-014 v1 | [Original frozen text](F-014-v1.md) | Frozen 2026-11-05 (#70, commit `5d6f72b`); [v2](../F-014-production-kdrive-adapter.md) sets upstream pages of 100, pins TLS verification and closes wording gaps (BR-199, BR-201, BR-202, BR-203, BR-211, BR-216, BR-217 v2); no acceptance claimed; snapshot SHA-256 `f599232d4ab6a743944c6c7f00c816a837aacae7e02fb9015a595a1d30644560` |
| F-014 v2 | [Frozen v2 text](F-014-v2.md) | Frozen 2026-11-08 (#70, commit `850ac9d`); [v3](../F-014-production-kdrive-adapter.md) exempts a closed list of non-ID fields from the real-ID leak search and fixes synthetic cursor/ETag forms (BR-213 v2, BR-214 v2); no acceptance claimed; snapshot SHA-256 `c7649f58b46a0daf32661d2de19d04183a5fbae2b558c7ef6da1b7d5f9910d48` |
| F-014 v3 | [Frozen v3 text](F-014-v3.md) | Frozen 2026-11-09 (#70, commit `1b9af9e`); [v4](../F-014-production-kdrive-adapter.md) derives the received anchor from the item's recipient path (BR-203 v3); no acceptance claimed; snapshot SHA-256 `bf02fa1cf694e7ddb9628d6c3cf2f6a7931d533f74bfe96b2655810b89a86eaf` |
| F-014 v4 | [Frozen v4 text](F-014-v4.md) | Frozen 2026-11-09 (#70, commit `7bc800f`); [v5](../F-014-production-kdrive-adapter.md) sets upstream pages of 50 (BR-201, BR-202, BR-211, BR-213 v3) and fixes AC-23 run B; no acceptance claimed; snapshot SHA-256 `38d35143f894f756c64ad24a14efa6c1c01c4a2868a4b35d076b8288667b1b1d` |
| F-014 v5 | [Frozen v5 text](F-014-v5.md) | Frozen 2026-11-09 (#70, commit `c1a05e2`); [v6](../F-014-production-kdrive-adapter.md) accepts `ACCESS_DENIED` or `READ_UNAVAILABLE` for the AC-25 revoked-share read; no acceptance claimed; snapshot SHA-256 `4dad4475e474b59806d9eb5f6981739abbcb9199fdac000f3e1becb71f350f9c` |
| F-014 v6 | [Frozen v6 text](F-014-v6.md) | Frozen 2026-11-09 (#70, PR #77); [v7](../F-014-production-kdrive-adapter.md) counts upstream children requests for the AC-25 scoped listing; no acceptance claimed; snapshot SHA-256 `9dcc9148de8960d40ae234e68bc7f2e3e8fe69cb137d2e9cd8f0d9c5e8e4cc88` |
| F-018 v1 | [Accepted v1 text](F-018-v1.md) | Frozen 2026-11-10 at `0c9a542` (#19), accepted on main `0f1852c`; [v2](../F-018-upload.md) (#91) requires NFC names after D-18-11; snapshot SHA-256 `2e04ce42670aa0a862d8aff2eada16bbae38288862f9994a9f0e5a3641cb0b48` |
| F-018 v2 | [Accepted v2 text](F-018-v2.md) | Frozen at `99f1ce9` (#91), accepted on main `b6b7fbb`; [v3](../F-018-upload.md) (#100) requires well-formed UTF-16 names for create and rename (BR-260 v3) and aligns the version literals with `PACKAGE_VERSION`; no acceptance of v3 claimed; snapshot SHA-256 `e0276e6399e5795482cafafc541ce37d0cbf450687193459da03374ddc142e50` |
| F-024 v1 | [Original frozen text](F-024-v1.md) | Frozen 2026-11-12 at `0624a1b` (#2); [draft v2](../F-024-gated-publication.md) withdraws BR-376, BR-377, BR-321 v2 and AC-17–AC-20 after the D-14 stop condition and adds residual risk (f) (owner decision 2026-11-12); no acceptance claimed; snapshot SHA-256 `bdb653f6c6323bad4502071baeb867e2c2c2cc4ea0fc366c03f3e6c29864319f` |
| F-027 v1 | [Original frozen text](F-027-v1.md) | Frozen 2026-11-13 at `cf27035` (#12); [v2](../F-027-direct-image-codecs.md) limits the BR-321 v4 changelog selection to the text before `## [0.6.0-beta.1]`; snapshot SHA-256 `65d6566541d955cc9356af3d0861bbb0c4f31a661d6698456398b9839f91d0c1` |

F-001 v2 retains BR-001–BR-004, supersedes BR-005 with BR-007 and BR-006 with BR-008,
and adds BR-009. The v1 snapshot is a byte-for-byte copy made before v2 editing.
No F/BR identifier is renumbered or reused.

V2 snapshot SHA-256 is
`06382aa4594960ab5052772c79d1df913790ed9f4274f8e1462dc2d3f6c37772`.
V3 preserves BR-001–BR-004 and BR-009, proposes BR-010/011 for BR-007/008,
and adds BR-012/013. V3 was autonomously frozen after fresh independent approval;
no rule or product capability is accepted by that transition.

V3 snapshot SHA-256 is
`e9b6ff61a68bfde8213f34d7bb523e2a5e4546796f21a4617943bb65c9856e7f`.
It is a byte-for-byte copy made before v4 editing. V4 retains BR-001–BR-004,
BR-009, BR-010 and BR-012, and allocates BR-014/015 to replace BR-013/011.
No prior frozen rule is rewritten or accepted by preparing v4.

V4 was autonomously frozen on 2026-11-01 at 20:26 UTC after fresh GPT-6 Astra/high
approval of reviewed SHA-256
`8f253c2249c6055002c8bff67bdcf3b29023daaec6982d7d304b7d18bf124eca`.
Its implementation and live acceptance remain separate obligations.

F-002 v1 snapshot SHA-256 is
`0c3d5cc48c172a3ff4be87e5c7dabb4ca0dd05f9107bc69e1566083e4bbb5b6b`.
It is a byte-for-byte copy made before v2 editing, including the original freeze
record and review dispositions. V2 preserves BR-016–BR-028 and all limit values;
it clarifies which CLI budget produces each diagnostic and the overlap ordering.
No fresh BR identifier is allocated for this clarification of the existing
source/diagnostic contract. Fresh independent GPT-6 Astra/high review approved
v2 SHA-256 `7005d6d3322a10a76dff08cc6fb05dfe3641f8ab07586ca65ccf61563c100d4f`;
the orchestrator froze v2 at 21:29:17 UTC and notified the user. See the
v2 review evidence (archived evidence `runs/4-spec-v2-review-1.md`). V2 acceptance subsequently
succeeded on actual main `88bf8caa7412988e11099a4a01f9e600aa38eeee`, 2026-11-01;
see the acceptance report (archived evidence `runs/33-acceptance-1.md`). The v1 snapshot remains
verbatim; only this navigation metadata is synchronized in #35.
