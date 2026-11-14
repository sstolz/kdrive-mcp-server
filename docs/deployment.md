# Deployment

This guide covers the container image and the deployment examples of
[F-013](../features/F-013-http-image.md), and gives a step-by-step
[personal server](#personal-server-step-by-step) installation. Read
[Current status](#current-status) first.

## Current status

The runtime image serves kDrive: the production adapter and the stdio and HTTP
runtime of [F-014](../features/F-014-production-kdrive-adapter.md) are
accepted, with authenticated HTTP ([F-012](../features/F-012-authenticated-http.md))
behind the OAuth proxy ([F-010](../features/F-010-oauth-proxy.md)), the
write tools of `write` mode ([F-017](../features/F-017-controlled-tree-mutations.md),
[F-018](../features/F-018-upload.md)) and their audit gate
([F-016](../features/F-016-mutation-audit-gate.md)). `share` mode registers no
share tool yet (#20).

The image is built locally; nothing is published to a registry. The runtime image has a `HEALTHCHECK`
([F-021](../features/F-021-container-health-check.md), see
[Health check](#health-check)). On a successful start the HTTP runtime prints nothing; it writes
one line on stderr when startup fails (see [Troubleshooting](#troubleshooting))
and JSON event lines while it runs.

## Build

The production `Dockerfile` is separate from `Dockerfile.dev`. It has four
stages:

- `build` and `deps` run on the build platform (`--platform=$BUILDPLATFORM`)
  from the digest-pinned `node:26.13.0-bookworm` image. `build` compiles
  TypeScript; `deps` installs the production dependencies from the lockfile,
  without optional native packages, and removes its npm cache.
- `runtime` starts from the digest-pinned `node:26.13.0-bookworm-slim` image
  and only copies `dist/`, `node_modules/`, `package.json`,
  `package-lock.json`, `LICENSE`, `NOTICE` and `README.md` into `/app`. Its
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
the container network; no host port is published. Every installation-specific
value in `compose.yaml` is a required `${NAME:?…}` variable, so Compose refuses
to start until it is set. The public URL, for example
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
  waits for each write already past its audit intent to finish and record its
  outcome (at most a 60 s run deadline plus two 5 s file appends), then exits.
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
- **Audit outcome is authoritative.** A request whose write is in flight when
  shutdown starts receives HTTP 503, and an MCP response can be dropped after a
  client cancellation. Neither says whether the write was performed: the audit
  `outcome` record for that `op` is the authority. An `intent` without an
  `outcome` means the result is unknown; check the item in kDrive before any new
  attempt. Such an `intent` can also come from an intent append that timed out
  after 5,000 ms: that run returned `AUDIT_UNAVAILABLE` and sent nothing, but
  the check is still advised.
- **stderr durability.** With the default `KDRIVE_MCP_AUDIT_LOG=stderr`, records
  are as durable as whatever collects the container's stderr, and a collector
  that stops reading holds the write that waits for its record. Use a file on a
  writable mount for a durable trail.
- **Received shares.** `KDRIVE_MCP_SHARED_WRITE=1` authorizes no write inside a
  received share yet: every received-share mutation stays denied until a later
  ticket qualifies it.

## Personal server, step by step

This path runs one container on your own server, behind a TLS reverse proxy
(Traefik in [`examples/compose.yaml`](../examples/compose.yaml)), connected to
your kDrive and to a remote AI client. The values below
(`mcp.example.com`, the deployment directory `kdrive-mcp`) are examples.

You need:

- a server with Docker Engine, the Compose and Buildx plugins, Git and GNU
  Make 3.81 or later;
- a reverse proxy that terminates TLS for a public host name, for example
  `mcp.example.com`, on a Docker network the container can join;
- an OpenID Connect provider where you can register a confidential OAuth
  client (for example Infomaniak's);
- an Infomaniak API token for kDrive from an account with the **admin** role
  on every configured drive: startup checks the role and refuses otherwise.

### 1. Build the image on the server

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

### 2. Register the OAuth client at your provider

Choose the public MCP URL first. It needs a path, for example
`https://mcp.example.com/mcp`; an origin-only URL is refused. Register a
confidential client at your OpenID Connect provider with the redirect URI
`<MCP_PUBLIC_URL>/oauth/callback`, here
`https://mcp.example.com/mcp/oauth/callback`. Note the issuer URL exactly as
the provider's `/.well-known/openid-configuration` gives it (a trailing slash
matters), the client ID and the client secret.

### 3. Provision the three secret files

Put them in a `secrets` directory readable by UID 1000 (the runtime user) and
by nobody else. Each file is read once at startup; one trailing newline is
ignored.

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

Copy [`examples/compose.yaml`](../examples/compose.yaml) into the deployment
directory as `compose.yaml`, and set its variables in the shell
or in a `.env` file next to it (Compose reads that file; the server itself
reads none). The `.env` file holds no secret, only the paths to the secret
files, relative to the deployment directory:

```sh
KDRIVE_MCP_IMAGE=kdrive-mcp-server:runtime-amd64
MCP_PUBLIC_URL=https://mcp.example.com/mcp
MCP_HOSTNAME=mcp.example.com
KDRIVE_ID=123456
OAUTH_ISSUER=https://login.example.com
OAUTH_UPSTREAM_CLIENT_ID=<client id>
OAUTH_ALLOWED_EMAILS=you@example.com
OAUTH_ALLOWED_REDIRECT_URIS=<client callback URLs>
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
  `123456:/Documents`) and, if needed, `KDRIVE_MCP_DENY` to the `environment`
  of the service; the [README](../README.md#configure) lists the settings.
- The reverse proxy must preserve the `Host` header and close idle upstream
  keep-alive connections in less than 5 s, the server's keep-alive timeout;
  otherwise reused sockets can produce intermittent 502 responses. With
  Traefik, reference a `serversTransport` whose
  `forwardingTimeouts.idleConnTimeout` is below 5 s; if Traefik obtains the
  certificate through ACME, also add the router's `tls.certresolver` label.
  Add per-client-IP rate and connection limits there too
  ([OAuth proxy notes](oauth-proxy.md#limits-and-residual-risks)).

Check the file with `docker compose config`; Compose names any variable still
unset.

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

## Troubleshooting

- **The container exits at startup.** It prints one line and exits 1:
  `Configuration error [<code>] (<setting>).` names the code and the setting
  without its value, for example `[MISSING_REQUIRED]` for an unset setting,
  `[CREDENTIAL_READ_FAILED]` for a secret file that is missing or not readable
  by UID 1000, `[CREDENTIAL_INVALID]` for an empty or non-UTF-8 secret file, `[DRIVE_NOT_ALLOWED]` when the token's account is not admin of a
  drive or a root names a drive that is not configured, `[ROOT_NOT_RESOLVED]` for a root that is not a folder, and
  `[PREFLIGHT_FAILED]` when kDrive refused or did not answer the startup
  checks. The [configuration reference](../features/F-002-configuration.md)
  lists every code. HTTP startup refusals print a fixed sentence instead, for
  example "The public URL of an authenticated server requires a path."; a
  signing key that is not one PKCS#8 PEM EC P-256 key, or a port that cannot
  be bound, prints "The HTTP listener could not be started.". An audit log that cannot be opened prints "The audit log could not be opened or
  is not a private regular file." (check the owner and mode of the file and
  of the mount). With `restart: on-failure:3`, Compose retries three times.
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
