# kdrive-mcp-server

> **Beta: the interface may change before 1.0.** Tool names, parameters,
> settings and outputs can still change between beta versions.
>
> **Unofficial project, not affiliated with Infomaniak.** It is distinct from
> the `@infomaniak/mcp-server-kdrive` npm package.

An [MCP](https://modelcontextprotocol.io) server that gives AI clients
controlled access to an Infomaniak kDrive. A client can browse, search and read
files under the folders you configure; in `write` mode it can also create,
rename, move, trash, restore and upload. Every call goes through a policy
(configured roots, deny patterns, received-share rules) and every write is
recorded in an audit log before and after it is sent.

**Status:** development version `0.1.0` ([VERSION](VERSION)). No release has been
published yet, so you build the image or the package from this repository.
Changes are listed under [Unreleased](CHANGELOG.md#unreleased).

## What it offers

- **Three modes**, cumulative: `read` (default), `write`, `share`. Today `share`
  adds nothing beyond `write`; sharing tools are planned.
- **Two transports:** stdio for a local client, and authenticated Streamable
  HTTP (OAuth proxy) for a remote connector.
- **Scoped access:** only configured drives and root folders are visible; deny
  patterns hide paths; items shared with you are off unless you opt in.
- **Bounded results:** reads, downloads and listings have size, item and time
  limits; names, paths and file content are returned as untrusted data.

## Install

Prerequisites:

- an Infomaniak API token for kDrive, from an account with the **admin** role on
  every drive you configure (startup checks this);
- Docker with Compose and GNU Make 3.81 or later to build from this repository;
- for the packaged CLI only: Node.js 26.13 or later (26.x).

Build from a checkout of this repository:

```sh
make setup        # build the development container and install dependencies
make image        # container image: kdrive-mcp-server:runtime-<arch>
make pack         # npm package: artifacts/kdrive-mcp-server-0.1.0.tgz
```

`make image IMAGE_PLATFORMS=linux/amd64` builds one architecture only. Nothing
is pushed to a registry. To use the CLI on your machine, install the package
with `npm install -g artifacts/kdrive-mcp-server-0.1.0.tgz`; it provides the
`kdrive-mcp-server` command. `kdrive-mcp-server --help` and `--version` need no
configuration.

## Configure

Settings come from, in priority order: CLI options, environment variables, one
YAML file selected with `--config PATH`, then defaults. No `.env` file is read.
The essential settings:

| Environment variable        | Purpose                                                                                                                      | Default            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `KDRIVE_TOKEN_FILE`         | Absolute path of a file holding the kDrive API token (preferred). `KDRIVE_TOKEN` passes it inline.                           | —                  |
| `KDRIVE_ID` / `KDRIVE_IDS`  | One drive ID, or a comma-separated list whose first entry is the default drive.                                              | —                  |
| `KDRIVE_MCP_MODE`           | `read`, `write` or `share`.                                                                                                  | `read`             |
| `KDRIVE_MCP_ROOTS`          | Root folders per drive, by ID or path, for example `7:42,8:/Documents`. Must cover every configured drive.                   | folder 1 per drive |
| `KDRIVE_MCP_DENY`           | Comma-separated path patterns to hide, for example `/Private/**`. Case-sensitive; see [Limits and risks](#limits-and-risks). | none               |
| `KDRIVE_MCP_AUDIT_LOG`      | `stderr` or an absolute file path for the write audit log (`write` and `share` modes).                                       | `stderr`           |
| `KDRIVE_MCP_SHARED_WITH_ME` | `1` to read items other users shared with you (`0` or `1`).                                                                  | `0`                |
| `KDRIVE_MCP_TRANSPORT`      | `stdio` or `http`.                                                                                                           | `stdio`            |

Never put a token in a CLI argument or in the YAML file. Size limits
(`KDRIVE_MCP_MAX_READ_BYTES`, `KDRIVE_MCP_MAX_OUTPUT_CHARS`, …), the HTTP and
OAuth settings, every CLI option and YAML key, defaults, bounds and error codes
are in the [configuration reference](features/F-002-configuration.md). A
configuration or startup failure prints one line,
`Configuration error [<code>] (<setting>).`, and exits 1.

## Connect an AI client

### Local client (stdio)

Most desktop clients and coding assistants start local MCP servers from a JSON
configuration of this shape (see your client's documentation for the file
location):

```json
{
  "mcpServers": {
    "kdrive": {
      "command": "kdrive-mcp-server",
      "env": {
        "KDRIVE_TOKEN_FILE": "/home/me/.config/kdrive/token",
        "KDRIVE_ID": "123456",
        "KDRIVE_MCP_ROOTS": "123456:/Documents",
        "KDRIVE_MCP_MODE": "read"
      }
    }
  }
}
```

The server speaks MCP on stdin and stdout and writes its own diagnostics to
stderr.

### Remote connector (authenticated HTTP)

For web and mobile clients, run the container image behind a TLS reverse proxy.
The server acts as an OAuth proxy in front of an OpenID Connect provider (for
example Infomaniak's) and only accepts the subjects or emails you allow.

1. Register an OAuth client at your provider with the redirect URI
   `<MCP_PUBLIC_URL>/oauth/callback`, for example
   `https://mcp.example.com/mcp/oauth/callback`.
2. Provision three secret files: the kDrive token, the upstream client secret,
   and an EC P-256 signing key in PKCS#8 PEM (the server never generates one).
3. Start from [examples/compose.yaml](examples/compose.yaml) (environment and
   Compose secrets behind Traefik) or [examples/config.yaml](examples/config.yaml)
   (YAML alternative). The key settings:

   ```yaml
   KDRIVE_MCP_TRANSPORT: http
   OAUTH_MODE: proxy
   MCP_HTTP_HOST: 0.0.0.0 # inside the container only
   MCP_PUBLIC_URL: https://mcp.example.com/mcp
   OAUTH_ISSUER: https://login.example.com # your OIDC provider
   OAUTH_UPSTREAM_CLIENT_ID: <client id>
   OAUTH_ALLOWED_EMAILS: you@example.com
   OAUTH_ALLOWED_REDIRECT_URIS: https://claude.ai/api/mcp/auth_callback
   ```

4. In the client, add a custom connector with the URL `MCP_PUBLIC_URL`. The
   client registers itself, you log in at your provider, and the server checks
   your identity against the allowlist.

`OAUTH_ALLOWED_REDIRECT_URIS` lists the callback URLs of the clients you use;
the [client compatibility matrix](docs/mcp-client-compatibility.md) gives them
for common clients. Operator details (signing key, redirect matching, restart
behaviour, reverse proxy) are in the [OAuth proxy notes](docs/oauth-proxy.md)
and the [deployment guide](docs/deployment.md), which walks through a personal
server installation step by step. In `write` and `share` modes a
file audit log needs a writable mount, and `stop_grace_period` must be at least
75 s so in-flight writes can record their outcome.

## Tools

Item metadata has exactly `drive_id`, `id`, `name`, `type` and `path`.

Read tools (all modes):

| Tool                    | Purpose                                                                        |
| ----------------------- | ------------------------------------------------------------------------------ |
| `kdrive_list_drives`    | List the configured drives.                                                    |
| `kdrive_list`           | List a folder's children, with optional `type` filter and continuation.        |
| `kdrive_info`           | Metadata of one item.                                                          |
| `kdrive_resolve_path`   | Find an item by its path.                                                      |
| `kdrive_search`         | Search names under the roots or one folder (`query` required).                 |
| `kdrive_recents`        | Recently changed items under the roots or one folder.                          |
| `kdrive_shared_with_me` | Items other users shared with you (needs `KDRIVE_MCP_SHARED_WITH_ME`).         |
| `kdrive_my_shared`      | Items you shared.                                                              |
| `kdrive_read`           | Extract text (UTF-8/16, Windows-1252), PDF text, or a PNG preview of an image. |
| `kdrive_download`       | Raw bytes as base64 chunks, continued with `offset_bytes` and `etag`.          |

Resource template: `kdrive://{drive_id}/file/{id}` returns one complete binary
file (`application/octet-stream`) when it fits the read limit.

Write tools (`write` and `share` modes only):

| Tool                   | Purpose                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| `kdrive_create_folder` | Create a folder.                                                 |
| `kdrive_rename`        | Rename an item.                                                  |
| `kdrive_move`          | Move an item to another folder of the same drive.                |
| `kdrive_trash`         | Move an item to the kDrive trash (never a permanent delete).     |
| `kdrive_restore`       | Restore a trashed item to its former parent.                     |
| `kdrive_upload`        | Upload `text` or `base64` content, new file or in-place replace. |

Each write returns `succeeded`, `failed`, `uncertain` or `denied`. After
`uncertain`, check the item with a read tool before trying again: the server
never replays an uncertain write.

Key limits:

- `kdrive_upload` accepts at most 524,288 decoded bytes; over HTTP the request
  body limit is 262,144 bytes. Use `base64` for large or non-ASCII content.
- Names given to `kdrive_upload`, `kdrive_create_folder` and `kdrive_rename`
  must be in Unicode NFC (composed form); other forms are refused with
  `INVALID_ARGUMENTS`.
- `kdrive_read` handles a conservative PDF profile only, so many valid PDFs
  return `UNSUPPORTED_FORMAT`; images are returned within 512x512 pixels.
- Listings return at most 256 items per call and continue with single-use
  cursors that expire after five minutes; downloads continue with
  `offset_bytes` and the previous chunk's `etag`.

The full read behaviour (pagination, encodings, PDF profile, bounds) is
described in [docs/development.md](docs/development.md).

## Limits and risks

The write tools exist only in `write` and `share` modes. Read
[SECURITY.md](SECURITY.md) for the full security boundary.

Tree writes (create, rename, move, trash, restore):

- This server never requests permanent deletion: `kdrive_trash` moves an item
  to the kDrive trash and no route empties the trash or deletes for good.
- `kdrive_restore` returns an item only to its former parent, and only when
  that parent is live and authorized; otherwise the restore is refused. A
  folder restore is refused while deny patterns are configured (the trashed
  tree cannot be enumerated).
- Configured roots cannot be trashed, renamed or moved.
- Received-share writes stay refused, even with `KDRIVE_MCP_SHARED_WRITE=1`.
- A check-then-act window remains (SPEC §10.6): the drive can change between
  the check and the write. If the former parent is trashed between the check
  and a restore, kDrive recreates a folder at the former path and restores into
  it; when that former parent is a configured root, the recreated folder has a
  new ID outside every configured root. If an item is trashed between the check
  and a trash request, the effect of `DELETE /2/drive/{d}/files/{f}` on the
  already trashed item is unmeasured.
- Residual risk R-17-1 (not observed on the measured server): restore
  authorizes the former parent's current path, so an item trashed under a denied
  folder that is renamed or moved out of the deny patterns outside this server
  could be restored if kDrive recomputed the trash `path`; owner acceptance on
  2026-11-10 observed a deletion-time snapshot, so such a restore was denied.
- Residual risk R-17-2: the root protection covers only a configured root
  targeted directly. With nested roots, trashing, renaming or moving an
  authorized folder of an outer root that contains an inner configured root
  also affects that inner root, and with deny patterns the trashed folder
  cannot be restored through this server.

Upload (`kdrive_upload`):

- `overwrite:false` (the default) asks kDrive to refuse an existing file of
  the same name (`conflict=error`). That refusal is observed kDrive behaviour
  (9 of 9 measured samples, checked when the upload completes), not a
  guarantee of this server. Names are case-sensitive.
- `overwrite:true` requires `file_id`, the existing file called `name` in
  `parent_id`; its content is replaced in place under the same ID. An existing
  file whose name is not NFC must be renamed to its NFC name before it can be
  overwritten.
- An `uncertain` upload is never replayed; check the file with a read tool
  before any new attempt.
- Received-share uploads stay refused, even with `KDRIVE_MCP_SHARED_WRITE=1`.
- The 524,288-byte bound applies to the decoded bytes, while the transport
  limit (1 MiB stdio frame, 262,144-byte HTTP body) applies to the
  JSON-encoded request. `text` that JSON escaping enlarges can be refused by
  the transport below 524,288 bytes: over HTTP the request gets HTTP 413; over
  stdio a frame above 1 MiB terminates the server with `STDIO_INPUT_FAILED`.
  An upload already in flight completes and its outcome is recorded in the
  audit log before exit, but its tool result is not delivered.
- Residual risks R-18-1 to R-18-5: the `conflict=error` refusal is not proven
  under every interleaving (R-18-1); between the check and a replace the target
  can change, giving `uncertain`, an undetected deny-pattern rename, or
  `succeeded` for a destination moved or trashed out of the configured roots
  (R-18-2);
  kDrive stores a file named like an existing folder under another name, not
  checked against the deny patterns (R-18-3, accepted); kDrive's own version
  history decides whether replaced content is kept (R-18-4); untested name
  rewriting by kDrive could store a file at an unchecked path, reported
  `uncertain` for upload and folder creation but `succeeded` for rename
  (R-18-5). Details: [SECURITY.md](SECURITY.md) and
  [docs/development.md](docs/development.md#upload).

Deny patterns:

- Patterns match full, case-sensitive paths. `/private/**` covers the folder
  and everything below it; `/private` matches only that exact path.
- Patterns match the exact stored code points. Write the NFC form of a
  non-ASCII pattern to cover names these tools create, and keep (or add) the
  stored form for any existing item whose name is not NFC; replacing a
  working NFD pattern by its NFC form alone would drop the deny for those
  items, reads included.

Audit log: each write gets one JSON line before it is sent and one after; if
the first cannot be written, nothing is sent. Records hold IDs, never names,
paths, content or secrets. With `stderr`, records are only as durable as what
collects stderr; use a file for a durable trail.

## More documentation

- [SECURITY.md](SECURITY.md): security boundary and how to report a
  vulnerability.
- [Configuration reference](features/F-002-configuration.md),
  [deployment guide](docs/deployment.md), [OAuth proxy notes](docs/oauth-proxy.md).
- [Publishing](docs/publishing.md): package and image names, versions and the
  release gate.
- [Development notes](docs/development.md): building, checks, quality gates and
  feature history, until the developer documentation exists.
- Contributors follow [AGENTS.md](AGENTS.md) and [PROJECT.md](PROJECT.md).
  This project is developed with AI coding agents under the maintainer's
  direction and review; see AGENTS.md.

## License

Original project code uses the [MIT license](LICENSE). [NOTICE](NOTICE) records
the upstream comparison baseline and dependency licensing.
