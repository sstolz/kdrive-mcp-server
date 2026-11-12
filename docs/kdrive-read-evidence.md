# kDrive read API evidence dossier

Ticket: #5 (archive issue 5).
Evidence cut-off: 2026-11-02. Status: the original bounded init attempt returned
HTTP 401; one separately approved retry returned HTTP 200 with three projected
drives. Authentication provisioning and separately authorized isolated synthetic
fixture completion are fulfilled. A first GET session measured P/M, then stopped
on a302 download redirect without following it. A separately reviewed remainder
measured X422/M200, then refused CDN206 before any download body. A focused third
session completed the known ranges and opaque-header repeat, plus an empty HTML416.
All outcomes and limits are recorded below; the linked issue is authoritative for
ticket status and actual-main acceptance.
This is evidence for later specifications,
not an implemented adapter, accepted access policy or complete API qualification.

The [probe plan](kdrive-read-probe-plan.md) defines safe bounded follow-up work.
The [synthetic examples](fixtures/kdrive-read-probes.synthetic.json) are invented;
they are neither account responses nor observations. The original French
[2026-10-31 observations](api-notes.md) remain unchanged and authoritative only
for their stated samples. Two separately approved init requests occurred on
2026-11-02: the original rejection and the successful receipt-preserving retry.

After fresh operational approval (archived evidence `runs/5-probe-security-review-2.md`), root
executed one GET `/2/drive/init?with=drives` at `2026-11-02T06:44:12.877Z`.
It returned 401 in 1,196 ms, outcome `http-error`, with zero retained body bytes.
Make exited 2 and the inner operator exited 1; that execution made no retry or
follow-up call.
The sanitized live report (archived evidence `runs/5-read-probes-1.md`) records exact inputs and
limits. No inventory or account payload was retained. The reason for rejection
was not diagnosed by the response. The owner later attributed it to expiration
and reported replacing the token; this is owner attribution, not a measured
cause or scope proof.

After fresh retry safety approval (archived evidence `runs/5-retry-security-review-1.md`), separate
owner verification and root authorization, one fixed GET at
`2026-11-02T08:52:00.735Z` returned **200**, outcome `ok`, in **584 ms** with
**1,409 body bytes** and **three** accepted ID/role projections. Make exited 0.
The retry report (archived evidence `runs/5-init-retry-1.md`) records the command, reviewed inputs,
authorization and limits. Actual IDs/roles remain in its ignored exclusive
receipt; no private identifiers or raw response are published. This establishes
only successful bounded projection for this route and sample. Content, scope
options, fixture relationships and all remaining measurements remain unmeasured.

## Evidence classes

| Label                  | Meaning                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| Historical observation | A claim attributed to the 2026-10-31 notes; not rerun here.                                           |
| Public source          | Official documentation or client implementation inspected on 2026-11-02; not a live server guarantee. |
| Synthetic              | Deliberately invented input/output example for future tests; not a measured result.                   |
| Unmeasured             | No suitable live evidence; downstream work must retain this uncertainty.                              |

The initial authentication measurements are the two 2026-11-02 init outcomes above. The successful
retry is a bounded live observation, distinct from the historical, public-source
and synthetic evidence below; it proves no other current provider behavior.

## Selected synthetic observations

The owner designated a private parent and authorized a conspicuously named new
synthetic namespace. This is a narrow operational fixture-setup exception, not a
product write capability or permission to change existing personal data. Writes
are confined to newly acknowledged owned objects; overwrite, rename, move, share,
cleanup and deletion are excluded. Fixed init requests inside these separately
reviewed setup stages revalidate only the selected drive's admin role; they do
not authorize new account discovery or additional read targets.

The creator stopped (archived evidence `runs/5-fixture-setup-execution-1.md`) on an uncertain POST
for one synthetic child; it was never retried. A distinct
recovery stopped (archived evidence `runs/5-fixture-recovery-execution-1.md`) on a fresh metadata
GET before its next POST. Both outcomes remain stopped. A further completion
used the owner-selected no-retry proposal (archived evidence `runs/5-fixture-completion-no-retry-proposal-1.md`)
after fresh safety approval (archived evidence `runs/5-fixture-completion-security-review-3.md`).
It completed (archived evidence `runs/5-fixture-completion-execution-1.md`), Make/inner exit0,
starting `2026-11-02T12:47:06.948Z`, observed closed at `12:57:01Z`.
Its final operational reconciliation recorded **1001 pagination children**:
679 original,59 recovery and263 completion ACKs. Old uncertain0680 was not
observed or retried; a distinct spare was created. No cleanup is authorized.
The receipt records538 new requests/263 POSTs,2,328,483 received bytes,
6,049 uploaded bytes,zero range bytes/retries, current-admin confirmation and
successful prior-evidence end checks. The fixture-stage cumulative counter is2032.
These are provisioning observations, not final P/M/R/E/X qualification. The
subsequent GET-only operator still requires closed, digest-bound provenance and
fresh source/actual-input approval; fixtures alone do not qualify read behavior.
Its local binding/manifest preparation (archived evidence `runs/5-final-get-execution-1.md`)
succeeded after local builder approval and exact-invocation approval. Its first
GET result below is stopped; invocation approval never relabels the result.

The final sanitized measurement record (archived evidence `runs/5-final-read-measurements-1.md`)
keeps two stopped sessions and the independently reviewed
successful compatibility session (archived evidence `runs/5-remaining-read-probes-execution-2.md`)
distinct. The latter ran11 attempts in11142ms,1697 body bytes/six download bytes,
five tokenless destination attempts, Make0/inner0 and unchanged bound evidence.
The earlier generic206 refusal's header cause remains undiagnosed: current
nonstandard ETags do not reconstruct the discarded earlier response.

| Row | Bounded question                                                             | Current result                                                                                                                                     | Affected tickets                          |
| --- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| P   | Two-page owned-child membership, duplicates and termination                  | HTTP200 pages1000+1,zero duplicates,exact union and terminal completeness true                                                                     | #9                                        |
| M   | Owned binary identity, path/parents/capabilities and known namespace anchors | HTTP200,three parents,both anchors/path suffix/read gate true; owned metadata only                                                                 | #6, #7                                    |
| R   | Tiny known-binary range/status/length observations                           | API302→storage206 for0-0/7-9/15-15,exact known bytes and total16,Content-Length1/3/1;16-16 returned416,text/html,empty body                        | #10, #14                                  |
| E   | ETag presence/weak marker/equality on an unchanged synthetic binary          | Repeated known first byte; opaque ETag present/bounded,shape other,equal true,standard syntax false; no standard conditional/version qualification | #10, #14                                  |
| X   | Invalid-limit sample on the owned synthetic folder                           | Second session422,232 bytes,code validation_failed; validation-details presence false                                                              | #9; remaining controls affect #6, #7, #10 |

The separately reviewed remaining-read plan (archived evidence `runs/5-remaining-read-probes-plan-1.md`)
executed X independently before content; the focused M/R/E session did not repeat
it. No further account request is planned. Fixture accounting totals2051
requests:2032 provisioning plus4+4+11 read attempts;19 of30 reserved read attempts
were used. The two earlier standalone init samples are separate. Official
[domain guidance](https://www.infomaniak.com/en/support/faq/1751/discover-the-official-domains-used-by-infomaniak)
identifies the provider content domain; official
[kDrive guidance](https://www.infomaniak.com/en/support/faq/1822/troubleshooting-kdrive-issues-antivirus-firewall-etc)
names its subdomains. Our smaller single-label download-host allowlist is a
chosen restriction, not a provider guarantee. No bearer token may cross the hop.

Received-share ancestry A and external visibility V remain **unmeasured** (#6,
#7, #9); an owned parent chain is not a received-share sample. Changed-version
ETag C remains **unmeasured** (#10, #14). Current token-scope options/comparisons
remain **unmeasured** (#6, #7), as do absent/denied controls, maximum sizes,
account-wide/search completeness, cursor expiry/concurrent mutation and rate
ceilings. No additional fixture-provisioning project is implied. Ticket #5 permits
explicit unknowns; downstream specifications must retain these limits.

## Public source recheck

The official [Infomaniak MCP client](https://github.com/Infomaniak/mcp-server-kdrive/blob/8e94da2bdd73a2c028e7df0432bd8212f22ee9c1/src/kdrive-client.ts)
is pinned at commit `8e94da2bdd73a2c028e7df0432bd8212f22ee9c1`
(committer date 2026-10-27). Its public raw source was fetched without credentials
inside Compose dev on 2026-11-02: HTTP 200, 8,023 bytes, SHA-256
`23b5ac246329729614d3dddf55355b33abd1d9a2a81e61140260f89f7f134873`.
This is the upstream MCP server's client implementation, not a separate SDK.
No implementation was copied into this project.

| Operation       | Method and path used by that client                                                            |
| --------------- | ---------------------------------------------------------------------------------------------- |
| Metadata        | GET `/3/drive/{drive_id}/files/{file_id}`                                                      |
| Children        | GET `/3/drive/{drive_id}/files/{file_id}/files`; optional `cursor`                             |
| Search          | GET `/3/drive/{drive_id}/files/search`; `query`, limit 10, optional `directory_id` and `depth` |
| Received shares | GET `/3/drive/{drive_id}/files/shared_with_me`                                                 |
| Download        | GET `/2/drive/{drive_id}/files/{file_id}/download`                                             |

The shared-with-me route differs from the unscoped route that succeeded in the
historical sample. Neither source settles current behavior for another account.
The client fully buffers downloads and supplies no range/version safety proof.

The official [API reference](https://developer.infomaniak.com/docs/api),
[metadata route](https://developer.infomaniak.com/docs/api/get/3/drive/%7Bdrive_id%7D/files/%7Bfile_id%7D),
[children route](https://developer.infomaniak.com/docs/api/get/3/drive/%7Bdrive_id%7D/files/%7Bfile_id%7D/files)
and [download route](https://developer.infomaniak.com/docs/api/get/2/drive/%7Bdrive_id%7D/files/%7Bfile_id%7D/download)
were opened on 2026-11-02. The text reader returned no readable parameter or
response tables. Therefore this recheck establishes no current normative page
size, range semantics, ETag semantics, size maximum or rate limit. The indexed
[accessible-drives reference](https://developer.infomaniak.com/docs/api/get/2/drive)
names `/2/drive`, which the historical bare request reported as 422; parameters
and current behavior remain unverified. No private API or account UI was opened.

The upstream [setup guidance](https://github.com/Infomaniak/mcp-server-kdrive/blob/8e94da2bdd73a2c028e7df0432bd8212f22ee9c1/README.md)
names the `drive` scope. The official
[token-management guide](https://www.infomaniak.com/en/support/faq/2582/add-and-manage-infomaniak-api-tokens)
says creation selects an application and scope. This proves neither a
`drive:read` scope nor token-level folder/drive restrictions. Owner-reported UI
options and appropriately provisioned token experiments are still needed.

## Measurement ledger and downstream consequences

All historical rows below refer to GET-only samples on 2026-10-31 in
[api-notes.md](api-notes.md), using the stated `drive` scope. The notes do not
provide a complete timestamped request/response transcript or fixture manifest.
Their original HTTP status detail is preserved here without filling gaps.

| Question              | Existing evidence and limits                                                                                                                                          | Unmeasured follow-up                                                                                                            | Affected tickets                               |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Shared-child ancestry | Historical: shared root had depth 1, empty parents and recipient `/Shared/…` path. Child ancestry explicitly unmeasured; status not individually recorded.            | Metadata/list/search ancestry for allowlisted child and grandchild, including missing/incomplete parents.                       | #6 (archive issue 6), #7 (archive issue 7)     |
| External visibility   | Historical: external root metadata/list/search returned 200; one root listing entry. This does not prove search excludes all unshared items.                          | Compare only predeclared synthetic visible/hidden controls. Bounded samples cannot prove account-wide absence.                  | #6, #7, #9 (archive issue 9)                   |
| Pagination            | Historical: limit 1000 accepted (success status unspecified); 5000 returned 422 `validation_rule_max`; cursor/has_more envelope noted. No >1000 traversal.            | Existing 1001–2000-entry frozen fixture, two 1000-item pages, duplicate/union/termination checks; search separately unmeasured. | #9                                             |
| Range and size        | Historical: two files, GET download with `bytes=0-0`, 206, byte Content-Range, MIME/size coherent with metadata.                                                      | Nonzero/end/unsatisfiable ranges on tiny known binary; ignore-range behavior; maximum size remains unknown.                     | #10 (archive issue 10), #14 (archive issue 14) |
| ETag                  | Historical: Etag present in one-byte download responses; value stability/change not recorded.                                                                         | Repeat stable-version ranges and owner-managed version transition; conditional-request semantics if independently approved.     | #10, #14                                       |
| Scope                 | Historical: `drive` token saw personal, kSuite and external drives; share capabilities included writes. Public setup also names `drive`.                              | Owner-reported exact current scope choices and controlled token comparisons; no claim of unavailable fine-grained scopes.       | #6, #7                                         |
| Errors                | Historical: nonexistent ID 404 `object_not_found`; inaccessible drive 401 `not_authorized`; invalid parameter 422 `validation_failed` with nested validation details. | Repeat only owner-designated invalid/denied controls; preserve status versus code and absent fields.                            | #6, #7, #9, #10                                |
| Rate limits           | Historical: no rate/limit headers and no 429 in about 30 calls. No rate ceiling established.                                                                          | Record headers if naturally returned; never load-test or deliberately provoke 429.                                              | #9, #10, #14                                   |

An Infomaniak token scope governs upstream API authority. The server's configured
drive IDs, roots, denies, received-share opt-in and operation level are separate
planned policy boundaries. A broad token does not authorize this server to
expose everything it can read. Common/team folders remain distinct from received
external shares. Current accepted configuration and injected preflight do not
implement these future access-policy checks.

Maximum download size, upload size, global visibility, search completeness,
cursor expiry/concurrent mutation behavior, rate ceiling, weak/strong ETag
semantics and conditional range support remain unknown. No single successful
range or source-code example establishes any of these properties. Upload/write
qualification belongs to #16 (archive issue 16)
under separate authorization.

## Completion and record ownership

Ticket #5 is evidence work, not full provider qualification. Unprovided cases may
remain explicitly unmeasured; they do not by themselves prevent evidence-scope
acceptance. Selected P/M/R/E/X observations are recorded; actual-main acceptance
and current delivery status are maintained in the linked #5 issue. A merge alone
does not establish acceptance. Each final sanitized entry names date, method, endpoint
template, status, bounded sample size, observed limits, fixture alias and affected
ticket for every actual observation. Retain unknowns when the relevant sample is
missing. Never replace the historical notes or synthetic labels with inferred
success. Product specifications still need their own reviewed contracts. The
historical PR #40 documentation-only acceptance (archived evidence `runs/5-pr40-acceptance-1.md`)
remains separate from final #5 acceptance and its future actual-main SHA.

Earlier documentation work synchronized public #35 post-acceptance records:
acceptance (archived evidence `runs/35-acceptance-1.md`),
independent review (archived evidence `runs/35-pr-review-1.md`),
actual-main checkout (archived evidence `runs/35-main-checkout-1.md`),
document checks (archived evidence `runs/35-main-doc-check-1.md`) and
normalization proof (archived evidence `runs/35-sync-normalization-1.md`).
Those reports describe their original operations and are not new #5 test runs.

Earlier documentation work also recorded the separately authorized local branch-cleanup
plan (archived evidence `runs/BRANCH-CLEANUP-plan-1.md`),
independent review (archived evidence `runs/BRANCH-CLEANUP-review-1.md`) and
acceptance record (archived evidence `runs/BRANCH-CLEANUP-acceptance-1.md`).
These are administrative records: four local branches were deleted with their
histories archived; nine remote candidates remain blocked by the available
deletion capability and were not deleted. This bookkeeping establishes no
additional #5 measurement or product acceptance.
