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

## Versions

- The public beta is `0.6.0-beta.1`, then `0.6.0-beta.2` and so on. Each beta
  is published under the npm dist-tag `beta` with public access.
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

### Partial-failure recovery

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
