# kdrive-mcp-server

> **Beta: the interface may change before 1.0.** Tool names, parameters,
> settings and outputs can still change between beta versions.
>
> **Unofficial project, not affiliated with Infomaniak.** It is not endorsed
> or supported by Infomaniak, and it is distinct from the
> `@infomaniak/mcp-server-kdrive` npm package. Infomaniak and kDrive are named
> only to describe what the server connects to.

An [MCP](https://modelcontextprotocol.io) server that gives AI clients
controlled access to an Infomaniak kDrive. A client can browse, search and read
files under the folders you configure; in `write` mode it can also create,
rename, move, trash, restore and upload. Every call goes through a policy
(configured roots, deny patterns, received-share rules) and every write is
recorded in an audit log before and after it is sent.

**Why this server.** As of November 2026, Infomaniak offers a REST API for
kDrive but no hosted MCP endpoint, and Anthropic provides no kDrive connector. Infomaniak's own
MCP server (`@infomaniak/mcp-server-kdrive`, checked at version 1.2.0) runs
over stdio only, so a remote client such as claude.ai cannot reach it. It is
bound to a single drive: it lists items other users shared with you, but its
file tools only act on that one drive, so they cannot open items that live in
another user's drive. It also has no tool to:

- read a file as text (`kdrive_read`: text files, PDF text, or a PNG preview
  of an image);
- find an item by its path (`kdrive_resolve_path`);
- list the available drives (`kdrive_list_drives`);
- list the items you shared (`kdrive_my_shared`).

This server adds:

- authenticated Streamable HTTP behind an OAuth proxy, for remote clients;
- several drives (`KDRIVE_IDS`) and opt-in reading of items shared with you
  (`KDRIVE_MCP_SHARED_WITH_ME`);
- the tools above;
- configured root folders: nothing outside them is visible;
- deny patterns (`KDRIVE_MCP_DENY`, for example `/Private/**`): matching paths
  are hidden from listings, search and reads, and cannot be written;
- an audit log of every write, recorded before and after it is sent.

Share tools are not available yet (`share` mode registers none, #20); the
official server has them.

It speaks standard MCP, so any compatible client can use it; only claude.ai
has been verified end to end so far.

**Status:** beta `0.6.0-beta.1` ([VERSION](VERSION)). The container image is
published on GHCR as `ghcr.io/sstolz/kdrive-mcp-server:0.6.0-beta.1`
(`linux/amd64` and `linux/arm64`; pin it by digest), and the npm package as
`@sstolz/kdrive-mcp-server@beta`; both went through the gated release workflow
([docs/publishing.md](docs/publishing.md)). The published beta predates the
changes under Unreleased in [CHANGELOG.md](CHANGELOG.md); build the image or
the package from this repository to get them.

<a id="quick-start"></a>

## What it offers

- **Three modes**, cumulative: `read` (default), `write`, `share`. Today `share`
  adds nothing beyond `write`; sharing tools are planned.
- **Two transports:** stdio for a local client, and authenticated Streamable
  HTTP (OAuth proxy) for a remote connector.
- **Scoped access:** only configured drives and root folders are visible; deny
  patterns hide paths; items shared with you are off unless you opt in.
- **Bounded results:** reads, downloads and listings have size, item and time
  limits; names, paths and file content are returned as untrusted data.

## Quick start (Docker)

Run the published image `ghcr.io/sstolz/kdrive-mcp-server`, configured with
[environment variables](#configure). You need Docker and an Infomaniak API
token with the kDrive scope from an account with the **admin** role on every
drive you configure (startup checks this), plus the drive ID
([Values from the Infomaniak side](#values-from-the-infomaniak-side)). For a
remote deployment, you also need Docker Compose and Traefik.

Read the published image's digest, then pull it by digest: a beta never gets
`latest`, and tags can be overwritten.

```sh
docker buildx imagetools inspect ghcr.io/sstolz/kdrive-mcp-server:0.6.0-beta.1
docker pull 'ghcr.io/sstolz/kdrive-mcp-server:0.6.0-beta.1@sha256:<digest>'
```

The examples below use the version tag for readability; replace it with the
same digest-pinned image reference after inspecting it. Paths, IDs and domains
are fake; substitute your own values.

### Local (stdio)

Your AI client launches this command itself and communicates over stdin and
stdout. Configure it under [Connect an AI client](#connect-an-ai-client).
Docker must be running and accessible to the client.

Store your token in `/home/you/.config/kdrive/token`, a regular UTF-8 file
containing only the token (a final newline is accepted). Mount it read-only at
`/run/secrets/kdrive-token`; `KDRIVE_TOKEN_FILE` is the path **inside** the
container. The image runs as UID/GID `1000:1000`, so that user must be able to
read the mounted file. On Linux, use owner `1000:1000` and mode `0400` for the
token file, with private host directories traversable by the user who launches
Docker. The file must exist before launch; do not use a symlink as the token
file or put a token in the client configuration.

```sh
docker run -i --rm \
  -e KDRIVE_ID=123456 \
  -e KDRIVE_MCP_MODE=read \
  -e KDRIVE_MCP_ROOTS=123456:/Documents \
  -e KDRIVE_TOKEN_FILE=/run/secrets/kdrive-token \
  -v /home/you/.config/kdrive/token:/run/secrets/kdrive-token:ro \
  ghcr.io/sstolz/kdrive-mcp-server:0.6.0-beta.1
```

The image starts `node /app/dist/cli.js`; stdio is the default transport, so
no command or transport argument is needed after the image name. Keep `-i`
and omit `-t` so stdin stays open without a terminal. This example exposes
only `/Documents` on drive `123456`. Start in `read` mode, check the tools
from your client, then switch to `write` only if you need it
([Limits and risks](#limits-and-risks)).

### Remote (HTTP behind Traefik with OAuth)

For web and mobile clients, use [examples/compose.yaml](examples/compose.yaml)
to run the same image behind Traefik with `KDRIVE_MCP_TRANSPORT=http`,
`OAUTH_MODE=proxy` and `KDRIVE_MCP_MODE=read`. For example, serve drive
`123456` at `https://mcp.example.com/mcp`, mounting the kDrive token, upstream
client secret and signing key as read-only secrets. Follow
[Personal server, step by step](docs/deployment.md#personal-server-step-by-step)
for the complete fake-value setup, including OAuth registration, secret-file
permissions and Traefik; its
[settings table](docs/deployment.md#settings-of-an-http-deployment) lists every
variable. Then add a [remote connector](#remote-connector-authenticated-http).

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
`Configuration error [<code>] (<setting>).`, and exits 1. For a remote
deployment, the [settings table](docs/deployment.md#settings-of-an-http-deployment)
of the deployment guide gives every HTTP and OAuth variable with its role,
whether it is required and a fake example.

### Values from the Infomaniak side

This project is not affiliated with Infomaniak; the links below go to
Infomaniak's own documentation. Menu paths are those of the Infomaniak
Manager in French at the time of writing; Infomaniak may rename them. The
[deployment guide](docs/deployment.md#2-collect-the-infomaniak-values-and-register-the-oauth-client)
describes the same steps in order.

- **API application** (needed for the token, and for the OAuth client of a
  remote deployment). In the Manager: **Utilisateurs et profils** → **Mon
  profil** → **Développeur** → **Application API** → **Créer une nouvelle
  application**. Choose the type **Application** and any name. The
  application URL field is the OAuth redirect (callback) URI. For a local
  test, enter `http://127.0.0.1:8765/callback`. For a deployment, enter `<MCP_PUBLIC_URL>/oauth/callback`, for example
  `https://mcp.example.com/mcp/oauth/callback`.
  Keep the client ID and client secret that are shown: a remote deployment
  uses them as `OAUTH_UPSTREAM_CLIENT_ID` and the client secret file.
- **API token** (`KDRIVE_TOKEN_FILE`). In the Manager: **Utilisateurs et
  profils** → **Mon profil** → **Développeur** → **Tokens API** → **Créer un
  token**. Select the application created above, the scope **drive — Produits
  Drive**, and a validity (1 day, 1 month, 6 months, 1 year or unlimited; a
  shorter validity limits the damage of a leak but needs renewal). Log in as
  an account with the **admin** role on every drive you configure. Infomaniak's
  guide:
  [Add and manage Infomaniak API tokens](https://www.infomaniak.com/en/support/faq/2582/add-and-manage-infomaniak-api-tokens);
  token list in the Manager:
  <https://manager.infomaniak.com/v3/ng/accounts/token/list>. The token is
  shown once: store it in a file only you can read, never in a CLI argument or
  a committed file.
- **Drive ID** (`KDRIVE_ID`). The number in the kDrive web app URL after
  `/kdrive/app/drive/`: for example,
  `https://ksuite.infomaniak.com/kdrive/app/drive/123456/…` gives `123456`.
  You can also list the drives your token can access with the
  [kDrive API](https://developer.infomaniak.com/docs/api) (the `/2/drive`
  routes). An example that reads the token from a file, so that it stays off
  the command line (curl reads its options from standard input):

  ```sh
  printf 'header = "Authorization: Bearer %s"\n' "$(cat ./secrets/kdrive-token)" |
    curl -sS -K - 'https://api.infomaniak.com/2/drive/init?with=drives'
  ```

  The answer lists each accessible drive with its ID and your role; the
  server's startup check uses the same route. The full response format is not
  documented here.

- **OAuth client and issuer** (`OAUTH_UPSTREAM_CLIENT_ID`, its secret,
  `OAUTH_ISSUER`; remote deployment only). With Infomaniak as the provider,
  use the client ID and client secret of the API application above and set
  `OAUTH_ISSUER` to `https://login.infomaniak.com` (no trailing slash), as
  given by [Infomaniak's discovery document](https://login.infomaniak.com/.well-known/openid-configuration).
  With another provider, register a confidential OAuth 2.0 / OpenID Connect
  application with the redirect URI `<MCP_PUBLIC_URL>/oauth/callback`. Take
  the issuer exactly as the provider's `/.well-known/openid-configuration`
  document gives it.

## Connect an AI client

The configurations below are examples in the documented formats of each
client; check your client's own documentation for the current details.
Verification status with this server:

| Client         | Local (stdio)    | Remote (HTTP, OAuth proxy)                                 |
| -------------- | ---------------- | ---------------------------------------------------------- |
| Claude Code    | not yet verified | not yet verified                                           |
| Claude Desktop | not yet verified | not yet verified                                           |
| claude.ai      | not applicable   | verified (maintainer acceptance with claude.ai on the web) |

The stdio transport itself is verified by the maintainer's acceptance runs,
but not yet through a named client. Other clients and their callback URLs
are in the [client compatibility matrix](docs/mcp-client-compatibility.md).

### Local client (stdio)

The client starts `docker run` with the same settings and read-only token
mount as the [quick start](#local-stdio). The server speaks MCP on stdin and
stdout and writes its own diagnostics to stderr. The paths and IDs below are
fake; use an absolute host path for the token file in both examples.

**Claude Code** (example; `--scope user` makes the server available in every
project):

```sh
claude mcp add kdrive --scope user -- docker run -i --rm \
  -e KDRIVE_ID=123456 \
  -e KDRIVE_MCP_MODE=read \
  -e KDRIVE_MCP_ROOTS=123456:/Documents \
  -e KDRIVE_TOKEN_FILE=/run/secrets/kdrive-token \
  -v /home/you/.config/kdrive/token:/run/secrets/kdrive-token:ro \
  ghcr.io/sstolz/kdrive-mcp-server:0.6.0-beta.1
```

**Claude Desktop** and most desktop clients (example): add the server under
`mcpServers` in the client's JSON configuration, `claude_desktop_config.json`
for Claude Desktop (see the client's documentation for the file location),
then restart the client:

```json
{
  "mcpServers": {
    "kdrive": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "KDRIVE_ID=123456",
        "-e",
        "KDRIVE_MCP_MODE=read",
        "-e",
        "KDRIVE_MCP_ROOTS=123456:/Documents",
        "-e",
        "KDRIVE_TOKEN_FILE=/run/secrets/kdrive-token",
        "-v",
        "/home/you/.config/kdrive/token:/run/secrets/kdrive-token:ro",
        "ghcr.io/sstolz/kdrive-mcp-server:0.6.0-beta.1"
      ]
    }
  }
}
```

#### Alternative: installed npm CLI

After [installing the npm package](#install), the client
can start `kdrive-mcp-server` directly and pass settings as environment
variables. The token path is then on the host, with no container mount; keep
it private and readable by the user running the client. Use one of these
alternatives in place of the Docker configuration above.

**Claude Code** (example; `--scope user` makes the server available in every
project):

```sh
claude mcp add kdrive --scope user \
  -e KDRIVE_TOKEN_FILE=/home/you/.config/kdrive/token \
  -e KDRIVE_ID=123456 \
  -e KDRIVE_MCP_ROOTS=123456:/Documents \
  -e KDRIVE_MCP_MODE=read \
  -- kdrive-mcp-server
```

**Claude Desktop** and most desktop clients (example): add the server under
`mcpServers` in the client's JSON configuration, `claude_desktop_config.json`
for Claude Desktop (see the client's documentation for the file location),
then restart the client:

```json
{
  "mcpServers": {
    "kdrive": {
      "command": "kdrive-mcp-server",
      "env": {
        "KDRIVE_TOKEN_FILE": "/home/you/.config/kdrive/token",
        "KDRIVE_ID": "123456",
        "KDRIVE_MCP_ROOTS": "123456:/Documents",
        "KDRIVE_MCP_MODE": "read"
      }
    }
  }
}
```

### Remote connector (authenticated HTTP)

For web and mobile clients, run the container image behind a TLS reverse
proxy. The server acts as an OAuth proxy in front of an OpenID Connect
provider (for example Infomaniak's) and only accepts the subjects or emails
you allow. The [deployment guide](docs/deployment.md#personal-server-step-by-step)
walks through it with Docker Compose and Traefik; in short:

1. Register an OAuth client at your provider with the redirect URI
   `<MCP_PUBLIC_URL>/oauth/callback`, for example
   `https://mcp.example.com/mcp/oauth/callback`.
2. Provision three secret files: the kDrive token, the upstream client secret,
   and an EC P-256 signing key in PKCS#8 PEM (the server never generates one).
3. Start from [examples/compose.yaml](examples/compose.yaml) (environment and
   Compose secrets behind Traefik) or [examples/config.yaml](examples/config.yaml)
   (YAML alternative). The key settings (fake deployment values, with
   Infomaniak as the provider):

   ```yaml
   KDRIVE_MCP_TRANSPORT: http
   OAUTH_MODE: proxy
   MCP_HTTP_HOST: 0.0.0.0 # inside the container only
   MCP_PUBLIC_URL: https://mcp.example.com/mcp
   OAUTH_ISSUER: https://login.infomaniak.com # Infomaniak; no trailing slash
   OAUTH_UPSTREAM_CLIENT_ID: 00000000-fake-client-id
   OAUTH_ALLOWED_EMAILS: you@example.com
   OAUTH_ALLOWED_REDIRECT_URIS: https://claude.ai/api/mcp/auth_callback
   ```

4. Put the callback URL of each client you use in
   `OAUTH_ALLOWED_REDIRECT_URIS` (comma-separated), then declare the server in
   the client as below. The client registers itself, you log in at your
   provider, and the server checks your identity against the allowlist.

**claude.ai** (verified): add a custom connector with the URL
`MCP_PUBLIC_URL`, for example `https://mcp.example.com/mcp`. Its callback URL
is `https://claude.ai/api/mcp/auth_callback`.

**Claude Desktop** (not yet verified): remote servers are added as custom
connectors with the same URL; Claude's documentation gives Desktop the same
callback URL as claude.ai.

**Claude Code** (not yet verified): add the server with the HTTP transport,
then log in from the `/mcp` command inside Claude Code:

```sh
claude mcp add --transport http kdrive https://mcp.example.com/mcp
```

Claude Code uses a loopback callback, `http://localhost:<port>/callback`. The
server accepts any port on an `http` loopback entry, so the allowlist entry is
`http://localhost/callback`.

`OAUTH_ALLOWED_REDIRECT_URIS` entries are compared byte for byte, except that
port. Operator details (signing key, redirect matching, restart behaviour,
reverse proxy) are in the [OAuth proxy notes](docs/oauth-proxy.md). In
`write` and `share` modes a file audit log needs a writable mount, and
`stop_grace_period` must be at least 75 s so in-flight writes can record
their outcome.

<a id="install"></a>

## Other installation methods

### npm package (published beta)

For the packaged CLI, you need Node.js 26.13 or later (26.x). Install the
published beta with
`npm install -g @sstolz/kdrive-mcp-server@beta`
([publishing](docs/publishing.md)). It provides the `kdrive-mcp-server`
command; use the [npm client configuration](#alternative-installed-npm-cli).

### Build from a checkout of this repository

You need Docker with Compose and GNU Make 3.81 or later.

```sh
make setup        # build the development container and install dependencies
make image        # container image: kdrive-mcp-server:runtime-<arch>
make pack         # npm package: ./artifacts/sstolz-kdrive-mcp-server-0.6.0-beta.1.tgz
```

`make image IMAGE_PLATFORMS=linux/amd64` builds one architecture only. A
local build pushes nothing to a registry. To use the CLI on your machine,
install the package with
`npm install -g ./artifacts/sstolz-kdrive-mcp-server-0.6.0-beta.1.tgz` (keep
the leading `./`, without which npm reads the argument as a GitHub shorthand); it
provides the `kdrive-mcp-server` command. `kdrive-mcp-server --help` and
`--version` need no configuration.

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

`kdrive_read` shares two process-wide extraction permits across text, PDF and
image reads, including continuations and empty sources. Each identity can hold
one permit and one waiter; at most four calls wait, in oldest eligible order.
Admission precedes source buffering, and waiting spends the invocation's existing
10-second deadline. Raw downloads and resource reads do not use these permits.

SERVER_BUSY is a transient admission refusal before source work, including
extraction queue saturation, an identity's waiting limit or a detached worker
holding its permit. The server does not automatically retry; a later client
invocation requires fresh admission and authorization. Capacity may remain
unavailable until a stuck worker exits or the process restarts.

Write tools (`write` and `share` modes only):

| Tool                   | Purpose                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| `kdrive_create_folder` | Create a folder.                                                 |
| `kdrive_rename`        | Rename an item.                                                  |
| `kdrive_move`          | Move an item to another folder of the same drive.                |
| `kdrive_trash`         | Move an item to the kDrive trash (never a permanent delete).     |
| `kdrive_restore`       | Restore a trashed item to its former parent.                     |
| `kdrive_upload`        | Upload `text` or `base64` content, new file or in-place replace. |

Each write returns `succeeded`, `failed`, `uncertain` or `denied` and makes at
most one upstream attempt. A valid HTTP 429 returns `failed` / `RATE_LIMITED`
without an automatic retry or a `Retry-After` wait. You may explicitly invoke
it again after a pause; each new invocation requires fresh admission and full
authorization. After
`uncertain`, check the item with a read tool before trying again: the server
never replays an uncertain write.

Key limits:

- `kdrive_upload` accepts at most 524,288 decoded bytes; over HTTP the request
  body limit is 262,144 bytes. Use `base64` for large or non-ASCII content.
- Names given to `kdrive_upload`, `kdrive_create_folder` and `kdrive_rename`
  must be in Unicode NFC (composed form); other forms are refused with
  `INVALID_ARGUMENTS`.
- `kdrive_read` extracts PDF text from a bounded projection of the file (F-034):
  cross-reference and object streams, incremental updates, FlateDecode with
  PNG predictors and the ASCII filters, text inside Form XObjects, inline
  images of known length, and Type 1, TrueType, Type0 and Type3 fonts whose
  shown codes map through an encoding, a Type 1 built-in encoding or
  `ToUnicode`. Encrypted files, other filters on text streams, fonts whose text
  depends on their program and inline images of unknown length return
  `UNSUPPORTED_FORMAT`; `kdrive_download` returns the bytes of a refused file.
  A simple font with a Chinese (GBK) font name is read through its declared
  encoding, so text a viewer would decode as GBK comes out as Latin
  characters. Images are returned within 512x512 pixels.
- Listings return at most 256 items per call and continue with single-use
  cursors that expire after five minutes; downloads continue with
  `offset_bytes` and the previous chunk's `etag`.
- One tool call per session runs at a time. Up to 4 further calls wait in
  arrival order, each for at most 12 seconds. `SERVER_BUSY` means the call
  was refused before any kDrive request, so it is safe to retry, writes
  included. For extraction, completion of an earlier call does not guarantee
  that a detached worker has released its permit (see
  [docs/mcp-client-compatibility.md](docs/mcp-client-compatibility.md#parallel-tool-calls)).

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
- Configured roots and their strict source-ancestors cannot be trashed,
  renamed or moved in `write` or `share` mode. Fresh same-drive root IDs and
  validated parent chains determine ancestry, including after external moves
  or renames. Unknown ancestry or an inaccessible root causes refusal with
  `ACCESS_DENIED`. Overlapping roots remain valid configuration; move
  destination handling is unchanged.
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
- Residual risk R-17-2: the known-ancestor bypass is addressed;
  [F-041](features/F-041-configured-root-ancestors.md) source-ancestor
  protection was accepted on main `448a48f`
  ([#47 comment](https://github.com/sstolz/kdrive-mcp-server/issues/47#issuecomment-6898895634)).
  A configured root moved
  beneath an already-checked folder before the write is not protected, for up
  to the invocation deadline. Many roots can yield `REQUEST_TIMEOUT` or
  `LIMIT_EXCEEDED`. Visibility limits can
  cause refusal even for an unrelated folder; the check-then-act window
  remains, including during subsequent deny traversal.

If a folder mutation is denied, check that configured roots are readable;
restore remains available under its existing restrictions.

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
  An upload already in flight reaches its classified result and bounded audit
  outcome attempt before exit, but its tool result is not delivered.
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

[F-039](features/F-039-bounded-audit-sink.md) bounds asynchronous audit appends
for both stderr and files to 5,000 ms from the call, including queue time,
write and callback or `fdatasync`. Sink close has one 5,000 ms budget for drain
and file release. Any stream/write/sync error or timeout permanently latches
the sink until restart; pending appends reject and later writes are refused.
The first latch offers one fixed best-effort diagnostic without waiting for
its delivery. A failed intent sends nothing upstream; a failed outcome
preserves the mutation result with `audit:"outcome_unrecorded"`.

Timed-out bytes may still arrive later. An intent without an outcome is
ambiguous: it proves neither dispatch nor its absence. The client's mutation
result is the authority; a shutdown HTTP 503 does not determine whether a
write occurred. Consult a recorded outcome or verify the item's state before
any new attempt; never automatically replay an uncertain write.

Shutdown closes transport, then gate, then exits the dedicated process.
Gate close is bounded by 45,000 ms under the production policy and sole-attempt
bounds; the deployment grace remains at least 75 s in write/share modes.
The shared production exit helper waits for both output streams with a ref'd
250 ms flush cap, shortened to the remaining stdio shutdown budget. Output
still queued on a stalled pipe at that cap may be lost. Without a run past
intent, stdio shares one 1,000 ms allowance from EOF/signal handling across
transport close, non-committed appends, file release and exit flushing.
Owned/library compositions close without terminating their host.

These are asynchronous wait bounds. Synchronous fd 2 writes to a file or TTY
can block the event loop, prevent timers from firing and remain unbounded.
A write or `fdatasync` stuck in the libuv threadpool can cause an unbounded
OS/runtime teardown stall even after `process.exit` is called. File release
never races an in-flight port operation: if it outlives close's budget, the
retained descriptor stays open until actual process termination, including in
library hosts. No timer guarantees actual termination or durable delivery.

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
