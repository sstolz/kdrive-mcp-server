# Publishing

This page records the names, versions and rules for publishing this project's
npm package and container image. Owner decisions of 2026-11-12, ticket #2.
Nothing has been published yet.

## Names

| Artifact    | Name                                 | Status                                                  |
| ----------- | ------------------------------------ | ------------------------------------------------------- |
| npm package | `@sstolz/kdrive-mcp-server` (scoped) | Chosen; the package still uses the old name (see below) |
| Command     | `kdrive-mcp-server`                  | Unchanged                                               |
| GHCR image  | `ghcr.io/sstolz/kdrive-mcp-server`   | Chosen                                                  |

Both artifacts belong to the maintainer's GitHub account `sstolz`, which owns
this repository. The npm scope `@sstolz` belongs to the npm account that
publishes the package.

**Why a scoped name.** On 2026-11-12 the unscoped name `kdrive-mcp-server` was
free on the npm registry, but `kdrive-mcp` and `@infomaniak/mcp-server-kdrive`
(under the `@infomaniak` scope) already existed. A scoped name cannot be refused
as too similar to an existing name, and it sets this project apart from those
packages. Publishing a scoped package publicly needs `npm publish --access
public`.

**Pending change.** `package.json` still uses the name `kdrive-mcp-server`, which
BR-016 v1 fixes. The move to the scoped name comes with the publication
specification of #2, which versions BR-016.

## Versions

- The public beta is `0.6.0-beta.1`, then `0.6.0-beta.2` and so on. Each beta
  is published with `npm publish --tag beta --access public`. The npm registry
  points `latest` at the first version of a new package and later `--tag beta`
  publishes do not move it, so until 1.0.0 is published under `latest`,
  `latest` points to the first beta (`0.6.0-beta.1`), which may be stale:
  install `@sstolz/kdrive-mcp-server@beta` or pin the exact version.
- The image gets the same version tag. A beta never gets the `latest` tag.
- `1.0.0` is the first stable release (#6).

## Release gate

- Only the owner's explicit go for a given version and commit authorizes a
  release ([AGENTS.md](../AGENTS.md) §7). A build or a tag alone never
  publishes anything.
- Before a release, the records are synchronized, `CHANGELOG.md` Unreleased is
  promoted, `VERSION` is updated and the tag `v<version>` is created.
- The image is published for `linux/amd64` and `linux/arm64`.
