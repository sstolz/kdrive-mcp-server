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

The following stable procedure is proposed by F-024 v3 (#89). It becomes
operative only after implementation and acceptance. The accepted beta
procedure remains in [F-024 v2 D-8](../features/history/F-024-v2.md#decisions).

1.0.0 is the first stable release. It publishes directly to both defaults.

- Stable: npm latest; GHCR <version> and latest
- Beta: npm beta; GHCR <version> only

From the first stable release, use:

```sh
npm install -g @sstolz/kdrive-mcp-server
npx -y @sstolz/kdrive-mcp-server@<version>
```

Pin an exact version. Betas remain installable with @beta or an exact version.
A beta after stable must be greater than the stable npm `latest`, such as
`1.1.0-beta.1` after `1.0.0`. It never moves either stable default.
Only `0.0.0-placeholder.0` is the placeholder. It stays deprecated.
A deprecated stable npm `latest` requires owner recovery before publication.
A stable candidate must exceed every published version except that exact
placeholder, including betas, and the current npm `latest`, under SemVer
precedence. `0.0.0` is refused. Image tags can move; pin images by digest.

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
   again, then the image push. The proposed v3 build writes a buildx metadata
   file and exports `containerimage.digest` as job output `image_digest`.
3. `publish-npm`, in the `release` environment (second approval): the checks
   again, then the npm publish through trusted publishing (OIDC) with
   provenance, after comparing the tarball digest with `verify`. In v3,
   phase `npm` rechecks npm conditions on the prior `latest` and requires
   both stable GHCR tags to equal this run's image digest. It does not
   repeat pre-push GHCR checks.
4. `read-back`: reads the npm package and the image back, checks provenance,
   the tarball digest, both platforms and anonymous pulls, and prints the
   image digest. In v3, both stable tags must equal the image job output
   passed as `RELEASE_IMAGE_DIGEST`; equal tags from another run fail.

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

This is the proposed v3 owner procedure, based on
[F-024 v2 D-8](../features/history/F-024-v2.md#decisions). Rehearse it against
local doubles before any real run. Agents never perform registry deletion.
The image is pushed before npm. npm versions cannot be reused.

If npm reports failure, first establish whether it accepted the exact version.
If it did, never publish it again. Verify manually when `read-back` was
skipped because its dependency failed. Rerun only `read-back` when that job
failed. Check provenance, exact tarball digest, placeholder deprecation,
platforms, anonymous access and this run's manifest digest. A new dispatch
of a published npm version fails preflight by design.

For image-only publication, including a rejected or expired second approval,
a failed npm preflight, or a failed image push that left a tag, proceed as
follows. The owner records the previous npm default and its verified image
digest before cleanup. Uncertain or unavailable registry evidence stops work.

1. Confirm npm does not contain the candidate in either `versions` or `time`.
   The exact-version request must return 404, and the package request must
   return 200 with readable objects. A failed command is not proof of absence.
   `verify` and `image` preflight still fail while the GHCR candidate exists.
   A same-run `publish-npm` retry is possible only while both stable tags
   equal that run's digest and every other gate still passes.
2. If retry is unavailable, the owner deletes only the GHCR candidate tag
   through the registry's owner controls. Do not delete a shared manifest
   digest or another version. Confirm candidate GET returns 404. Preflight
   still fails if `latest` names the partial image.
3. The owner repoints GHCR `latest` to the verified prior stable digest, or
   deletes GHCR `latest` if npm still names the exact placeholder. Confirm
   with GET that `latest` and the prior stable tag hash to that prior digest,
   or that `latest` returns 404 for the placeholder. Candidate stays 404.
   Registry preflight now passes if all other gates pass. If cleanup cannot
   preserve other version tags, stop for owner recovery.
4. Redispatch only while the release commit is main HEAD. Obtain a new green
   real dry-run dispatch for the same version and SHA before real dispatch
   and both approvals. If main advanced, the old SHA still fails BR-361.
   Prepare a patch bump on main, with its own tag, owner go and dry-run gate.
   The cleanup in steps 2 and 3 is required for either route. The new candidate
   must pass all ordering checks. No automatic cleanup occurs.

Use these exact read-only checks. Set `version` to the candidate and
`previous` to the recorded prior npm stable version, when one exists. No
credentials are printed. The GHCR token is anonymous and pull-only. Keep
transient responses outside the repository. Run this block in Bash.

```sh
version='<version>'
previous='<previous-stable-version>'
check_dir=$(mktemp -d)
accept='application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json'
curl --silent --show-error --output "$check_dir/npm-version.json" --write-out '%{http_code}\n' "https://registry.npmjs.org/@sstolz%2Fkdrive-mcp-server/$version"
curl --silent --show-error --output "$check_dir/npm-package.json" --write-out '%{http_code}\n' 'https://registry.npmjs.org/@sstolz%2Fkdrive-mcp-server'
jq --arg v "$version" '{latest: .["dist-tags"].latest, versionsHas: (.versions | has($v)), timeHas: (.time | has($v))}' "$check_dir/npm-package.json"
curl --fail --silent --show-error --output "$check_dir/token.json" 'https://ghcr.io/token?service=ghcr.io&scope=repository:sstolz/kdrive-mcp-server:pull'
pull_token=$(jq -er '.token' "$check_dir/token.json")
for tag in "$version" latest "$previous"; do
  curl --silent --show-error --header "Authorization: Bearer $pull_token" --header "Accept: $accept" --output "$check_dir/$tag.json" --write-out "$tag %{http_code}\n" "https://ghcr.io/v2/sstolz/kdrive-mcp-server/manifests/$tag"
done
```

Require `versionsHas` and `timeHas` to be false; independently confirm both
fields are objects and `latest` is the recorded default. Skip the previous
tag request when that default is the placeholder. Only hash bodies from
200 responses, after validating their index media type and platform entries.
The exact digest check for each 200 response is:

```sh
sha256sum "$check_dir/$version.json"
sha256sum "$check_dir/latest.json"
sha256sum "$check_dir/$previous.json"
```

Prefix the printed hash with `sha256:` to compare it with the recorded buildx
`containerimage.digest`. Never hash a 404 error body as an image. HEAD-only
digests are never used. All compared tags use GET and the same Accept list.
After step 2, require candidate 404. After step 3, require latest 404 for the
placeholder, or two 200 bodies equal to the prior stable digest. During npm
phase and release read-back, require both stable 200 bodies equal to this
run's digest. An anonymous HEAD may separately check public access.
