# Repository bootstrap — issue #1

Status: root initialization verified; draft PR #23 exists; documentation CI
exception approved. Settings and final acceptance remain pending; issue #1 is
open. Administrative scope only; no feature is frozen.

Repository: [sstolz/kdrive-mcp-server](https://github.com/sstolz/kdrive-mcp-server).
Ticket: #1 (archive issue 1).

## Authorization and narrow exception

The user replied “ok go” to this specific next-step proposal:

> La suite est le ticket #1 : initialiser le dépôt et mettre en place le fonctionnement par branches et PR. Ensuite viennent le socle documentaire (#2), puis le squelette TypeScript et la CI (#3).

That authorizes administrative initialization and the branch/PR contribution
path. An unborn `main` cannot be the base of a PR. The exception is therefore
limited to **one initial root commit containing only `README.md` on `main`**,
with the independently reviewed minimal content in the workspace. Executed
message: `chore(repo): initialize repository (#1)`.

This is the only direct-main operation covered. It does not authorize product
implementation, a feature-spec freeze, repository visibility changes, secret
handling, publication, release, branch deletion, or any subsequent direct-main
commit. The existing French product documents stay unchanged. Their import and
the English governance baseline belong to a reviewed PR for #2.

### Approved documentation CI exception

The user subsequently replied “ok good on peut avancer” after the explicit
proposal to allow the documentation-only PRs for #1 and #2 to proceed without
project CI, which arrives with #3. The orchestrator records that reply as
approval of this limited exception and continuation.

For documentation-only #1 and #2, merge requires an independent `approve` and
successful local document, link and content checks. No absent CI is described
as green. CI is mandatory from #3 onward. This grants no product-spec freeze,
product-code authorization, direct-main write or release exception. Settings
limitations stay recorded and keep their #1 acceptance criteria pending.

## Verified execution and tool limits

The pre-initialization connector snapshot reported a private repository with
`admin`, `maintain` and `push` permissions, configured default name `main`, size
0 and `branches=[]`. It described an unborn branch, not the current state.

The orchestrator executed the reviewed README-only root creation and read back
the resulting branch, commit, tree and content on 2026-11-01:

- `main`: `8d6f56acf07e9e5cc4021f9baa36f49bdb44034e`.
- Root commit (archive commit `8d6f56acf07e`): zero parents.
- Complete tree: `7c1c404d848a304071f4c60f8c239b64c2344c9c`; sole path `README.md`; not truncated.
- README blob: `a6ac0907a2ba39326849059fe3e185fcc4e25adf`; content matches the independently reviewed file.
- Branch protection flag: `false`. Settings changes: none.

Sanitized evidence source: `/tmp/kdrive-p01-bootstrap-evidence.json`; the durable
snapshot is the acceptance record (archived evidence `runs/P-01-acceptance-1.md`). The earlier
independent procedure review is recorded locally at
`runs/P-01-bootstrap-review-1.md` (`approve`); it is not included in this PR and
does not attest to later execution or settings. This updated record still
requires independent review.

Local checkout remains uninitialized: the workspace has no `.git`, `gh` is
absent, and the environment protects `.git`. No local history was created.

The connector can create a file in the default branch using the Contents API;
its branch creation needs an existing commit and commit creation needs a parent.
GitHub documents the initial file/Contents API path for an empty repository in
[its Git database API guide](https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-your-git-database).
The connector has no repository-settings mutation tool. Native Chrome later
rendered the cached General settings page and the orchestrator disabled merge
commits; API read-back verified `allow_merge_commit=false`. Further navigation
and reload were unreliable or blank; subsequent optimistic UI toggles did not
persist. Only that verified partial change is credited. The final settings
snapshot for this update is below; configuration acceptance remains pending.

## Contribution settings

Current values below are the orchestrator's final API-verified continuation
snapshot for this update. This supersedes the historical root-init snapshot's
no-settings-change state. Desired settings remain targets where not achieved.

| Setting                        | Current evidence                                                       | Desired state                                                                                                                                              |
| ------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visibility                     | Private                                                                | Remain private                                                                                                                                             |
| Default branch                 | `main` exists at `8d6f56acf07e9e5cc4021f9baa36f49bdb44034e`            | Keep `main`                                                                                                                                                |
| Squash merging                 | `allow_squash_merge=true`                                              | Enabled; use squash for every PR merge                                                                                                                     |
| Merge commits                  | `allow_merge_commit=false`, changed through native UI and API-verified | Disabled                                                                                                                                                   |
| Rebase merging                 | `allow_rebase_merge=true`                                              | Disabled                                                                                                                                                   |
| Auto merge                     | `allow_auto_merge=false`                                               | Remain disabled                                                                                                                                            |
| Update branch option           | `allow_update_branch=false`                                            | Enable if available; updates use merge, never rebase                                                                                                       |
| Protection/rulesets for `main` | Branch `protected=false`; rulesets not independently verified          | Require PRs, disallow force pushes/deletion and unreviewed bypass where supported                                                                          |
| GitHub required approvals      | No required-review rule verified; no second identity verified          | Optional enforcement: require one GitHub approval only if selected and an eligible second identity exists; independent review remains mandatory regardless |
| Required status checks         | No project CI yet                                                      | Add exact stable check names after #3 creates and runs CI; never mark absent CI green                                                                      |

For private repositories, protection availability depends on the account plan;
the plan is unknown. See [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches).
No collaborators have been verified. Independent sub-agent review produces a
review report, not a different GitHub identity: connector writes use `sstolz`,
which cannot approve its own PR. An independent sub-agent `approve` satisfies
AGENTS' independent-review requirement. A second GitHub identity is needed only
if GitHub required-approval enforcement is selected/configured; it is not an
additional unconditional merge requirement. Do not claim that enforcement until
account capabilities and an eligible second identity are verified.

If settings cannot be changed through available tools, record the exact gap and
keep the relevant #1 criteria pending. A documented manual PR/review policy does
not establish GitHub-enforced protection. CI follows under #3; that prerequisite
does not authorize skipping future product gates.

Minimum UI configuration to perform and verify when Settings is usable:

- **Settings → General → Pull Requests:** leave squash merging enabled; disable
  merge commits and rebase merging; keep auto merge disabled. The optional
  update-branch control can be enabled for merge-based branch updates.
- **Settings → Branches → Branch protection rules**, or **Settings → Rules →
  Rulesets:** target `main`, require pull requests, restrict bypass and disallow
  force pushes/deletion where the plan supports it. Verify the resulting rule
  against `main`; do not infer enforcement from saving a form.
- Under the applicable branch rule, configure an independent required approval
  only after an eligible second GitHub identity is established. Add required CI
  checks only after #3 provides actual check names and successful runs.

These paths describe intended controls. Only disabling merge commits has been
verified; do not credit unpersisted toggles or change visibility to obtain controls.

## Administrative PR and approved sequencing

Pre-PR snapshot: `feat/1-repository-bootstrap` has been created from root commit
`8d6f56acf07e9e5cc4021f9baa36f49bdb44034e`. Committing the two administrative
records and creating/reading back their draft PR are pending at this snapshot.
The planned PR contained exactly `docs/repository-bootstrap.md` and
`runs/P-01-acceptance-1.md`. README is already on `main` and is not part of this
diff. Existing project/governance imports remain reserved for #2. This snapshot
does not claim a PR or merge; later publication does not change its timing.

Continuation snapshot supplied by the orchestrator: draft
PR #23 (archive PR 23) exists on
`feat/1-repository-bootstrap` at head
`f302aada47d0b9ddcb66f9fdef5962e6f6777e39`; `main` remains at root commit
`8d6f56acf07e9e5cc4021f9baa36f49bdb44034e`. These SHAs precede the commit of
this record update. No merge is claimed.

The #1 → #2 → #3 sequence originally left CI unavailable for the first two
documentation PRs. The approved exception above resolves that CI ordering gap
only for documentation-only #1 and #2. Review and local checks remain required
before marking this draft ready and merging. CI remains mandatory from #3.
Settings enforcement is still pending; merging these records does not complete
those settings or close #1. Settings gaps do not block merging this administrative
record under the approved exception; final #1 acceptance awaits configuration
or explicit acceptance of its limitations. After PR #23 merges, local #2 drafts
may advance; no new PR is opened while its hard dependency remains unresolved.
A sub-agent may supply the independent `approve`;
a second GitHub identity is needed only if required-review enforcement is
selected/configured, not as an additional unconditional approval step.

## Execution and validation

1. Completed for root initialization: obtain independent administrative review.
   Immediately before writing, read repository branches and root contents again.
   If any base commit or unexpected file has appeared, stop the root-init action
   and adapt to the existing history; never overwrite or reset it.
2. Completed: create only `README.md` using the connector's default-branch Contents create
   operation, with no existing-file SHA and no arbitrary target branch. No other
   workspace file, credentials, local machine data or product code enters this
   exceptional commit.
3. Completed: read back `main`, its tip commit and the complete root tree. Record the SHA
   and verify that the root commit has zero parents and exactly `README.md`
   matching the reviewed content. A successful request alone is not acceptance.
4. Pending: establish the local checkout from the verified remote history without replacing
   existing workspace files or blindly staging the workspace. If tooling cannot
   do that safely, leave local setup pending and use supported connector branches.
5. Branch and draft PR created: `feat/1-repository-bootstrap`, PR #23, at the
   continuation-snapshot head above. Commit the updated two-file records to that
   same branch after independent review. Do not import the existing
   product/governance corpus here. Apply independent approval and local checks
   under the approved documentation CI exception before merging.
   Preserve one ticket/branch/PR after the root-init exception; subsequent work
   is exclusively through branches and reviewed PRs against `main`.
6. Pending: configure the supported settings above and read them back, or record each
   unavailable setting and reason. Keep current, desired and unknown distinct.
   Record review evidence and actual check results; there is no project CI yet,
   so no “green CI” claim is valid. Resolve any blocker to the administrative
   merge explicitly rather than labeling a missing check successful.
7. After independent approval, successful local documentation checks and an
   authorized squash merge, check #1 acceptance on `main` and
   record resulting SHAs/settings/limitations. Do not close #1 as fully accepted
   while a required configuration/verification item remains blocked. Proceed to
   #2's reviewed documentation import, then #3's independently reviewed feature
   spec and explicit human freeze before tests or code. Leave branches intact
   unless deletion is separately authorized.

## Failure handling

- If a create request times out or returns an uncertain result, read branches,
  commit and contents before retrying; do not create a second root commit.
- If a file already exists, a branch appeared, permissions fail or the returned
  tree differs, stop and preserve the actual state for the orchestrator. No
  force push, reset, deletion or corrective direct-main commit is permitted.
- If a required setting cannot be established, report that pending item. If
  optional GitHub approval enforcement is selected but lacks an eligible second
  identity, report that conditional limitation; do not invent an extra actor
  requirement. Do not invent protection, approvals or CI results.

## Project evidence

The user confirmed that the issues are visible in the linked Project:

> je les vois dans le projet car j'ai fait le lien entre le projet le repo

This is user-confirmed membership in Project 1 (archive project board),
not API verification. The connector has no Projects management capability. No
Project mutation or API membership verification is claimed by this procedure.
