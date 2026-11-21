# Publishing

This page records the names, versions and rules for publishing this project's
npm package and container image, and the release workflow that publishes them.
Owner decisions of 2026-11-12, ticket #2; contract
[F-024](../features/F-024-gated-publication.md).

## Names

| Artifact    | Name                                 | Status    |
| ----------- | ------------------------------------ | --------- |
| npm package | `@sstolz/kdrive-mcp-server` (scoped) | In use    |
| Command     | `kdrive-mcp-server`                  | Unchanged |
| GHCR image  | `ghcr.io/sstolz/kdrive-mcp-server`   | Chosen    |

Both artifacts belong to the maintainer's GitHub account `sstolz`, which owns
this repository. The npm scope `@sstolz` belongs to the npm account that
publishes the package. The command and the MCP server-info name stay
`kdrive-mcp-server`.

**Why a scoped name.** On 2026-11-12 the unscoped name `kdrive-mcp-server` was
free on the npm registry, but `kdrive-mcp` and `@infomaniak/mcp-server-kdrive`
(under the `@infomaniak` scope) already existed. A scoped name cannot be refused
as too similar to an existing name, and it sets this project apart from those
packages. Publishing a scoped package publicly needs `--access public`.

**Name re-check before 1.0 (2026-11-16).** On the npm registry,
`@sstolz/kdrive-mcp-server` is this project's package (`beta` → `0.6.0-beta.2`,
`latest` → the deprecated placeholder), and the unscoped `kdrive-mcp-server` is
still free. Related npm packages exist: the official
`@infomaniak/mcp-server-kdrive` (1.2.0), which README names in its
non-affiliation notice, and the third-party `kdrive-mcp` and
`infomaniak-mcp-agent`. On GitHub, a repository search finds
`Infomaniak/mcp-server-kdrive` and third-party `infomaniak-mcp` and
`infomaniak-mcp-agent` repositories. None uses this project's name. Recheck on
the day of the 1.0 publication.

## Versions

`1.0.1` is the current stable release (#118), published on 2026-11-20 (see the
record under [1.0.1 publication](#101-publication-118)). The image index digest
is `sha256:58a37c17549e8e161a112ea2b93d1d8cf7196bc926ed3e6d2032b310dac6b051`.
`1.0.0` (#6), published on 2026-11-17, stays installable by its exact version
(see [First stable publication](#first-stable-publication-f-024-v3-89)); its
image index digest is
`sha256:6f14301d4e9b0c4cd7c2f39b45f15c9b1222e92879ee10ea1131d06dac806708`.

- The public beta was first `0.6.0-beta.1`; the current published beta is
  `0.6.0-beta.2` (2026-11-15).
  Each beta is published under the npm dist-tag `beta` with public access.
- `latest` points at the deprecated placeholder `0.0.0-placeholder.0` until
  1.0.0 is published under `latest`: a beta publish never moves it. Users
  install `@sstolz/kdrive-mcp-server@beta` or an exact version.
- The image gets the same version tag. A beta never gets the `latest` tag.
  Image tags can be overwritten, so pin the image by the digest that the
  release read-back prints.
- `1.0.0` is the first stable release (#6).

## Release gate

- Only the owner's explicit go for a given version and commit authorizes a
  release ([AGENTS.md](../AGENTS.md) §7). A build or a tag alone never
  publishes anything.
- Before a release, the records are synchronized, `CHANGELOG.md` Unreleased is
  promoted, `VERSION` is updated and the tag `v<version>` is created.
- The image is published for `linux/amd64` and `linux/arm64`.

## Release workflow

`.github/workflows/release.yml` runs only on a manual dispatch with the inputs
`version`, `sha` and `dry_run` (default `true`). Its jobs:

1. `verify`, without write permission: `make release-check` (inputs, commit,
   tag, `main`, CI evidence, registries, `release` environment protection),
   `make release-setup` (`npm ci --ignore-scripts`), `make pack`,
   `make release-npm` as an npm dry run, and `make release-image` as a build
   of both platforms without push. It uploads the tarball and passes its
   SHA-256 to the later jobs.
2. `publish-image`, in the `release` environment (first approval): the checks
   again, then the image push.
3. `publish-npm`, in the `release` environment (second approval): the checks
   again, then the npm publish through trusted publishing (OIDC) with
   provenance, after comparing the tarball digest with `verify`.
4. `read-back`: reads the npm package and the image back, checks provenance,
   the tarball digest, both platforms and anonymous pulls, and prints the
   image digest.

With `dry_run=true` only `verify` runs. The release is dispatched from `main`
while the release commit is `main`'s HEAD (otherwise BR-361 refuses it because
`GITHUB_SHA` differs). A green real `dry_run=true` dispatch of the same version
and commit is required, and its run link recorded, before any `dry_run=false`
dispatch. Agents never dispatch with `dry_run=false` and never approve a
`release` deployment; the owner does both.

### GitHub Release

The release workflow publishes only to npm and GHCR; it creates no GitHub
Release. Once a `dry_run=false` run has succeeded, read-back included, create
the GitHub Release on the existing tag `v<version>`, titled `v<version>`, with
that version's `CHANGELOG.md` section as notes. Never create it before
read-back passes. The owner creates it, or an agent does on the owner's go for
that version, and the release ticket records it.

```sh
# Notes: the CHANGELOG.md section of <version>, without its heading.
gh release create v<version> --verify-tag --title v<version> --notes-file <notes> --latest
# Beta instead: --prerelease --latest=false
gh release list --limit 3
```

`gh release list` must show the stable release as `Latest`, or the beta as
`Pre-release`.

### Owner preconditions

In this order: P-0, P-1, P-4, P-2 and P-5 before the first non-dry-run
dispatch; P-3 during or after the first non-dry-run run.

- **P-0** Before the first real release, the owner publishes once, by hand
  from their own machine with npm 11.5.1 or later, the placeholder
  `@sstolz/kdrive-mcp-server@0.0.0-placeholder.0`: no code, only a
  `package.json` (`name` `@sstolz/kdrive-mcp-server`, `version`
  `0.0.0-placeholder.0`, the `repository` of this project, no `bin`, no
  `scripts`) and a README that says it is a placeholder and points to the
  repository, in an otherwise empty directory. From that directory, exactly:

```sh
npm login
npm publish --access public --tag latest
npm deprecate @sstolz/kdrive-mcp-server@0.0.0-placeholder.0 "Placeholder, not a release. Install @sstolz/kdrive-mcp-server@beta."
npm view @sstolz/kdrive-mcp-server dist-tags.latest
npm logout
```

The `npm view` command must print `0.0.0-placeholder.0`. No npm token is
ever stored in GitHub.

- **P-1** The npm account owns the `@sstolz` scope and has a trusted publisher
  for `@sstolz/kdrive-mcp-server`: provider GitHub Actions, repository
  `sstolz/kdrive-mcp-server`, workflow file `release.yml`, environment
  `release`. Then the package's publishing access is set to "Require
  two-factor authentication and disallow tokens".
- **P-4** The repository is public before P-2 and before the first
  non-dry-run dispatch (environment protection rules and npm provenance need
  it).
- **P-2** The repository environment `release` exists with a required
  reviewer naming the owner, a custom deployment branch policy that is
  exactly the branch `main`, and no environment secret or variable.
  "Prevent self-review" stays off. `release-check` verifies the reviewer rule
  and the branch policy in every phase.
- **P-5** A tag ruleset on `refs/tags/v*` restricts creation, update and
  deletion to the owner, or at least blocks update and deletion.
- **P-3** The first non-dry-run run creates the GHCR package
  `kdrive-mcp-server`, private by default; the owner sets it to public and
  keeps this repository's Actions write access to it. P-3 is done after the
  first image push and is verified by `read-back` (its `image is public (P-3)`
  check); after setting the package public, re-run only the failed
  `read-back` job.

### Beta partial-failure recovery (F-024 v2 D-8)

The image is pushed before npm is published, because a GHCR version can be
deleted while an npm version can never be reused.

- when npm published but `read-back` failed, re-run only the failed
  `read-back` job or verify by hand with
  `npm view @sstolz/kdrive-mcp-server@<version>` and
  `docker buildx imagetools inspect ghcr.io/sstolz/kdrive-mcp-server:<version>`;
  a new dispatch of that version is refused by BR-363, as intended;
- when `npm publish` reports a failure, first check with `npm view` whether
  the registry accepted it anyway; if it did, verify the published version by
  hand with the read-back commands, and `read-back`, skipped because its
  `needs` failed, is not re-run;
- when the image is pushed but npm is not published (the second approval is
  rejected, `release-check` fails in `publish-npm`, or `npm publish` reports a
  failure and `npm view` does not find the version), re-run the `publish-npm`
  job (its `release-check` in phase `npm` expects the pushed image), or delete
  the GHCR version and dispatch again;
- when the second approval expires (GitHub cancels a run waiting 30 days and
  allows no re-run after 30 days), delete the GHCR version and dispatch again
  while the release commit is `main`'s HEAD, otherwise release the next beta;
- when the image push reports a failure and GHCR does not have the version,
  re-run the failed `publish-image` job or dispatch again;
- when the image push reports a failure but GHCR has the version,
  `publish-npm` never ran and npm is unpublished: the owner deletes the GHCR
  version and dispatches again, or releases the next beta;
- deleting the GHCR version and dispatching again works only while the
  release commit is still `main`'s HEAD (BR-361); otherwise the next beta is
  released.

### First stable publication (F-024 v3, #89)

Publish `1.0.0` directly under npm `latest`; there is no `next` promotion.
Stable images use exactly `<version>` and `latest` from one two-platform
build. Beta uses npm `beta` and only the image `<version>` tag.

The first stable run is historical evidence below. Current preflight and
read-back use the F-024 v4 lifecycle matrices in the next section.

Stable image builds parse the exact top-level `containerimage.digest` from
buildx JSON metadata. The line `release-image: image digest sha256:<hex>`
identifies the pushed package version. The workflow passes `image_digest` as
`RELEASE_IMAGE_DIGEST` only to `publish-npm`'s release-check and read-back's
release-verify. Stable verify/image input digests must be empty; stable npm
preflight and read-back require a lowercase SHA-256 digest. Beta accepts an
empty or valid digest and does not compare it.

GHCR `latest` is mutable and is not protected by the `release` environment
approval. Any same-repository workflow with `packages: write` can overwrite
it. Pin images by the printed manifest digest, for example
`ghcr.io/sstolz/kdrive-mcp-server@sha256:<hex>`. The image is unsigned (#92).
GHCR latest may serve the candidate before npm does, until npm publishes or
owner cleanup finishes; registries cannot switch atomically.

Each release requires the exact-version, exact-SHA go and successful real
dry run before a recovered redispatch or a new patch version too. Record
both approvals and read-back evidence in the release ticket. Agents never
re-run release jobs or touch registries.

**Record (2026-11-17).** The owner dispatched
release run 44054183190
with `dry_run=false`, version `1.0.0` and SHA
`89dc00830a363a62108ddeb45970c43d48d08cf1`. Jobs `verify`, `publish-image`,
`publish-npm` and `read-back` all succeeded; read-back reported
`release-verify: 0 of 13 checks failed`.

- npm `@sstolz/kdrive-mcp-server` dist-tags: `latest=1.0.0`,
  `beta=0.6.0-beta.2`; `1.0.0` was published with provenance.
- Public GHCR image `ghcr.io/sstolz/kdrive-mcp-server`: tags `1.0.0` and
  `latest` both resolve to OCI index
  `sha256:6f14301d4e9b0c4cd7c2f39b45f15c9b1222e92879ee10ea1131d06dac806708`
  (`linux/amd64`, `linux/arm64`).
- Evidence: [#6 comment `6-release-1-claude`](https://github.com/sstolz/kdrive-mcp-server/issues/6#issuecomment-6945806696).

Once VERSION is stable, default installation becomes
`npm install -g @sstolz/kdrive-mcp-server`. Exact execution is
`npx -y @sstolz/kdrive-mcp-server@<version>`; pin an exact version. Betas remain
installable with `@beta` or an exact version. While VERSION is beta, the
existing README.md and SPEC.md beta install text stays; #6 owns those edits.

### 1.0.1 publication (#118)

**Record (2026-11-20).** After a successful dry run (release run
44766718053), the owner dispatched release run 44802572838 with
`dry_run=false`, version `1.0.1` and SHA
`dde1e32c0401820e6330c2df493f42b9630eb9a3` (tag `v1.0.1`). Jobs `verify`,
`publish-image`, `publish-npm` and `read-back` all succeeded; read-back
reported `release-verify: 0 of 14 checks failed`.

- npm `@sstolz/kdrive-mcp-server` dist-tags: `latest=1.0.1`,
  `beta=0.6.0-beta.2`; `1.0.1` was published with provenance.
- Public GHCR image `ghcr.io/sstolz/kdrive-mcp-server`: tags `1.0.1` and
  `latest` both resolve to OCI index
  `sha256:58a37c17549e8e161a112ea2b93d1d8cf7196bc926ed3e6d2032b310dac6b051`
  (`linux/amd64`, `linux/arm64`). Tag `1.0.0` still resolves to
  `sha256:6f14301d4e9b0c4cd7c2f39b45f15c9b1222e92879ee10ea1131d06dac806708`.
- Evidence: [#118 comment `118-release-1-orchestrator`](https://github.com/sstolz/kdrive-mcp-server/issues/118#issuecomment-7059295738).

## Stable release lifecycle (F-024 v4, #91)

### SemVer and npm preflight predicates

`P` is exactly `0.0.0-placeholder.0`. Published history is the union of keys
in npm `versions` and `time`, ignoring exactly `time.created` and
`time.modified`. Both objects must be readable. Every other key must be
SemVer, even when the key occurs in only one object. `P` is excluded from
ordering only, not from the required deprecated-placeholder evidence.
Other placeholders, including `0.0.0-stage`, are ordinary published versions.

Ordering uses full SemVer precedence: compare exact unbounded integers in
major/minor/patch and numeric prerelease identifiers; numeric identifiers sort
below nonnumeric identifiers, nonnumeric identifiers use ASCII lexical order,
a shorter equal prefix sorts lower, and stable exceeds prerelease at the same
base. Build metadata never affects precedence. Registry keys may use any valid
SemVer even though candidate syntax remains stable or beta.N only.
A precedence-equal version with different build metadata still blocks when
it belongs to the candidate kind's comparison set below.

A stable candidate must exceed **every published stable version** in the
union history; prereleases do not block it. A beta candidate must exceed
**every published version**, stable and prerelease, except P (BR-431).
Malformed keys still refuse either kind before ordering. Thus stable
1.1.1 can follow stable 1.1.0 and beta 1.2.0-beta.1, but stable 1.0.1 cannot
follow stable 1.1.0. No independent stable maintenance line bypass exists.

| Published history (besides P) | Candidate             | Ordering result                                |
| ----------------------------- | --------------------- | ---------------------------------------------- |
| 1.0.0                         | 1.0.1 / 1.1.0 / 2.0.0 | Allow each stable.                             |
| 1.0.0                         | 1.1.0-beta.1          | Allow beta.                                    |
| 1.1.0, 1.2.0-beta.1           | 1.1.1                 | Allow stable; future beta does not block.      |
| 1.0.0, 1.1.0-beta.1           | 1.0.1                 | Allow stable.                                  |
| 1.1.0                         | 1.0.1                 | Refuse stable hotfix below a published stable. |
| 1.1.0, 1.2.0-beta.1           | 1.1.2-beta.1          | Refuse beta below a published beta.            |
| 1.0.0, 1.1.0-beta.1           | 1.0.5-beta.1          | Refuse beta.                                   |
| 1.0.5                         | 1.0.5-beta.1 / 1.0.4  | Refuse each candidate.                         |
| 1.0.5                         | 1.0.6-beta.1          | Allow beta.                                    |

These results cover ordering only; every other gate still applies. Because
a valid stable npm latest is the greatest stable in `versions`, every admitted
stable necessarily exceeds it. Its image publication moves GHCR latest to
the candidate's run digest, then npm publication moves npm latest to the
candidate. Bootstrap creates these defaults in the same order. There is no
admitted stable publication that leaves either latest on an older version.
Beta publication changes only npm beta and the versioned GHCR tag; npm latest
and GHCR latest stay untouched even when beta has greater precedence.

An npm default is one of:

- **Bootstrap:** latest is exactly P, P exists and has a non-empty deprecated
  string, and no stable key exists in either history object.
- **Stable:** latest is a supported plain stable version, its version entry
  records that exact version, its timestamp exists, and it is the greatest
  stable precedence among `versions` keys only. Time-only stable keys remain
  in candidate ordering but do not invalidate this default. It is
  non-deprecated, except for BR-432's stable-fix path. P still exists and
  remains deprecated.

Missing latest, latest naming a beta/unknown version, incomplete default
records, resetting latest to P after stable history, or latest behind another
stable key in `versions` fails closed. `deprecated` absent or the empty string
means healthy; a non-empty string means deprecated; a non-string value is
unreadable data.
Stable default validity does not require it to exceed next-version betas.
A `beta` dist-tag is not an ordering authority: history is authoritative.

### Registry conditions by kind and phase

All preflight rows require the unchanged commit, CI and environment gates,
candidate absent from both npm history objects, ordering above, and valid npm
default above. Those predicates run in verify, image and npm, with either
boolean value. The sole npm 404 exception remains a beta dry-run preflight
(phases verify/image/npm with dry_run=true); it gives no publication authority.
For a readable npm 200 document, beta dry-run now validates the same history
and default as real beta, including BR-431. Stable never has a 404 exception.

All manifest comparisons use SHA-256 of raw GET response bytes and this exact
Accept header on every compared reference:
`application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json`.
A valid index has exactly linux/amd64 and linux/arm64 among non-attestation
entries, retaining v3's index checks. HEAD never supplies comparison digests.
Authenticated token errors, malformed documents and unexpected statuses fail
closed. Beta candidate preflight keeps the existing HEAD checks.

| Kind   | Phase          | npm                                                                                                                                                                                                                                      | GHCR                                                                                                                                                                                                                          |
| ------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stable | verify / image | Bootstrap or stable default, including BR-432 deprecated-stable exception; candidate unpublished and above every published stable                                                                                                        | Candidate GET 404. Bootstrap: latest GET 404. Prior stable S: GET S and latest return valid indexes with identical raw-body hashes. Image publication then moves latest to this run's candidate digest.                       |
| Stable | npm            | Same npm predicate; latest still names prior default, not candidate; npm publication then moves latest to candidate                                                                                                                      | Candidate and latest GET 200, valid indexes, both hashes equal RELEASE_IMAGE_DIGEST from this run. Do not compare latest to old S here.                                                                                       |
| Beta   | verify / image | Bootstrap or healthy stable default; candidate unpublished and BR-431 ordering                                                                                                                                                           | Candidate HEAD 404; bootstrap latest absent or a different digest under the predicate below; stable S and latest GET valid indexes with equal hashes.                                                                         |
| Beta   | npm            | Same npm predicate; publish only with beta tag                                                                                                                                                                                           | Candidate HEAD 200; same bootstrap or stable-default GHCR predicate as beta verify/image; no run-digest comparison, no latest mutation.                                                                                       |
| Stable | read-back      | Candidate entry records exact version, candidate timestamp exists, latest equals candidate, candidate healthy, attestations present, tarball matches verify, P remains deprecated; beta need not move                                    | Both candidate and latest valid indexes, hashes equal this run's digest; anonymous token and HEAD 200 for both.                                                                                                               |
| Beta   | read-back      | Candidate entry records exact version and timestamp, beta equals candidate, candidate healthy, attestations and verified tarball present, P remains deprecated; latest is bootstrap or healthy greatest stable, different from candidate | Candidate valid index and anonymous HEAD 200. Bootstrap: latest absent or a different digest as in v3. Stable S: S and latest valid indexes with equal hashes, different from candidate; anonymous token and latest HEAD 200. |

npm read-back keeps 20 attempts, 15 seconds apart, and performs no mutations.
Beta's `image latest tag` check uses the final attempt's npm document to
validate the default and derive S, whether that attempt succeeds or exhausts
the loop; it never uses a document from an earlier attempt.
For every beta preflight phase, GET latest after the candidate HEAD check.
With bootstrap (also the retained npm-404 beta dry-run exception), latest
GET 404 passes. If latest GET 200, GET the candidate and require a valid index
and a raw-body hash different from latest, as in v3 read-back; an absent
candidate cannot prove a different digest, so a present latest then refuses.
With stable default S, GET S and latest and require valid indexes with equal
raw-body hashes; do not compare either to the run digest. Thus an orphaned
stable image at latest blocks beta before either publication, not only at
read-back. Beta read-back additionally requires latest different from the
published candidate, as in the table.
Beta publication argv cannot write latest; rehearsal also compares npm latest
before and after. Read-back checks the current stable mapping, not an invented
immutable cross-run snapshot: concurrent external default edits remain a risk.

### Exact diagnostics and output

Existing report prefixes, safe summaries, input failures, token/status reasons,
platform/provenance/tarball checks and exit 1 remain. These tables pin every
new or changed condition. No untrusted key, registry body, credential or
arbitrary exception text is interpolated. `<status>` is the existing numeric
HTTP status (0 for request failure). `<hex>` is 64 lowercase hex characters.

Npm preflight reports `release-check: npm version not published` for status,
unreadable data, candidate presence and ordering; it reports
`release-check: npm default` for default validity (replacing `npm placeholder`).
Each line ends in ` ok` or ` FAIL <reason>`. Determine the first history failure
in this order: status, object readability, malformed keys (versions then time),
candidate presence, ordering. Validate all keys before comparing precedence.
Default reasons use the table's order; when history is unreadable the default
reason is `npm document unreadable; refer to the owner`. GHCR stays a separate
`release-check: GHCR image` condition; other gates still report their results.

| Condition                                                                                                                     | Exact failure reason                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Missing latest                                                                                                                | `npm latest tag missing`                                                                                               |
| Latest is neither P nor a supported stable                                                                                    | `npm latest is not a supported stable default`                                                                         |
| Latest version entry/version field/timestamp missing or inconsistent                                                          | `npm latest version record incomplete`                                                                                 |
| P missing or not deprecated                                                                                                   | `original placeholder is not deprecated`                                                                               |
| P selected after stable history                                                                                               | `npm placeholder latest cannot follow stable history`                                                                  |
| Latest behind another stable key in `versions`                                                                                | `npm latest is not the greatest published stable version`                                                              |
| Deprecated stable latest for beta                                                                                             | `npm latest stable is deprecated; owner recovery required`                                                             |
| Stable ordering failure                                                                                                       | `stable version is not greater than every published stable version`                                                    |
| Beta ordering failure                                                                                                         | `beta version is not greater than every published version`                                                             |
| Invalid history key, unchanged                                                                                                | `npm versions contains a non-SemVer version key` or `npm time contains a non-SemVer version key`                       |
| Candidate present in either object, unchanged                                                                                 | `version already published on npm`                                                                                     |
| Unreadable/inconsistent types                                                                                                 | `npm document unreadable; refer to the owner`                                                                          |
| Stable npm 404, unchanged                                                                                                     | `npm registry status 404`                                                                                              |
| Candidate before image push, unchanged                                                                                        | `image already published`                                                                                              |
| Npm default invalid or unreadable, so no validated bootstrap/S is available                                                   | `npm stable default unavailable`                                                                                       |
| Bootstrap latest present in stable preflight or beta verify/image                                                             | `GHCR latest exists without a stable npm default`                                                                      |
| Beta bootstrap latest present in phase npm or read-back without a readable valid candidate index of a different raw-body hash | `latest names the release`                                                                                             |
| Prior stable S GET 404                                                                                                        | `previous stable image unavailable`                                                                                    |
| Prior stable latest GET 404                                                                                                   | `GHCR latest missing for stable npm default`                                                                           |
| Prior stable S or latest invalid index                                                                                        | `previous stable image manifest invalid`                                                                               |
| Prior stable hashes differ                                                                                                    | `GHCR latest does not match npm stable default`                                                                        |
| Stable phase npm either manifest unavailable/invalid/different                                                                | `image manifest unavailable`; `image manifest invalid`; `image digest does not match RELEASE_IMAGE_DIGEST` (unchanged) |

Before stable push and in beta default checks, unexpected GET statuses retain
`unexpected GHCR status <status>; refer to the owner`; token failures retain
`unexpected GHCR token status <status>; refer to the owner`. Check candidate
status/presence before prior-default checks, then S availability, latest
availability, index validity and hash equality. Phase npm retains v3's token
precedence and candidate-then-latest digest validation for stable. Beta uses
the same prior-stable availability/index/hash reasons in all preflight phases;
bootstrap latest GET 404 passes, while GET 200 in beta verify/image uses
`GHCR latest exists without a stable npm default`. In beta phase npm and
read-back, GET 200 without proof of a different candidate digest uses
`latest names the release`. Other bootstrap GET failures use the fixed
status/token reasons above. Stable preflight also uses
`GHCR latest exists without a stable npm default` for bootstrap latest present.

Only resolve/request S after npm latest validates as a supported plain stable
default under the npm predicates for that kind, including record completeness,
ordering among `versions`, P evidence and deprecation policy. Never construct
an S URL from an unvalidated registry key. If npm default validation fails or
the document is unreadable, report `release-check: GHCR image FAIL npm stable default unavailable`
before requesting a GHCR token; make no GHCR request at all, including the
candidate request. This takes precedence over token and candidate/default
failures. The retained npm-404 beta dry-run exception uses bootstrap checks
instead. For beta read-back, the identical invalid or unreadable default
condition reports `release-verify: image latest tag FAIL npm stable default unavailable`
without S/latest requests; other npm and candidate image checks still report
independently. Remove the blanket
`releases after the first stable are out of scope; see #91 (F-024 v4)` and
`GHCR latest already exists; first stable requires 404` from executable
code and current expectations; immutable historical snapshots keep them.
Replace the old `stable version is not greater than every published version`
reason with the stable-only reason above. A future beta alone never produces
a stable ordering failure. A valid deprecated stable default produces no
default failure for a stable fix; beta retains its deprecated-default failure.

The read-back report adds/replaces exactly the following lines; other v3
lines remain as specified in the snapshot. `<reason>` below is restricted to
the alternatives in that row; each line has either ` ok` or ` FAIL <reason>`.

| Exact condition prefix                                                               | Failure reason alternatives                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `release-verify: npm candidate not deprecated`                                       | `candidate is deprecated`; `npm document unreadable; refer to the owner`                                                                                                                                                                                                                                                                 |
| `release-verify: npm default` (beta only; replaces deprecated-placeholder line)      | All npm default reasons above, including deprecated-stable refusal; `latest names the release`                                                                                                                                                                                                                                           |
| `release-verify: npm original placeholder deprecated` (now both kinds)               | `original placeholder is not deprecated`                                                                                                                                                                                                                                                                                                 |
| `release-verify: image latest tag` (beta only, retained prefix)                      | Bootstrap: existing v3 reasons. Stable: `previous stable image unavailable`; `previous stable image manifest invalid`; `GHCR latest missing for stable npm default`; `GHCR latest does not match npm stable default`; `latest names the release`; `GHCR status <status>`; `GHCR token status <status>`; `npm stable default unavailable` |
| `release-verify: image latest is public (P-3)` (stable and beta with stable default) | `anonymous pull failed`                                                                                                                                                                                                                                                                                                                  |

Stable keeps `npm latest tag` and both `image version digest` / `image latest
digest` lines with exactly v3 reasons. Beta keeps `npm beta tag`. Both kinds
keep `npm version present` (now exact version/timestamp for beta too),
`npm provenance`, `npm tarball matches verify`, `image platforms`,
`image is public (P-3)` and `release-verify: image digest sha256:<hex>`.
Stable never emits `npm beta tag`, `npm default` or `image latest tag`.
Beta never emits run-digest comparison lines. Neither kind emits the obsolete
`npm latest is a deprecated placeholder` line. Candidate-health checks require
an existing readable version entry; absence uses the unreadable reason, not ok.

### Owner recovery procedure

This procedure requires separate owner authorization for every real mutation. Registry writes, including repointing, remain owner-only.

1. **Classify without replaying.** Read npm versions/time, candidate tarball
   and tags. If either history object contains the candidate, npm accepted
   it: never delete or republish it. Re-run only read-back or diagnose manually;
   a repair release uses a new version and all release gates. If requests or
   npm outcome are uncertain, stop with `recovery blocked: npm outcome uncertain`.
2. **Prefer the same-run npm retry.** When npm definitely lacks the candidate,
   use **Re-run failed jobs** only when it re-runs only the failed
   `publish-npm` job, with the original image digest and tarball artifact,
   all commit/CI/environment gates rechecked. Never select **Re-run all jobs**.
   Retain v3's expired-window, cancelled-run, missing
   artifact and uncertain-evidence exclusions. If a gate/approval refuses,
   state is `recovery blocked: same-run npm retry unavailable` and continue
   only to the owner cleanup choice. An advanced main does not itself block
   this same-run retry: its HEAD, ancestry and GITHUB_SHA checks still use the
   approved run's commit. It blocks only redispatch of the old commit (step 6).
   Do not rebuild a pushed candidate.
3. **Identify cleanup precisely.** Post-stable beta uses the separate cleanup
   branch in step 5 without step 4's repoint. For stable, if retry is
   unavailable, record the candidate digest from build metadata/output and confirm candidate GET
   against it. Resolve the still-current npm stable default S to its GHCR
   versioned index; record `previous_digest` from raw GET bytes and confirm
   it against the release ticket's prior read-back evidence. Require S's
   original version tag to remain present; for deletion, also require its
   index/digest to be distinct from the candidate. If only the candidate digest is unknown, but npm
   absence, unchanged valid npm default S and its prior read-back evidence
   are certain, use the restore-only branch: run step 4 with `previous_digest`
   confirmed against that evidence and GET-confirm S/latest, perform no
   deletion, burn the candidate version and use a new version for the next
   release through step 6. Restoration does not depend on candidate identity.
   Otherwise, unknown candidate digest, changed npm default,
   missing prior evidence, extra tags on the candidate package version,
   shared prior/candidate digest, or any uncertain state stops with
   `recovery blocked: image identity uncertain`. Deletion must identify the
   exact package-version ID and full tag set, never guess by tag alone.
4. **Restore before deleting.** With a prior stable S, the owner runs exactly
   one source through the following command, using the validated full digest
   and fixed repository. No annotations, append, platform filtering, file
   descriptors or rebuilding are allowed:

   Use the executable restoration block below after confirming the recorded
   evidence and supplying `previous_digest`, `S` and `GITHUB_TOKEN` locally.
   This is a single-source index copy; an older buildx that refuses
   `--prefer-index=false` blocks recovery safely. AC-46 qualified this command
   with buildx v0.38.1 on 2026-11-18 against a throwaway local registry
   (evidence on PR #102); use that version or a newer one. Before any owner recovery,
   record `docker buildx version`, exact argv, statuses, Accept header and raw
   hashes from the throwaway local-registry qualification in #91. No public
   registry write is part of that qualification. Command success alone is
   insufficient: the block GETs S and latest and validates indexes and bytes.

5. **Delete only the candidate package version.** Recheck npm absence and
   identities immediately before the owner's explicitly authorized deletion.
   Confirm candidate GET 404, S still serves the prior digest, and latest
   still serves that digest. Failed confirmation prints
   `recovery blocked: cleanup unconfirmed`. A package-version delete removes
   all tags still attached to that digest; restoration must already have
   detached latest. Never delete S. For bootstrap with no prior stable,
   retain v3 cleanup: candidate package-version deletion removes candidate
   and latest, then both GET 404. No repoint command or empty previous loop
   runs in bootstrap. Historical pre-stable beta recovery remains as in v2 D-8.
   For post-stable beta cleanup, first confirm npm candidate absence in both
   objects and record healthy S plus the equal raw GET hashes of S and latest.
   Identify the candidate package version/digest and full tag set; require
   its digest distinct from S/latest and no unexpected attached tags. After
   the owner's explicit authorization, delete only that candidate package
   version, with no latest repoint. Require candidate GET 404, npm candidate
   still absent, npm latest still S, and S/latest GET hashes unchanged from
   the recorded digest. Any failed confirmation uses `recovery blocked: cleanup unconfirmed`;
   uncertain identity stops before deletion with `recovery blocked: image identity uncertain`.
6. **Resume only through release gates.** Confirm state now passes fresh
   registry preflight. Redispatch the original version only if it is still
   unpublished, its tagged commit is main HEAD, and a new successful dry run
   and owner go exist. If main advanced, use a new version satisfying the
   ordering policy, a new tag, go and dry run. Published betas cannot block
   a stable patch above every published stable; a published higher stable
   blocks a lower-line hotfix, and a higher published beta blocks a lower
   beta. Confirm cleanup before either choice, except that the restore-only
   branch requires confirmed restoration, no deletion and a new version.
   No deletion, repoint or
   republish follows npm acceptance.

For the selected deprecated-default policy (BR-432), the owner records the
affected version, deprecation reason and intended fixed version/SHA in the release
ticket, leaves the vulnerable version deprecated, and gives the usual go and
exact-pair dry-run evidence. Stable preflight permits that default and still
requires all ordering, image, CI, provenance and approval gates. The successor
publishes with latest and read-back requires it healthy. Beta remains blocked
until a healthy stable latest exists. If no healthy earlier stable exists, this
forward-fix route still works. A deprecated old image is restored only to the
unchanged npm default during failed-fix cleanup; that restores consistency,
not a claim that the vulnerable release is safe. If ordering blocks the desired
hotfix, the stable-only ordering rule governs the version choice; deprecation
is not an ordering bypass. Do not roll back npm `latest` to a healthy older
stable during an incident: if done while the vulnerable greatest stable
remains in `versions`, npm and GHCR `latest` must first be restored to that
vulnerable greatest stable before the forward fix can ship.

If npm latest is behind a stable key still in `versions` (for example after
a manual dist-tag edit), stop publication with the pinned greatest-stable
diagnostic. The owner reconciles registry state manually
under separate authorization: restore npm latest to the greatest stable still
in `versions`, verify its exact version/timestamp and retained P evidence,
and reconcile GHCR latest to that stable's recorded versioned digest using
the byte-preserving command and GET confirmation above. A deprecated greatest
stable admits only the BR-432 forward stable fix. If records or image evidence
are unavailable, stop for owner diagnosis; no automatic fallback is allowed.
Then rerun all release gates and exact-pair dry-run/go requirements. No release
mode gains an npm dist-tag command. For any state with a valid npm default
and GHCR latest differing from S, including an unknown candidate digest,
the owner may separately authorize restore-only reconciliation to S's
recorded digest using step 4 and GET confirmation, without deleting anything;
burn any uncertain candidate version and use a new version for the next release.
If a higher stable was unpublished and is
now time-only, leave latest on the greatest remaining `versions` stable:
no npm default repair is required. If GHCR latest still names the unpublished
stable's digest, the owner reconciles it to S's recorded digest under separate
authorization using the byte-preserving command and GET confirmation above.
Choose a new candidate above the union history (for example 1.0.2 after
time-only 1.0.1); never attempt to republish it.

Guide/rehearsal success states are exactly
`recovery: registry preflight ready` (after fresh checks) and the restored
digest line above. The listed `recovery blocked:` lines are fixed guide and
harness diagnostics, not new `release-check` modes. The harness also prints
`recovery blocked: npm already accepted candidate` for the non-deletion case.

### Executable owner restoration

Supply `S` as the validated still-current plain stable npm default and
`previous_digest` from prior read-back evidence. The token grants pull access;
Docker uses the owner's existing registry login for the separately authorized
copy. Run locally with Node.js and curl available. The block does not delete
any package version. Only its confirmed result permits the separately
explicitly authorized candidate deletion in step 5.

```sh
image=ghcr.io/sstolz/kdrive-mcp-server
identity_failure() {
  printf '%s\n' 'recovery blocked: image identity uncertain'
  exit 1
}
if test "${#previous_digest}" -ne 71 ||
  ! printf '%s\n' "$previous_digest" | LC_ALL=C grep -Eq '^sha256:[0-9a-f]{64}$'; then
  identity_failure
fi
if ! printf '%s\n' "$S" | LC_ALL=C grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'; then
  identity_failure
fi
if ! docker buildx imagetools create --prefer-index=false \
  --tag "$image:latest" "$image@$previous_digest"; then
  printf '%s\n' 'recovery blocked: latest repoint failed'
  exit 1
fi
restoration_failure() {
  printf '%s\n' 'recovery blocked: latest restoration unconfirmed'
  exit 1
}
recovery_dir=$(mktemp -d) || restoration_failure
trap 'rm -rf "$recovery_dir"' EXIT
accept='application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json'
curl --config - --fail --silent --show-error \
  'https://ghcr.io/token?scope=repository:sstolz/kdrive-mcp-server:pull&service=ghcr.io' \
  --output "$recovery_dir/token.json" <<EOF || restoration_failure
user = "x-access-token:$GITHUB_TOKEN"
EOF
pull_token=$(node -e '
const fs = require("node:fs");
try {
  const token = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).token;
  if (typeof token !== "string" || !token) process.exit(1);
  process.stdout.write(token);
} catch { process.exit(1); }
' "$recovery_dir/token.json") || restoration_failure
for reference in "$S" latest; do
  curl --config - --fail --silent --show-error \
    --header "Accept: $accept" \
    "https://ghcr.io/v2/sstolz/kdrive-mcp-server/manifests/$reference" \
    --output "$recovery_dir/$reference.json" <<EOF || restoration_failure
header = "Authorization: Bearer $pull_token"
EOF
  node -e '
const fs = require("node:fs");
const crypto = require("node:crypto");
try {
  const bytes = fs.readFileSync(process.argv[1]);
  const index = JSON.parse(bytes.toString("utf8"));
  const types = ["application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json"];
  if (!types.includes(index.mediaType) || !Array.isArray(index.manifests)) process.exit(1);
  const platforms = index.manifests.map(m => `${m.platform?.os}/${m.platform?.architecture}`).filter(p => p !== "unknown/unknown").sort();
  if (JSON.stringify(platforms) !== JSON.stringify(["linux/amd64", "linux/arm64"])) process.exit(1);
  const digest = "sha256:" + crypto.createHash("sha256").update(bytes).digest("hex");
  if (digest !== process.argv[2]) process.exit(1);
} catch { process.exit(1); }
' "$recovery_dir/$reference.json" "$previous_digest" || restoration_failure
done
printf 'recovery: GHCR latest restored %s\n' "$previous_digest"
```
