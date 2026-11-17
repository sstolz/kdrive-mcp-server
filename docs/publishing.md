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

`1.0.0` is prepared for publication through the gated workflow (#6).
Publication and the stable image digest are pending.

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

The following preflight matrix applies in `release-check`:

| Kind   | Phase                      | npm                                                                                                                                            | GHCR                                                               |
| ------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Beta   | verify dry                 | 404 is allowed; otherwise readable versions/time and candidate absent                                                                          | Candidate HEAD 404                                                 |
| Beta   | verify real / image        | Candidate absent from versions/time; deprecated placeholder latest                                                                             | Candidate HEAD 404                                                 |
| Beta   | npm                        | Same real npm preflight; publish with beta                                                                                                     | Candidate HEAD 200                                                 |
| Stable | verify dry or real / image | 200, readable versions/time, candidate absent, exact deprecated placeholder latest; candidate above every published version except placeholder | Candidate and latest GET 404                                       |
| Stable | npm                        | Same stable npm preflight; publish with latest                                                                                                 | Candidate and latest GET indexes each hash to RELEASE_IMAGE_DIGEST |

For either kind, a non-placeholder npm `latest` or any stable version key in
`versions` or `time` refuses publication: see #91 (F-024 v4). Resetting `latest`
cannot reopen the gate. Stable ordering includes published betas, compares
numeric components as exact integers and ignores build metadata. Ignore only
`created` and `modified` in `time`; reject other non-SemVer keys in either
object. Beta retains its existing unordered candidate checks before stable.

Stable image builds parse the exact top-level `containerimage.digest` from
buildx JSON metadata. The line `release-image: image digest sha256:<hex>`
identifies the pushed package version. The workflow passes `image_digest` as
`RELEASE_IMAGE_DIGEST` only to `publish-npm`'s release-check and read-back's
release-verify. Stable verify/image input digests must be empty; stable npm
preflight and read-back require a lowercase SHA-256 digest. Beta accepts an
empty or valid digest and does not compare it.

Read-back retries npm up to 20 times, 15 seconds apart. Stable requires the
candidate entry's exact version and its key in `time`, npm `latest` naming
that version, attestations, the tarball matching verify, and the original
`0.0.0-placeholder.0` still deprecated. The beta tag need not move. Both stable
image tags must serve valid indexes with exactly `linux/amd64` and
`linux/arm64`, each raw GET body hashing to this run's `RELEASE_IMAGE_DIGEST`.
Both require anonymous token access and anonymous HEAD 200. GET comparisons
use `application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json`;
HEAD is only an access check. Beta read-back still requires npm `beta`,
another deprecated version on npm `latest`, provenance, the verified tarball,
and its two-platform public image with GHCR latest absent or another digest.

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

### Owner-only first-stable recovery (D-4)

1. If an image was pushed but npm failed, was rejected or the second approval
   expired, confirm npm has no candidate version in either `versions` or
   `time`. Check uncertain npm publication outcomes first. Uncertain evidence
   stops recovery. Fresh verify/image preflight is **blocked: image exists**;
   phase npm can pass only with this run's digest and all unchanged gates.
2. The owner first attempts a same-run re-run of the failed `publish-npm`
   job: use "Re-run failed jobs" or that job alone, never "Re-run all jobs".
   Reuse the same image digest, with every gate checked again. GitHub may
   reuse the approval already granted to that job; the owner's re-run is
   then the publication go. Record the behavior observed at first occurrence
   in `docs/observations/`.
3. A re-run is unavailable if the re-run window expired, run evidence is
   uncertain, the run was cancelled, its artifacts are gone, or "Re-run all
   jobs" was used (verify fails because
   the image exists). Only when the same-run re-run is unavailable does the
   owner delete the GHCR candidate **package version**, identified by the
   digest in `release-image: image digest sha256:<hex>` and its exact
   `<version>` and `latest` tags. Delete the package version, not one tag:
   both tags share that digest and deletion removes both. An advanced main
   does not block the same-run re-run of the approved commit; it only blocks
   a new dispatch of the old commit (step 5).
4. Until deletion read-back confirms absence, preflight is **blocked: cleanup
   unconfirmed**. Confirm candidate and latest both GET 404. Preflight is now
   **ready: placeholder and both tags absent**, subject to all other gates.
   Uncertain image pushes require the same GET confirmation.
5. After cleanup and a new successful dry run, redispatch only while the
   commit is main HEAD. If main advanced, it is **blocked: old commit is not
   main HEAD**: prepare a patch bump on main with its own tag, go and dry run.
   Cleanup is required before either new-dispatch choice. No previous stable
   or default-tag repointing exists in this scope.
6. If npm accepted the candidate, it is **blocked for publication: see #91**.
   Never delete or republish it. If read-back was skipped, verify manually;
   if read-back failed, rerun only read-back. No new gated stable or beta
   release is available until #91. A fix commit before npm accepts 1.0.0
   forces 1.0.1; after npm acceptance this D-4 rule applies.

Once VERSION is stable, default installation becomes
`npm install -g @sstolz/kdrive-mcp-server`. Exact execution is
`npx -y @sstolz/kdrive-mcp-server@<version>`; pin an exact version. Betas remain
installable with `@beta` or an exact version. While VERSION is beta, the
existing README.md and SPEC.md beta install text stays; #6 owns those edits.
