# Deployment

This guide covers the container image and the deployment examples of
[F-013](../features/F-013-http-image.md), lists the
[settings of an HTTP deployment](#settings-of-an-http-deployment), and gives a
step-by-step [personal server](#personal-server-step-by-step) installation
with Docker Compose behind Traefik. Read [Current status](#current-status)
first.

This project is unofficial and is not affiliated with, endorsed by or
supported by Infomaniak. Where a step happens in an Infomaniak interface,
this guide says what to look for; the official pages are linked from the
[README](../README.md#values-from-the-infomaniak-side), and the exact menu
paths are still to be confirmed by the maintainer.

## Current status

The runtime image serves kDrive: the production adapter and the stdio and HTTP
runtime of [F-014](../features/F-014-production-kdrive-adapter.md) are
accepted, with authenticated HTTP ([F-012](../features/F-012-authenticated-http.md))
behind the OAuth proxy ([F-010](../features/F-010-oauth-proxy.md)), the
write tools of `write` mode ([F-017](../features/F-017-controlled-tree-mutations.md),
[F-018](../features/F-018-upload.md)) and their audit gate
([F-016](../features/F-016-mutation-audit-gate.md)). `share` mode registers no
share tool yet (#20).

There are two ways to get the runtime image:

- **Stable release.** `1.0.1` is published on GHCR as
  `ghcr.io/sstolz/kdrive-mcp-server:1.0.1`, for `linux/amd64` and
  `linux/arm64`. Image tags, including `latest`, can be overwritten, so pin
  the image by the manifest digest printed by release read-back
  ([publishing](publishing.md#versions), and step 1 below). The 1.0.1 digest
  is
  `sha256:58a37c17549e8e161a112ea2b93d1d8cf7196bc926ed3e6d2032b310dac6b051`.
  `1.0.0` remains published and installable by its exact version.
- **Build from source.** `make image` builds the image from a checkout of
  `main`, with every merged change ([Build](#build)). A local build loads the
  image into the local engine only; nothing is published to a registry by
  it.

The runtime image has a `HEALTHCHECK`
([F-021](../features/F-021-container-health-check.md), see
[Health check](#health-check)). On a successful start the HTTP runtime prints
nothing; it writes one line on stderr when startup fails (see
[Troubleshooting](#troubleshooting)) and JSON event lines while it runs.

## Build

The production `Dockerfile` is separate from `Dockerfile.dev`. It has four
stages:

- `build` and `deps` run on the build platform (`--platform=$BUILDPLATFORM`)
  from the digest-pinned `node:26.13.0-bookworm` image. `build` compiles
  TypeScript; `deps` installs the production dependencies from the lockfile,
  without optional native packages, and removes its npm cache.
- `runtime` starts from the digest-pinned `node:26.13.0-bookworm-slim` image
  and only copies `dist/`, `node_modules/`, `package.json`,
  `package-lock.json`, `LICENSE`, `NOTICE`, `README.md` and
  `LICENSES/Apache-2.0.txt` into `/app`. Its
  files belong to root and are not writable by the runtime user. It runs as
  UID/GID 1000, sets `NODE_ENV=production`, `STOPSIGNAL SIGTERM`,
  `EXPOSE 3000`, and its entrypoint is `node /app/dist/cli.js`.
- `smoke` is `runtime` plus the dev-only acceptance composition
  `scripts/http-acceptance.ts` (synthetic drive). It is used only by the
  container smoke tests and is never published.

Build both targets for one or both architectures with the host Docker engine
and its Buildx plugin:

```sh
make image IMAGE_PLATFORMS=linux/amd64
make image                      # linux/amd64 and linux/arm64
make image-smoke IMAGE_PLATFORMS=linux/amd64
```

`make image` tags `kdrive-mcp-server:runtime-<arch>` and
`kdrive-mcp-server:smoke-<arch>` (`amd64` or `arm64`), loads them into the
local engine and checks each image's platform. Nothing is pushed to a
registry. An arm64 build on a non-arm64 host needs QEMU emulation:
`make image-binfmt` registers it once (until reboot) by running one
privileged, digest-pinned `tonistiigi/binfmt` container. It is opt-in; no
other target runs it.

`make image-smoke` starts each container with `--network none`,
`--read-only`, `--cap-drop ALL`, `no-new-privileges` and a tmpfs for
synthetic secrets. It checks the startup line, UID 1000, Node as PID 1, the
protected-resource metadata (200), an unauthenticated MCP request (401 with a
`Bearer` challenge), the SIGTERM exit code 0, and the runtime image's
contents, ownership and version.

## Startup

`compose.yaml` and `config.yaml` are alternatives that configure the same
runtime image:

- [`compose.yaml`](../examples/compose.yaml) configures it by environment
  variables and Compose file secrets, behind Traefik.
- [`config.yaml`](../examples/config.yaml) is the YAML alternative: mount it
  read-only at `/config/config.yaml` and start the image with
  `--config /config/config.yaml`.

Both select the `http` transport and the OAuth `proxy` mode. `0.0.0.0` is the
container-internal bind address, so the reverse proxy reaches port 3000 over
the container network; no host port is published. Required installation-specific
values in `compose.yaml` use `${NAME:?…}`, so Compose refuses to start until
they are set. Optional values such as `MCP_HTTP_TRUSTED_PROXIES` may be empty.
The public URL, for example
`https://mcp.example.com/mcp`, must match the host name of the Traefik rule.

`restart: on-failure:3` bounds a crash loop. The examples run the container
read-only, without capabilities and with `no-new-privileges`.

## Secrets

The kDrive token, the upstream client secret and the signing key are files.
They are provided as Compose file secrets mounted under `/run/secrets/` and
named only by `KDRIVE_TOKEN_FILE`, `OAUTH_UPSTREAM_CLIENT_SECRET_FILE` and
`OAUTH_SIGNING_KEY_FILE` (or `tokenFile`, `oauthUpstreamClientSecretFile`
and `oauthSigningKeyFile` in `config.yaml`). Secret files must be readable by
UID 1000, the runtime user. Secrets are never passed as environment values or
build arguments, and never enter the image: `.dockerignore` excludes secret
files, environment files and keys from the build context.

For all three secret files, maximal leading and trailing sequences of U+0020
SPACE, U+0009 TAB, U+000D CR and U+000A LF are removed after checking the raw
file limit (16,384 bytes for token/upstream secret; 65,536 for signing key).
Empty results are refused. Other bytes, including NBSP, BOM and NUL, are not
trimmed. Interior spaces remain valid in token/upstream secrets; interior ASCII
controls remain invalid, and fatal UTF-8 decoding still applies. Signing-key
interior bytes and PKCS#8/P-256 validation are unchanged. Direct environment
credentials are never trimmed and retain their existing validation.

## Shutdown

`docker stop` (or `docker compose stop`) sends SIGTERM. SIGTERM triggers the
F-012 BR-169 ordered close: the server stops accepting connections, closes
every session, ends the remaining connections and closes its listener; the
smoke composition then exits 0 (checked by `make image-smoke`). The stop grace
period must be at least 10 s in `read` mode and at least 75 s in `write` and
`share` modes (next section); the example sets `stop_grace_period: 75s`, which
suits every mode. A shorter period lets the engine send SIGKILL before the
close completes.

## Health check

The runtime image's `HEALTHCHECK` is a liveness check: every 10 s Docker runs
`node /app/dist/healthcheck.js` inside the container, which sends one
`GET /healthz` to `127.0.0.1` on the port of `MCP_HTTP_PORT` (3000 when unset)
with `Host: 127.0.0.1:<port>`. The route answers `{"status":"ok"}` without
authentication, in both modes, and checks neither kDrive nor the identity
provider, so their outage never marks the container unhealthy. The first
success marks the container `healthy`; three consecutive failures after the
30 s start period mark it `unhealthy`. While the server stops (SIGTERM and the
graceful drain), the listener is closed and probes fail `connection`, so the
container can show `unhealthy` before it exits: this is expected, and a tool
that restarts unhealthy containers must not cut the drain short with a
shorter stop timeout. The Docker Engine does not restart an unhealthy
container by itself; acting on it is the orchestrator's choice.

- Behind Traefik: Traefik's Docker provider routes to the container only once
  Docker reports it `healthy`, so after each (re)start the service is
  unreachable for up to one interval (10 s) after the server listens.
- stdio and one-shot runs of the image (for example `--version`) also see the
  health check; add `--no-healthcheck` to `docker run` for them, or
  `healthcheck: { disable: true }` in Compose.
- The probe cannot follow every configuration. Override `healthcheck.test` in
  Compose (or use `--no-healthcheck`) when the MCP endpoint itself is at `/healthz` (the MCP route keeps the path and the probe fails), when the effective port differs from `MCP_HTTP_PORT` (3000 when unset), that is with `--port` or a `port` in `--config` without the variable, or when `MCP_HTTP_HOST` is not reachable at `127.0.0.1`, for example `::1` or a specific address. For another port, a Compose override
  is `healthcheck: { test: ["CMD", "env", "MCP_HTTP_PORT=8080", "node", "/app/dist/healthcheck.js"] }`;
  the shipped probe always connects to `127.0.0.1`, so a bind that is not
  reachable there needs its own command or a disabled check.
- Troubleshooting: a Traefik 404 or a container stuck `starting` or
  `unhealthy` is diagnosed with `docker inspect --format '{{json .State.Health}}' <container>`; its log shows `healthcheck failed: <code>`, where the code is `port`, `connection`, `timeout`, `status` or `body`.
- Orchestrators: prefer an `exec` probe running `node /app/dist/healthcheck.js`
  with `timeoutSeconds` of at least 10 (the default 1 s is too short for a Node
  start). An `httpGet` probe must set `Host: localhost` (or the public `Host`)
  through `httpHeaders`, because its default `Host` (the pod IP) gets 403
  `invalid_host`. Probes and monitors use `GET` (`HEAD` gets 405). `httpGet`
  counts `429` as a failure, and each `Host` class (loopback or public) allows
  120 requests per minute, for example two probes at 1 s or up to 20 at 10 s,
  shared with any other probe in the same class.

## Write and share modes: audit log

F-016 (#17) adds the mutation audit gate that every write tool (#18, #19) and
every future share tool (#20) uses. It changes deployment in `write` and
`share` modes only; `read` mode opens no audit sink.

- **Grace period.** On SIGTERM the server closes the transport first, then
  waits for each write already past its audit intent to reach its classified
  result and bounded outcome attempt, then closes the sink and exits.
  Set `stop_grace_period` to at least 75 s in `write` and `share` modes; a
  shorter period lets the engine send SIGKILL and leaves an intent record
  without its outcome.
- **Writable mount.** The runtime root file system is read-only (F-013), so a
  file audit log needs a writable mount, for example a volume at `/audit` with
  `KDRIVE_MCP_AUDIT_LOG=/audit/audit.jsonl`. The server creates the file with
  mode `0600`. An existing file must be a regular file (not a symlink) owned by
  the runtime user (UID 1000) with no group or other permission bit; otherwise
  startup stops with a fixed message and the file is left unchanged. The file is
  opened once at startup, so rotation needs a restart.
- **OAuth state file.** `OAUTH_STATE_FILE` (optional, `proxy` mode only) uses
  the same writable mount, for example
  `OAUTH_STATE_FILE=/audit/oauth-state.sqlite`, and keeps registered clients
  and refresh tokens across restarts. The server creates it with mode `0600`
  and refuses to start unless the file is a regular file with one link, owned
  by UID 1000 with mode `0600`, in a directory owned by UID 1000 with mode
  `0700` (owner read, write and search, no group or other write bit), with no `-wal` or `-shm` file next to it; the store's
  own `-journal` file sits next to it (see the
  [state file requirements](oauth-proxy.md#state-file-requirements)). It is a credential store: protect the
  mount like the signing key and never restore it from a backup. See the
  [OAuth proxy notes](oauth-proxy.md).
- **stderr durability.** With the default `KDRIVE_MCP_AUDIT_LOG=stderr`, records
  are as durable as whatever collects the container's stderr. Use a file on a
  writable mount for a durable trail.
- **Received shares.** `KDRIVE_MCP_SHARED_WRITE=1` authorizes no write inside a
  received share yet: every received-share mutation stays denied until a later
  ticket qualifies it.

[F-039](../features/F-039-bounded-audit-sink.md) bounds asynchronous audit appends
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

## Settings of an HTTP deployment

This table lists the settings of the Compose path below, taken from the
[configuration reference](../features/F-002-configuration.md),
[`examples/compose.yaml`](../examples/compose.yaml) and
[`examples/config.yaml`](../examples/config.yaml). Every example value is
illustrative: replace installation-specific values with yours. The Infomaniak
issuer is given in the [README](../README.md#values-from-the-infomaniak-side). "Set by the example" means that
`examples/compose.yaml` already sets the value and you normally keep it.

Server settings (the `environment` of the service; the server reads no
`.env` file):

| Variable                            | Role                                                                                            | Required?                                                    | Example                               |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------- |
| `KDRIVE_MCP_TRANSPORT`              | `stdio` or `http`.                                                                              | Yes for HTTP (default `stdio`); set by the example           | `http`                                |
| `OAUTH_MODE`                        | Authentication mode; this guide uses the OAuth `proxy`.                                         | Yes for authenticated HTTP; set by the example               | `proxy`                               |
| `MCP_HTTP_HOST`                     | Bind address inside the container.                                                              | Yes in a container (default `127.0.0.1`); set by the example | `0.0.0.0`                             |
| `MCP_HTTP_TRUSTED_PROXIES`          | Trusted proxy addresses or CIDRs for peer admission; configure only after the checks in step 4. | No (empty by default)                                        | leave unset                           |
| `MCP_HTTP_PORT`                     | Listening port, also used by the health check.                                                  | No (default `3000`); set by the example                      | `3000`                                |
| `MCP_PUBLIC_URL`                    | Public HTTPS URL of the MCP endpoint, with a path.                                              | Yes                                                          | `https://mcp.example.com/mcp`         |
| `KDRIVE_TOKEN_FILE`                 | Path, inside the container, of the file holding the kDrive API token.                           | Yes (or `KDRIVE_TOKEN`, not for Compose); set by the example | `/run/secrets/kdrive-token`           |
| `KDRIVE_ID`                         | The drive to serve.                                                                             | Yes, or `KDRIVE_IDS`                                         | `123456`                              |
| `KDRIVE_IDS`                        | Several drives, comma-separated; the first is the default.                                      | Instead of `KDRIVE_ID`                                       | `123456,234567`                       |
| `KDRIVE_MCP_MODE`                   | `read`, `write` or `share`.                                                                     | No (default `read`); set by the example                      | `read`                                |
| `KDRIVE_MCP_ROOTS`                  | Root folders per drive, by ID or path; must cover every configured drive.                       | No (default: folder 1 of each drive)                         | `123456:/Private/Documents`           |
| `KDRIVE_MCP_DENY`                   | Comma-separated, case-sensitive path patterns to hide.                                          | No                                                           | `/Private/Documents/Confidential/**`  |
| `KDRIVE_MCP_SHARED_WITH_ME`         | `1` to read items other users shared with you.                                                  | No (default `0`)                                             | `0`                                   |
| `KDRIVE_MCP_AUDIT_LOG`              | Write audit log: `stderr` or an absolute file path.                                             | No (default `stderr`); a file is advised in `write` mode     | `/audit/audit.jsonl`                  |
| `OAUTH_ISSUER`                      | Issuer URL of the upstream OpenID Connect provider, exactly as its discovery document gives.    | Yes                                                          | `https://login.example.com`           |
| `OAUTH_UPSTREAM_CLIENT_ID`          | Client ID of the OAuth client registered at the provider.                                       | Yes                                                          | `00000000-fake-client-id`             |
| `OAUTH_UPSTREAM_CLIENT_SECRET_FILE` | Path, inside the container, of the file holding that client's secret.                           | Yes; set by the example                                      | `/run/secrets/upstream-client-secret` |
| `OAUTH_SIGNING_KEY_FILE`            | Path, inside the container, of the EC P-256 signing key.                                        | Yes; set by the example                                      | `/run/secrets/signing-key.pem`        |
| `OAUTH_ALLOWED_EMAILS`              | Comma-separated emails allowed to log in.                                                       | No individually; at least one entry across both lists        | `you@example.com`                     |
| `OAUTH_ALLOWED_SUBJECTS`            | Comma-separated provider subjects (`sub`) allowed to log in.                                    | No individually; at least one entry across both lists        | `00000000-fake-subject`               |
| `OAUTH_ALLOWED_REDIRECT_URIS`       | Callback URLs of your AI clients; matching rules below.                                         | Yes                                                          | `https://client.example.org/callback` |
| `OAUTH_AUDIENCE`                    | Token audience.                                                                                 | No (defaults to `MCP_PUBLIC_URL`)                            | leave unset                           |
| `OAUTH_STATE_FILE`                  | SQLite file that keeps clients and logins across restarts.                                      | No                                                           | `/audit/oauth-state.sqlite`           |
| `OAUTH_ALLOWED_CLIENT_ID_ORIGINS`   | Origins allowed for Client ID Metadata Documents (available since `0.6.0-beta.2`).              | No (empty by default)                                        | leave unset                           |

`OAUTH_ALLOWED_SUBJECTS` and `OAUTH_ALLOWED_EMAILS`: either list may be
unset or empty; the server requires at least one combined entry across both
lists. Prefer subjects because an e-mail address can be reassigned.
E-mail entries require an exact address match and `email_verified=true`.
Redirect URIs match byte for byte, except that the port of an `http`
loopback URI on `127.0.0.1`, `[::1]` or `localhost` may vary (RFC 8252 §7.3).
The callback URL of each client is in the [client compatibility matrix](mcp-client-compatibility.md); the example value
above is a placeholder, not a real client. Size and time limits
(`KDRIVE_MCP_MAX_READ_BYTES` and others) keep their defaults unless you have a
reason; the configuration reference gives every setting, bound and error code.

Compose variables (read only by Compose, from the shell or a `.env` file next
to `compose.yaml`; they hold no secret value):

| Variable                      | Role                                                                  | Required?                                             | Example                                                  |
| ----------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------- |
| `KDRIVE_MCP_IMAGE`            | Runtime image: the release image pinned by digest, or your local tag. | Yes                                                   | `ghcr.io/sstolz/kdrive-mcp-server:1.0.1@sha256:<digest>` |
| `MCP_PUBLIC_URL`              | Passed to the server (see above).                                     | Yes                                                   | `https://mcp.example.com/mcp`                            |
| `MCP_HOSTNAME`                | Host name of the Traefik rule; the host of `MCP_PUBLIC_URL`.          | Yes                                                   | `mcp.example.com`                                        |
| `KDRIVE_ID`                   | Passed to the server (see above).                                     | Yes                                                   | `123456`                                                 |
| `OAUTH_ISSUER`                | Passed to the server (see above).                                     | Yes                                                   | `https://login.example.com`                              |
| `OAUTH_UPSTREAM_CLIENT_ID`    | Passed to the server (see above).                                     | Yes                                                   | `00000000-fake-client-id`                                |
| `OAUTH_ALLOWED_EMAILS`        | Passed to the server (see above).                                     | No individually; at least one entry across both lists | `you@example.com`                                        |
| `OAUTH_ALLOWED_SUBJECTS`      | Passed to the server (see above).                                     | No individually; at least one entry across both lists | `subject-1`                                              |
| `OAUTH_ALLOWED_REDIRECT_URIS` | Passed to the server (see above).                                     | Yes                                                   | `https://client.example.org/callback`                    |
| `MCP_HTTP_TRUSTED_PROXIES`    | Passed to the server; read at startup (see step 4).                   | No (empty by default)                                 | leave unset                                              |
| `TRAEFIK_NETWORK`             | External Docker network that Traefik and the container share.         | Yes                                                   | `proxy`                                                  |
| `TRAEFIK_ENTRYPOINT`          | Traefik HTTPS entrypoint name.                                        | Yes                                                   | `websecure`                                              |
| `KDRIVE_TOKEN_SECRET_FILE`    | Host path of the kDrive token file.                                   | Yes                                                   | `./secrets/kdrive-token`                                 |
| `UPSTREAM_CLIENT_SECRET_FILE` | Host path of the upstream client secret file.                         | Yes                                                   | `./secrets/upstream-client-secret`                       |
| `SIGNING_KEY_FILE`            | Host path of the signing key file.                                    | Yes                                                   | `./secrets/signing-key.pem`                              |
| `AUDIT_DIR`                   | Host directory mounted at `/audit` once you uncomment the `volumes`.  | Only with the `volumes` line                          | `./audit`                                                |

The secret files hold the values themselves, for example a kDrive token file
containing `example-token-not-real`; step 3 below writes them.

## Personal server, step by step

This path runs one container on your own server, behind a TLS reverse proxy
(Traefik in [`examples/compose.yaml`](../examples/compose.yaml)), connected to
your kDrive and to a remote AI client. The values below
(`mcp.example.com`, the deployment directory `kdrive-mcp`) are examples.

You need:

- a server with Docker Engine and the Compose plugin; to build from source,
  also the Buildx plugin, Git and GNU Make 3.81 or later;
- a reverse proxy that terminates TLS for a public host name, for example
  `mcp.example.com`, on a Docker network the container can join;
- an OpenID Connect provider where you can register a confidential OAuth
  client (for example Infomaniak's);
- an Infomaniak API token for kDrive from an account with the **admin** role
  on every configured drive: startup checks the role and refuses otherwise.

### 1. Get the image

Pull the stable image, or build from source (see
[Current status](#current-status) for the difference).

**Stable image, pinned by digest.** Read the digest of the multi-platform
image, then pull it by that digest:

```sh
docker buildx imagetools inspect ghcr.io/sstolz/kdrive-mcp-server:1.0.1
docker pull 'ghcr.io/sstolz/kdrive-mcp-server:1.0.1@sha256:<digest>'
```

`<digest>` is the hexadecimal value after `sha256:` on the `Digest:` line of
the first command. Use the same reference as `KDRIVE_MCP_IMAGE` in step 4.

Then create a deployment directory that you own and run every later step
from it:

```sh
mkdir kdrive-mcp && cd kdrive-mcp
```

**Build from source on the server.**

```sh
git clone <repository URL> kdrive-mcp-server
cd kdrive-mcp-server
make image IMAGE_PLATFORMS=linux/amd64   # or linux/arm64 on an arm64 server
```

The image is tagged `kdrive-mcp-server:runtime-amd64` (or `-arm64`). Building
for the server's own architecture needs no emulation. Rebuild after each
`git pull` to update.

Then create a deployment directory that you own, next to the checkout, and
run every later step from it:

```sh
cd .. && mkdir kdrive-mcp && cd kdrive-mcp
```

Keeping it outside the checkout keeps the secrets and the audit log out of
the image build context.

### 2. Collect the Infomaniak values and register the OAuth client

Collect four things before you configure anything. The official Infomaniak
pages for each are linked from the
[README](../README.md#values-from-the-infomaniak-side). The menu paths in
the Infomaniak Manager are given in French, as the Manager shows them at the
time of writing.

1. **The API application and the kDrive API token.** First choose the public
   MCP URL (item 3): the application needs it. In the Manager, open
   **Utilisateurs et profils** → **Mon profil** → **Développeur** →
   **Application API** → **Créer une nouvelle application**, type
   **Application** and any name. The application URL field is the OAuth
   redirect (callback) URI. For this deployment, enter
   `<MCP_PUBLIC_URL>/oauth/callback`, here
   `https://mcp.example.com/mcp/oauth/callback`.
   Keep its client ID and client secret (step 4). Then open **Développeur** →
   **Tokens API** → **Créer un token**: select **Application par défaut**, the
   scope **drive — Produits Drive** and a validity (1 day to unlimited). Log in as
   an account that has the **admin** role on every drive you will configure:
   startup checks the role and stops with `[DRIVE_NOT_ALLOWED]` otherwise. The
   token is shown once; it goes into `secrets/kdrive-token` in step 3, never
   into a variable or a file you commit. The OAuth API application only offers
   OpenID scopes here and is used only for login (client ID/secret). A token
   without the `drive` scope makes startup fail with `[PREFLIGHT_FAILED]`:
   kDrive answers `403 all_scopes`.
2. **The drive ID.** `KDRIVE_ID` is the number in the kDrive web app URL
   after `/kdrive/app/drive/`: for example, a path that contains
   `/kdrive/app/drive/123456/` gives `123456`.
   The README also gives a read-only API call that lists the drives a token
   can access. A wrong ID stops the server at startup, with
   `[DRIVE_NOT_ALLOWED]` or `[PREFLIGHT_FAILED]`.
3. **The public MCP URL.** Choose it before registering the client. It needs
   a path, for example `https://mcp.example.com/mcp`; an origin-only URL is
   refused.
4. **The OAuth client.** With Infomaniak as the provider, it is the API
   application of item 1: its client ID becomes `OAUTH_UPSTREAM_CLIENT_ID` and
   its client secret goes into the client secret file. Set `OAUTH_ISSUER` to
   the Infomaniak issuer given in the
   [README](../README.md#values-from-the-infomaniak-side), without a trailing
   slash.
   With another provider, register a confidential OAuth 2.0 / OpenID Connect
   client with the redirect URI `<MCP_PUBLIC_URL>/oauth/callback`. Take its
   issuer URL exactly as the provider's `/.well-known/openid-configuration`
   gives it (a trailing slash matters).

### 3. Provision the three secret files

Put them in a `secrets` directory readable by UID 1000 (the runtime user) and
by nobody else. Each file is read once at startup. Leading and trailing
U+0020 SPACE, U+0009 TAB, U+000D CR and U+000A LF are removed, including
repeated or mixed padding; an empty result is refused. Interior token/secret
spaces remain valid and interior controls remain invalid. Environment
credentials are never trimmed.

```sh
sudo install -d -m 0700 -o 1000 -g 1000 secrets
```

- `kdrive-token`: the kDrive API token, alone on one line.
- `upstream-client-secret`: the client secret from step 2.
- `signing-key.pem`: an EC P-256 private key in PKCS#8 PEM (one
  `-----BEGIN PRIVATE KEY-----` block). The server never generates one, and
  any other key type, curve or format is refused at startup. Keep the same
  file across restarts: replacing it invalidates issued access tokens and
  clients authorize again.

The directory belongs to UID 1000, so write each file through `sudo tee`. In
bash, each `read -rs` waits silently for you to paste the value and press
Enter, which keeps it out of the shell history and off the screen:

```sh
read -rs TOKEN && printf '%s\n' "$TOKEN" | sudo tee secrets/kdrive-token >/dev/null && unset TOKEN
read -rs SECRET && printf '%s\n' "$SECRET" | sudo tee secrets/upstream-client-secret >/dev/null && unset SECRET
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 | sudo tee secrets/signing-key.pem >/dev/null
sudo chown 1000:1000 secrets/kdrive-token secrets/upstream-client-secret secrets/signing-key.pem
sudo chmod 0400 secrets/kdrive-token secrets/upstream-client-secret secrets/signing-key.pem
```

### 4. Configure Compose behind the reverse proxy

[`examples/compose.yaml`](../examples/compose.yaml) uses an existing Traefik.
For an example that includes Traefik and ACME TLS, use
[`examples/compose-traefik.yaml`](../examples/compose-traefik.yaml). Adapt its
version, ACME contact, host and secret-file placeholders. It is not exercised
by CI. It creates the shared network and an ACME storage volume, publishes
HTTPS on port 443, and mounts the Docker socket read-only for discovery.
Protect access to that socket and keep the ACME storage private.

This step explains the existing-Traefik example. Copy
it into the deployment directory as `compose.yaml`, from your checkout or
from the repository at the tag that matches your image (`v1.0.1` after
publication). What it contains:

- **Service hardening.** UID/GID 1000, a read-only root file system, no
  capabilities, `no-new-privileges`, `init`, `restart: on-failure:3`, and
  `stop_grace_period: 75s` for the audit drain of `write` mode.
- **Health check.** The file has no `healthcheck` key, so the image's own
  `HEALTHCHECK` applies ([Health check](#health-check)); Traefik routes to
  the container only once Docker reports it `healthy`.
- **Compose file secrets.** Three `secrets` entries read the host files named
  by `KDRIVE_TOKEN_SECRET_FILE`, `UPSTREAM_CLIENT_SECRET_FILE` and
  `SIGNING_KEY_FILE` and mount them under `/run/secrets/`, where the
  `*_FILE` settings point ([Secrets](#secrets)).
- **Docker network.** The service joins the external network named by
  `TRAEFIK_NETWORK`, which your Traefik container must also be attached to.
  If it does not exist yet, create it once with
  `docker network create proxy` (or the name you use) and attach Traefik to
  it; no host port of the server is published.
- **Traefik labels.** `traefik.enable` turns routing on;
  `traefik.docker.network` tells Traefik which network to use;
  the router `kdrive-mcp` matches the host name `MCP_HOSTNAME` on the entrypoint
  `TRAEFIK_ENTRYPOINT` with TLS; the service sends traffic to port 3000.

Set its variables (see
[Settings of an HTTP deployment](#settings-of-an-http-deployment)) in the
shell or in a `.env` file next to it (Compose reads that file; the server
itself reads none). The `.env` file holds no secret, only the paths to the
secret files, relative to the deployment directory. The installation-specific
values below are fake; for the Infomaniak issuer, see the
[README](../README.md#values-from-the-infomaniak-side):

```sh
# Release image pinned by digest (step 1), or kdrive-mcp-server:runtime-amd64
KDRIVE_MCP_IMAGE=ghcr.io/sstolz/kdrive-mcp-server:1.0.1@sha256:<digest>
MCP_PUBLIC_URL=https://mcp.example.com/mcp
MCP_HOSTNAME=mcp.example.com
KDRIVE_ID=123456
OAUTH_ISSUER=https://login.example.com
OAUTH_UPSTREAM_CLIENT_ID=00000000-fake-client-id
# Set either or both lists; prefer provider subjects.
OAUTH_ALLOWED_SUBJECTS=subject-1
OAUTH_ALLOWED_EMAILS=
OAUTH_ALLOWED_REDIRECT_URIS=https://client.example.org/callback
TRAEFIK_NETWORK=proxy
TRAEFIK_ENTRYPOINT=websecure
KDRIVE_TOKEN_SECRET_FILE=./secrets/kdrive-token
UPSTREAM_CLIENT_SECRET_FILE=./secrets/upstream-client-secret
SIGNING_KEY_FILE=./secrets/signing-key.pem
```

- `OAUTH_ALLOWED_REDIRECT_URIS` lists the callback URLs of your AI clients,
  compared byte for byte; the
  [client compatibility matrix](mcp-client-compatibility.md) gives them.
- `OAUTH_ALLOWED_CLIENT_ID_ORIGINS` (optional, `proxy` mode only, empty by
  default) enables Client ID Metadata Documents for the listed origins. Leave
  it empty unless you follow the origin discovery procedure of the
  [OAuth proxy notes](oauth-proxy.md#origin-discovery-procedure): a nonempty
  list makes every CIMD-capable client use CIMD.
- To limit the server to some folders, add `KDRIVE_MCP_ROOTS` (for example
  `123456:/Private/Documents`) and, if needed, `KDRIVE_MCP_DENY` to the
  `environment` of the service; the [README](../README.md#configure) lists the settings.
  Paths follow the kDrive API tree: the personal space sits under a `Private`
  folder that the web UI does not show. A root given by folder ID needs no
  path; item paths and deny patterns still include `/Private`. An absolute
  deny pattern written from the web UI path, such as `/Documents/Confidential/**`,
  is accepted but matches nothing in the personal space. Write the pattern
  from the full path, for example `/Private/Documents/Confidential/**`. A filtered
  item looks the same to the client as a missing one (`ACCESS_DENIED`).
  A [deny-pattern root warning](#deny-pattern-root-warning) can identify this
  mismatch after successful preflight; it does not correct the pattern.
- The reverse proxy must preserve the `Host` header and close idle upstream
  keep-alive connections in less than 5 s, the server's keep-alive timeout;
  otherwise reused sockets can produce intermittent 502 responses. With
  Traefik, reference a `serversTransport` whose
  `forwardingTimeouts.idleConnTimeout` is below 5 s; if Traefik obtains the
  certificate through ACME, also add the router's `tls.certresolver` label.
  Add per-client-IP rate and connection limits there too
  ([OAuth proxy notes](oauth-proxy.md#limits-and-residual-risks)).

The complete [Traefik example](../examples/compose-traefik.yaml) includes the
`letsencrypt` certificate resolver label and the
`kdrive-mcp-transport@file` servers transport, with `idleConnTimeout: 4s`.
For an existing Traefik, adapt those labels and its dynamic file configuration.
These settings have not been verified against a running Traefik with this
server.

**F-035 accepted on main `703bece`.** `MCP_HTTP_TRUSTED_PROXIES` is optional and
empty by default; the Compose example passes `${MCP_HTTP_TRUSTED_PROXIES:-}`.
Use exact proxy addresses or a dedicated access-controlled proxy-only network.
Every trusted hop must append the upstream address it observed as the last
`X-Forwarded-For` element. Trusting a whole shared network trusts every
container on it, including containers connecting directly to the server.

An untrusted container on a listed shared network can connect directly to the
server and send a victim's address in `X-Forwarded-For`. This selects the
victim's peer and can exhaust its window: socket `CONTAINER_ADDRESS`, header
`X-Forwarded-For: VICTIM_ADDRESS`. Exact proxy addresses or an isolated
proxy-only network prevent that trust mistake. Do not list a shared network
merely because Traefik belongs to it, and never list client addresses as proxies.

A residential `/56` or `/48` supplies 256 or 65,536 `/64` peers, so one home
line can cross the two-peer or twenty-peer global barriers. Per-peer admission
therefore reduces single-peer interference but cannot prevent global lockout.

Required installation-specific values use `${NAME:?…}`; optional values may
use `${NAME:-}` with an empty default. Credentials remain file secrets only.
Leaving the trusted-proxy list empty behind Traefik retains one shared peer
window. Set the comma-separated list only after checking the proxy addresses,
network isolation and header-append policy; it is read at startup.

Check the file with `docker compose config`; Compose names any required
variable still unset.

### 5. Start in `read` mode

The example sets `KDRIVE_MCP_MODE: read`. From the deployment
directory, start and watch the log:

```sh
docker compose up -d
docker compose logs -f kdrive-mcp
```

The startup checks (configuration, secret files, the admin role on each drive
and the roots) call kDrive before the server listens, so give them a few
seconds. If `docker compose ps` still shows the container running after that,
and the log has no error line, they passed. See [Verify](#7-verify) before
adding the connector.

### 6. Switch to `write` mode

Write tools need a durable audit log on a writable mount
([audit log](#write-and-share-modes-audit-log)):

```sh
sudo install -d -m 0700 -o 1000 -g 1000 audit
```

Then set `KDRIVE_MCP_MODE: write` in `compose.yaml`, uncomment the `KDRIVE_MCP_AUDIT_LOG` line
and the `volumes` entry of the example (with `AUDIT_DIR=./audit`),
keep `stop_grace_period` at 75 s or more, and run `docker compose up -d` again.
The server creates `audit.jsonl` with mode `0600` and opens it once at startup.

Optionally, keep registered clients and logins across restarts with the same
mount. In `read` mode the directory and the `volumes` entry are needed too.
Uncomment `OAUTH_STATE_FILE: /audit/oauth-state.sqlite` in `compose.yaml` (or
`oauthStateFile` in `config.yaml`) and run `docker compose up -d` again. The
server creates `oauth-state.sqlite` with mode `0600`; its `-journal` file
belongs to it, so never delete or move either file while the server runs. The
file is a credential store; read the [OAuth proxy
notes](oauth-proxy.md) before enabling it.

### 7. Verify

Wait until `docker compose ps` shows the service `healthy`: Traefik routes to
it only then ([Health check](#health-check)). Then, from any machine:

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://mcp.example.com/.well-known/oauth-protected-resource/mcp
curl -s -o /dev/null -D - -X POST https://mcp.example.com/mcp
```

The first prints `200`. The second answers `401` with a
`WWW-Authenticate: Bearer` header: the server is reachable and requires
authentication.

### 8. Add the connector in the AI client

In the client, add a custom connector with the URL `MCP_PUBLIC_URL`
(`https://mcp.example.com/mcp`). The client registers itself, you log in at
your provider, and the server accepts you only if your email or subject is in
the allowlist. The connector then lists the read tools, and the write tools in
`write` mode.

The client's callback URL must be in `OAUTH_ALLOWED_REDIRECT_URIS` before you
add the connector. The [README](../README.md#connect-an-ai-client) shows how
to declare the server in Claude Code, Claude Desktop and claude.ai, and which
of those combinations have been verified with this server.

## Troubleshooting

- **The container exits at startup.** It prints one line and exits 1:
  `Configuration error [<code>] (<setting>).` names the code and the setting
  without its value, for example `[MISSING_REQUIRED]` for an unset setting,
  `[CREDENTIAL_READ_FAILED]` for a secret file that is missing or not readable
  by UID 1000, `[CREDENTIAL_INVALID]` for an empty or non-UTF-8 secret file, `[DRIVE_NOT_ALLOWED]` when the token's account is not admin of a
  drive or a root names a drive that is not configured, `[ROOT_NOT_RESOLVED]` for a root path that is missing, ambiguous or not a folder, and
  `[PREFLIGHT_FAILED]` when kDrive refused or did not answer the startup
  checks. The [configuration reference](../features/F-002-configuration.md)
  lists every code. HTTP startup refusals print a fixed sentence instead, for
  example "The public URL of an authenticated server requires a path."; a
  signing key that is not one PKCS#8 PEM EC P-256 key, or a port that cannot
  be bound, prints "The HTTP listener could not be started.". An audit log that cannot be opened prints "The audit log could not be opened or
  is not a private regular file." (check the owner and mode of the file and
  of the mount). With `restart: on-failure:3`, Compose retries three times.
- **`[CREDENTIAL_INVALID]`.** A secret file empty after removal of leading and
  trailing U+0020 SPACE, U+0009 TAB, U+000D CR and U+000A LF causes this error.
  Token/upstream-secret files also reject invalid UTF-8 and interior ASCII
  controls, including tabs, CR and LF; interior spaces remain valid. Other
  Unicode whitespace, BOM and NUL are not trimmed. Environment credentials
  are never trimmed. Correct the selected file, then restart.
- **`[PREFLIGHT_FAILED]` with `403 all_scopes`.** The kDrive API token lacks the
  `drive` scope. Create a token in **Tokens API → Créer un token** with
  **Application par défaut** and **drive — Produits Drive** (step 2), replace
  the token file and restart. The OAuth API application only offers OpenID
  scopes there.
- **`403` with `invalid_host`.** The reverse proxy did not preserve the `Host`
  header, or `MCP_HOSTNAME` differs from the host of `MCP_PUBLIC_URL`.
- **The provider shows a redirect error at login.** The redirect URI registered
  at the provider is not exactly `<MCP_PUBLIC_URL>/oauth/callback`.
- **The client fails to add the connector before any login page.** Its
  registration was refused with `invalid_redirect_uri`: its callback URL is
  not in `OAUTH_ALLOWED_REDIRECT_URIS` byte for byte; compare it with the
  [client compatibility matrix](mcp-client-compatibility.md).
- **Login at the provider succeeds, then the client reports `access_denied`.**
  The identity the provider returned is not in `OAUTH_ALLOWED_EMAILS` or
  `OAUTH_ALLOWED_SUBJECTS`.
- **`401 invalid_client` after a restart.** Without `OAUTH_STATE_FILE`,
  registered clients and refresh tokens live in memory: remove and add the
  connector again, or let the client register and authorize again. With it, the
  file was deleted or replaced, or the server started with another file.
- **An `OAUTH_STATE_*` line at startup.** The container prints one fixed line
  and exits 1; the line never contains the path. `OAUTH_STATE_UNAVAILABLE`
  ("The OAuth state file could not be opened or is not private."): check the
  owner and mode of the file (`0600`) and of the mount, and that no
  `-wal` or `-shm` file exists. `OAUTH_STATE_LOCKED` ("The OAuth state file is
  in use by another process."): stop the other container. `OAUTH_STATE_CORRUPT`
  ("The OAuth state file is not a valid OAuth state file."),
  `OAUTH_STATE_VERSION` ("The OAuth state file was written by a newer
  version.") and `OAUTH_STATE_MISMATCH` ("The OAuth state file belongs to
  another issuer, audience or upstream."): see the actions in
  [docs/oauth-proxy.md](oauth-proxy.md); deleting the file and its `-journal`
  while the server is stopped is the way to start over, and every user then
  logs in again.
- **Intermittent `502`.** The reverse proxy reuses upstream connections longer
  than 5 s (step 4).
- **Tools fail while the server runs.** A JSON line
  `{"event":"kdrive_upstream_refused","status":401}` (or `403`) means kDrive
  refused the token: replace the token file and restart.
  `kdrive_upstream_unavailable` means kDrive did not answer.

### Deny-pattern root warning

After complete successful preflight, both stdio and HTTP startup offer one
stderr JSON line for each deny pattern proved outside all applicable roots:

```json
{
  "event": "deny_pattern_root_warning",
  "level": "warn",
  "setting": "deny",
  "pattern_index": 0,
  "reason": "outside_configured_roots"
}
```

These are exactly the event's fields. `pattern_index` is the zero-based index
in the effective selected `deny` list (CLI > environment > explicitly selected
YAML > defaults), preserving list order. Look up that entry in your own
configuration: the event contains no pattern, path, identifier or credential.
Warnings appear in ascending index order, at most 256 per startup, before
audit-sink opening or transport activation. A later unrelated startup failure
can follow them; they do not announce readiness. Failed preflight, local-only
configuration loading, `--help` and `--version` do not emit them. Sessions,
tool calls and shutdown do not repeat them. Stdio stdout remains reserved for
MCP; these warnings are neither HTTP responses nor mutation audit records.
Warning writes are best effort and do not refuse startup.

For root `7:/Private/Documents`, `/Documents/Confidential/**` warns because
its first component differs. Use the full API path
`/Private/Documents/Confidential/**` if that is the intended exclusion. Startup
eligibility and runtime filtering are unchanged; no pattern is rewritten.

The diagnostic is conservative. Wildcard components can leave incompatible
patterns silent, and any unknown root path suppresses all warnings. Paths are
startup snapshots; later root moves or renames are not monitored. Silence
does not prove that matching items exist. With `sharedWithMe=true`, the
possible received namespace `/Shared` counts too: `/Shared/Project/**` is
compatible even when the configured roots are elsewhere. `/Other/**` still
warns if it diverges from every configured root and `/Shared`.

Folder-sharing checks retain BR-040's raw character-prefix comparison before
the first wildcard, without component boundaries. For `/Private/Documents`,
`/`, `/*`, `/Private` and `/Private/Documents2/**` therefore remain silent,
including the last pattern's character-prefix overlap. This exception applies
to configured roots only, not synthetic `/Shared`: `/Shared2/**` can still
warn when received shares are enabled. Ancestor-only `/Private` matches that
folder exactly, while `/Private/**` also matches its descendants.

Do not remove a warned pattern automatically. As described in the
[README](../README.md), any non-empty deny list still refuses folder restores,
even if every pattern is flagged. Any non-empty deny list also makes otherwise
eligible folder rename, move, trash and restore operations walk descendants,
and large trees may produce `TRAVERSAL_LIMIT`. The warning does not establish
that the pattern has no effect.
