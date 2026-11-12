# Bounded read-only kDrive probe plan

Ticket #5 (archive issue 5).
Updated 2026-11-02. **The original init attempt returned HTTP 401; one separately
approved retry returned HTTP 200 with three projected drives. Authentication
provisioning and isolated synthetic fixture completion are fulfilled. Two closed
GET sessions first measured P/M and X, then stopped before download bytes. A third
reviewed session completed the selected R/E observations and416 control. Current
ticket/acceptance status is authoritative in the linked #5 issue.**
Read alongside the [evidence dossier](kdrive-read-evidence.md).
This is an operator recipe, not executable tooling or a product contract.
Any later ad-hoc operator needs independent safety review before authenticated
execution; this plan does not silently authorize a new credential mount.

## Initial inventory exception

Root executed the separate ignored one-off operator for exactly one GET
`/2/drive/init?with=drives` after a fresh independent operational safety
review round 2 (archived evidence `runs/5-probe-security-review-2.md`) approved its exact inputs.
The request returned HTTP 401; see the
sanitized result (archived evidence `runs/5-read-probes-1.md`). No inventory was obtained.
One separately authorized, receipt-preserving retry then returned HTTP 200 after
fresh independent safety review (archived evidence `runs/5-retry-security-review-1.md`) and
owner verification of the replacement credential. The
retry report (archived evidence `runs/5-init-retry-1.md`) records three accepted projections,
584 ms and 1,409 body bytes. The owner attributed the prior failure to expiration;
HTTP 401 itself did not diagnose that cause. Neither authentication checkpoint
grants an automatic child, file, root, search or content request. Separately
reviewed fixture stages below may revalidate the selected drive's admin role
with the same fixed bounded init route; unrelated inventory is discarded.

The inventory has one 8-second overall request/body deadline, a 256 KiB body
ceiling and at most 100 drive objects. It accepts only the independently reviewed
ID/role projection; no names, raw account payloads or credentials are retained.
Actual account IDs and their role mapping stay in a private ignored receipt,
outside public Git records; public reporting contains only reviewed aggregate
counts and status. Authorization is restricted to `api.infomaniak.com`, redirects
are rejected and there are no retries. The operator's credential provisioning,
parser and receipt handling were approved only for those exact operational
inputs. The retry succeeded; both exclusive receipts remain private and
preserved. No further retry or receipt deletion is authorized by this plan.

After inventory, root still selects exact permitted fixture IDs and actions.
An accessible-drive listing alone grants no fixture-probe authority and proves
neither content access nor completeness of shared/external visibility.

## Provisioning boundary

The owner has designated and provisioned the ignored credential file described
below. The owner designated the synthetic test parent privately; final fixture
membership must come from closed stage provenance outside Git. Never find,
create, print or copy a token into
source, arguments, shell history, environment dumps or logs. Read the selected
file only in the independently reviewed authenticated operator; never mount the
primary workspace into dev. Use the existing Make-driven Compose dev workflow
in a clean isolated checkout. Do not install host tools or alter Docker access.

The owner-designated primary path `.config/kdrive-token` is ignored by Git.
Ignoring a path prevents accidental publication; it grants no permission to read
it or include it in a dev bind mount. The primary workspace must stay outside
the dev mount. Root coordinates any separately reviewed, exact-file, read-only
provisioning route; do not copy the token into the safe checkout or `.env`.

The allowlist names each permitted drive/file/folder ID, allowed endpoint,
relationship, tiny binary size and expected visibility. Use stable local aliases
in published evidence; retain the private mapping outside Git. Owner approval
must explicitly include any external drive root, search scope or denied-control
ID. No init/all-drive discovery, arbitrary ID guessing, account-wide search,
recursive traversal or unlisted endpoint is permitted. If root/search would
return unrelated account data, omit that probe and leave visibility unmeasured.

Each row needs existing harmless synthetic fixtures and exact approved proof
before execution. The selected owned-fixture completion succeeded separately;
received-share, visibility and transition fixtures remain unprovided/unmeasured:

- One received-share root, immediate child and grandchild; owner-attested
  recipient relationships and independent expected metadata.
- Optional external-drive visible and nonvisible synthetic controls, including
  exact owner-approved search query/scope. A negative sample proves only itself.
- One completed owned folder with1001 observed children. Its approved canonical
  private expected-ID manifest was used to verify the measured two-page union;
  see the closed GET evidence (archived evidence `runs/5-final-get-execution-1.md`).
  No further own setup writes were planned during that bounded read window.
  No external-client pause or upstream lock is claimed; changed membership
  fails closed.
- One 16-byte binary with known bytes; optionally an empty file and an existing
  small file with an owner-managed version transition between two read sessions.
- Exact invalid-file and denied-drive controls owned/designated by the owner;
  do not guess identifiers or probe strangers' objects.

Missing fixture/access leaves that row unmeasured, without silently expanding
provisioning. The GET operator never creates, uploads, renames, shares, changes
permissions/versions or deletes. A/V/C and unprovided controls are not prerequisites
for closing #5's evidence scope once selected results and actual-main acceptance
are recorded honestly.

### Separate owner-authorized setup exception

The owner requested a clearly identified synthetic namespace under their private
designated parent, with a README marker, tiny binary and pagination entries.
Only this separate setup may create new synthetic objects; existing personal
objects cannot be overwritten, moved, renamed, shared or deleted. An acknowledged
same-run parent plus fresh complete ancestry/capabilities is required per write.
The creator (archived evidence `runs/5-fixture-setup-execution-1.md`) and
recovery (archived evidence `runs/5-fixture-recovery-execution-1.md`) stopped; their journals and
uncertain old POST remain preserved, never retrospectively successful or retried.
The separately reviewed no-retry completion retained bounded generated inputs,
30-second absolute GET/POST deadlines, 676 new requests/263 POSTs/30 minutes,
and 1494 prior requests plus 30 reserved final GETs within 2200 account requests.
No cleanup, broad discovery or received-share creation is authorized.

The closed completion (archived evidence `runs/5-fixture-completion-execution-1.md`) exited0:
263 new ACKs,538 requests,1001 reconciled children,zero retries and unchanged
prior evidence. Original0680 was not observed; a distinct spare was created.
Its fixture-stage cumulative counter is2032. This is successful provisioning,
not the final GET measurement suite or a claim that the old uncertain POST can
never complete later. No further own setup writes are planned; no cleanup is
authorized and unrelated-client changes cannot be ruled out.

Final GET approval requires the closed three-stage digest binding: stopped
creator, stopped recovery, separately successful completion. Original/recovery/
completion ACKs and any read-only observed-after-timeout member remain distinct.
No pending/unknown write can become write authority. Root's start/end source and
closure observations are not cryptographic process attestation or another
client's pause. The closed-input builder (archived evidence `runs/5-final-get-execution-1.md`)
created the private binding and manifest after local approval, then obtained
exact-invocation approval. The first two read sessions stopped; the
focused final session (archived evidence `runs/5-remaining-read-probes-execution-2.md`) completed
its selected samples. No further account request is planned by this evidence work.

### Selected evidence and unavailable inputs

Use the ignored, blank private fixture manifest template at the local-only path
`artifacts/5-probes/fixture-manifest.template.md` in the isolated checkout. It is
absent from Git and published documentation; it grants no requests and is not
fixture evidence. Supply private mappings outside Git, never credentials:

- Exact IDs, aliases, allowed endpoints and explicit permission for each selected
  row, including any external root, search scope and denied/absent control.
- Shared-root/child/grandchild relationships and independently expected metadata;
  visible/hidden control expectations where those optional rows are selected.
- Closed owned-fixture provenance, canonical expected-ID set and bounded read window;
  known 16-byte binary and independent expected bytes for range/ETag samples.
- Optional owner-managed version transition and two explicit read windows;
  redacted nonsecret scope-option labels for scope evidence.

The owner already selected the destination and synthetic-read scope; no new
manual ID entry or permission is required for those same-run acknowledged
fixtures. Their private mapping is derived only after closed successful completion
and independent input review. Missing A/V/C/control/scope evidence stays
unmeasured; it does not authorize another provisioning project. Init success
alone still authorizes no fixture measurement.

## Execution envelope

Use only GET over HTTPS to `api.infomaniak.com`, with paths/queries from the
approved private allowlist. Send authorization only to that API host. The first
operator refused all redirects. A separately reviewed exception for the selected
tiny binary allowed at most one302 hop to one lowercase ASCII label under
`.download.kdrive.infomaniakusercontent.com`, HTTPS443, no userinfo/fragment/IP
literal, public IPv4 pinned at lookup, default TLS hostname verification and
fresh tokenless headers. No bearer/cookie forwarding, arbitrary URL, second hop,
signed-URL persistence or broader destination is permitted. Any future change
still needs independent review; the chosen host class is not a provider guarantee.

Per session: at most **30 requests**, one in flight, at least one second between
starts, a **120-second** overall deadline and **10 seconds** per request including
body reading. No automatic retries. Stop the session on unexpected 401/403, 429,
5xx, network timeout, budget exhaustion, malformed responses or unexpected data.
Expected denied-control 401/403 ends that row after its one recorded sample.
Do not log remote bodies, error descriptions, URLs containing identifiers,
headers outside the allowlist below or stack traces that contain input values.

Stream with a counter; never call unbounded `json()`, `text()` or `arrayBuffer()`.
Cap total received response-body bytes at **8 MiB**, every JSON response at
**2 MiB**, every error body at **8 KiB**, every download response at **16 bytes**,
and total download bytes at **64 bytes**. Count bytes before parsing or keeping
them; abort once a cap would be exceeded and mark the row inconclusive. A valid
but oversized 1000-entry page does not justify raising the cap during a run.
Keep raw response bytes only in transient process memory, never files or logs.

Request these minimum JSON projections where the API supports them; otherwise
parse only the bounded response in memory and emit an allowlisted summary:
status, field presence/types, object counts, boolean comparisons and alias-based
relationships. Do not preserve account names, paths, IDs, recipients, content,
opaque cursors or ETags. Cursor values are used in memory only for the same
allowlisted folder; encode with URLSearchParams and never treat them as URLs.
For equality checks retain values in memory and publish equality booleans only.
Validate observed IDs against the private fixture manifest before interpreting
membership; unexpected IDs stop the row and are not published.

Permitted response summaries: HTTP status; normalized MIME type; numeric
Content-Length/Content-Range; Accept-Ranges; ETag presence and stability booleans;
presence/parsed numeric Retry-After; result counts; duplicate counts; cursor
presence/equality; has_more boolean; whitelisted error codes. Do not persist
Location, Set-Cookie, authorization, request IDs or arbitrary header values.
If a server ignores Range and sends 200, abort immediately after headers without
reading the body; report unsupported/inconclusive, never buffer the full file.

## Request recipes and observations

All paths are relative to `https://api.infomaniak.com`. Braced names are approved
private fixture inputs, never literal IDs to guess. Historical methods are probe
candidates, not normative guarantees. Record any rejected parameter honestly.

| Row                | GET recipe                                                                                                                                                                                                    | Maximum requests | Required observation                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — ancestry       | `/3/drive/{external}/files/{fixture}?with=path,parents,capabilities` once for each approved shared-root, child and grandchild ID; one list of the shared root and one exact fixture-scoped search if approved | 5                | Parent alias chain, shared-root inclusion/exclusion and depth; recipient-path relationship booleans; capabilities as booleans. Never infer missing ancestry.                                                                  |
| V — visibility     | Approved external root metadata/list and exact query under approved synthetic scope; one direct known-hidden control                                                                                          | 4                | Which predeclared aliases appear and whether hidden control is refused. Stop on unrelated entries; no global completeness claim.                                                                                              |
| P — pages          | `/3/drive/{drive}/files/{folder}/files?limit=1000`, then identical parameters plus opaque `cursor` from the first response                                                                                    | 2                | Counts, has_more and cursor presence; intersection count and union equality with private expected-ID set. If two pages are not terminal, mark incomplete; do not walk further.                                                |
| M — owned metadata | `/3/drive/{drive}/files/{binary}?with=path,parents,capabilities` for the acknowledged synthetic binary only                                                                                                   | 1                | Identity/drive/size and namespace/owner-parent comparison booleans, field presence/types/counts; missing ancestry stays unqualified, identity mismatch blocks content. Never derive new targets or call this shared ancestry. |
| R — ranges         | `/2/drive/{drive}/files/{binary}/download` with `Range: bytes=0-0`, `bytes=7-9`, `bytes=15-15`, then `bytes=16-16` for a known 16-byte binary                                                                 | 4                | 206 and exact Content-Range/length/known-byte comparison for valid ranges; exact observed outcome for the unsatisfiable range. Do not assume 416 or a particular error envelope.                                              |
| E — stable ETag    | Repeat the first R request for the unchanged binary; compare with its prior header                                                                                                                            | 1                | ETag present/absent and equality; weak marker presence. Stable samples do not prove a version guarantee.                                                                                                                      |
| C — changed ETag   | Two one-byte GETs around a separately owner-managed transition of the same approved small fixture                                                                                                             | 2                | Owner attestation of transition plus body/version equality and ETag equality booleans; unchanged/absent ETag remains a limitation. No conditional-request claim.                                                              |
| X — errors         | One designated invalid file metadata GET, one designated inaccessible-drive metadata GET, one approved folder list with `limit=5000`                                                                          | 3                | Actual status and whitelisted code/nested validation code; never save description/context or assume historical statuses.                                                                                                      |

The selected canonical P/M/R/E/X-invalid-limit suite originally used at most nine GETs and
six successful download bytes. A/V/C, invalid-file/denied-drive controls and scope
options remain unmeasured. The sanitized record (archived evidence `runs/5-final-read-measurements-1.md`)
now records P/M and X422; two stopped sessions consumed8 starts without download
bytes. The reviewed-host continuation reached CDN206 but header parsing refused;
its actual cause remains unknown. The focused final session did not repeat X:
freshM,validR0/7-9/15,E0,then unsatisfiableR16 last,at most11 starts within22
reservation; it used11 of those starts. Length/range/body/known-byte proof stayed strict. Optional ETags are
bounded opaque memory with shape/syntax/equality booleans only; nonstandard tags
leave standard ETag semantics unqualified. The measured tags had shape other and
compared equal, not standard syntax. Expected400/416/422 errors may have nonJSON
bodies under the8KiB cap; the final416 was text/html with no body/code. M still
requires JSON. Details and all three session outcomes are in the sanitized record.
The full optional table totals at most 22 API requests including the two C samples,
with 6 successful download bytes before C (up to 8 total). Each permitted download
redirect adds a separate destination attempt: up to five for R/E and two for C,
so this recipe table can require up to29 HTTP attempts. All API and destination
attempts count toward the shared30-attempt ceiling. The table grants no execution
authority for C or other unavailable rows, extra discovery or retries.
Pagination is measured only for the children route;
other routes, cursor expiry and concurrent modifications remain unmeasured.
The R unsatisfiable response uses the error-body cap regardless of error MIME,
within the aggregate body cap; successful download bodies retain the 16-byte cap.
Do not perform C until the exact transition and two read windows are provisioned.

Scope options are recorded from owner-supplied nonsecret labels/screenshots with
all account identifiers removed, outside this authenticated request table.
No browser login, token creation, revocation or acquisition is delegated. Token
comparisons require independently provisioned credentials and a fresh bounded
session, without claiming that `drive` is read-only. Probe only approved GETs
even when capabilities permit writes. Do not seek a maximum download/upload size
through increasing-size requests; those limits stay unknown here.

## Publication and follow-up

Publish a manually inspected allowlisted summary only: UTC date, row, GET path
template, fixture alias, status, request count, byte/time caps, equality/count
results, source class, limitations and affected ticket from the dossier. Report
aborted/blocked rows separately from observed outcomes. Do not save a real
response as a fixture. Use the invented examples for application tests and keep
their synthetic labels. Independent review checks the operator and sanitized
report; the orchestrator owns any later API/product contract decision.
