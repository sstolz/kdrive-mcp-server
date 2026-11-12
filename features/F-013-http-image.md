---
id: F-013
title: Multi-architecture HTTP container image and deployment examples
ticket: "#13, #101"
status: done
version: 3
---

Version 3 author: Claude Sonnet 5.5 (effort unknown), spec phase, 2026-11-11.
It allocates no new F or BR ID (`ls features business-rules`: next free IDs
F-019 and BR-290, not needed; re-check before freeze and before the PR).

## Version 3 (#101)

Version 3 changes only what this section states. The version 2 text below
stays in force for everything else. Version 2, accepted, is kept in
[history](history/F-013-v2.md).

### Context (v3)

Ticket #101 turns `docs/deployment.md` into a personal-server deployment
guide. BR-187 v1 requires the Current status section to contain verbatim the
sentence "The runtime image does not serve kDrive yet: until the HTTP runtime
and the kDrive adapter land (#6, #7), the container reports that the runtime
is not implemented and exits 1." That sentence has been false since F-014
(accepted 2026-11-09), which made the image serve kDrive over stdio and HTTP.
The rule is active and tested (`validateDeploymentDoc` in
`tests/helpers/deployment.ts`, `tests/deployment-examples.test.ts`), so the
guide cannot be corrected without changing the rule.

Users affected: operators, who read an honest status before relying on the
image; maintainers, whose hygiene test pins the doc.

### Scope (v3)

1. BR-187 v2: the status requirement is replaced by a truthful one, and the
   doc must also carry the "Personal server, step by step" and
   "Troubleshooting" sections.
2. AC-08 v2: the test checks the new requirements and rejects the old
   sentence.
3. Records: BR-187 v2 with a History line, the `business-rules/README.md`
   row.

BR-184, BR-185 and BR-186 are unchanged: the examples keep their `${NAME:?...}`
variables, `KDRIVE_MCP_MODE: read` stays a literal and `stop_grace_period: 75s`
stays, which satisfies BR-184; BR-186 hygiene applies to the new doc text as
before.

#### Out of scope (v3)

- Publishing the image to a registry.
- Adding a health check (`HEALTHCHECK` or a probe route).
- Any release, tag or version bump.
- Any change under `src/`.

### Business rules (v3)

- **BR-187 v2** (was v1: sections Build, Startup, Secrets, Shutdown and
  Current status, with a verbatim "does not serve kDrive yet" sentence).
  `docs/deployment.md` has sections Build, Startup, Secrets, Shutdown,
  Current status, "Personal server, step by step" and Troubleshooting. A
  section is the text after a line that is exactly `## <title>` (case-sensitive)
  up to the next line starting with `## `; phrases are matched as
  case-sensitive substrings of its text with whitespace runs collapsed to one
  space, as in v1. The whole doc does not contain the v1 sentence
  (whitespace-collapsed, case-insensitive). Current status does not contain
  "not implemented" (case-insensitive) and states
  "The runtime image serves kDrive", "nothing is published to a registry" and
  "It has no `HEALTHCHECK`". Every other v1 clause is unchanged: Startup
  states that `0.0.0.0` is the container-internal bind address, that no host
  port is published and that `compose.yaml` and `config.yaml` (with `--config
  /config/config.yaml`) are alternatives; Shutdown states that SIGTERM
  triggers the F-012 BR-169 ordered close and that the grace period must be at
  least 10 s; Secrets states that secret files must be readable by UID 1000
  and are never passed as environment values or build arguments; no file under
  `examples/` or `docs/deployment.md` contains, case-insensitively,
  `production-ready`, `production ready`, `ready for production` or `fully
  working`. Verified by: AC-08.

BR-184, BR-185 and BR-186 are not versioned (see Scope v3).

### Acceptance criteria (v3)

- **AC-08 v2** (BR-186, BR-187 v2) — AC-08 as in v2, with the verbatim status
  sentence replaced by the BR-187 v2 status phrases, plus seeded mutations
  that fail the test: the v1 status sentence reinserted into Current status
  and, separately, into another section; Current status containing "not
  implemented"; each of the three Current status phrases removed; a doc without the
  "Personal server, step by step" section; a doc without the "Troubleshooting"
  section. Verified by: `tests/deployment-examples.test.ts`.

### Decisions (v3)

- **D-13-v3-1 — A version bump, not a doc-only fix.** BR-187 v1 is an active,
  tested rule that demands a sentence now known to be false. Editing the doc
  alone would fail the test; editing the test alone would change an active
  rule without a version. Versioning BR-187 keeps the ID and its purpose
  (an honest status). Rejected: removing the sentence silently; a new BR that
  supersedes BR-187 (the purpose is unchanged); quoting the old sentence anywhere in
  the doc (BR-187 v2 bans it from the whole doc, so readers never meet a false
  status).
- **D-13-v3-2 — No new IDs.** Next free IDs are F-019 and BR-290; none is
  needed.
- **D-13-v3-3 — Required phrases are chosen from the draft.** The three
  Current status phrases above are already present in the draft
  `docs/deployment.md`, as are both new section titles; no doc edit is
  required by this spec. The helper `validateDeploymentDoc` and the
  `STATUS_SENTENCE` constant change with the tests, not here.

### Open questions (v3)

None.

### Stress-test (v3)

Round 1 (`101-spec-review-1-reviewer`, Opus 5.5, on `4fb5a16`): approve, five
minors, all retained:

1. Matching was undefined: BR-187 v2 now defines a section (exact `## <title>`
   line up to the next `## ` line) and the case and whitespace rules.
2. D-13-v3-1 claimed a quote elsewhere would be caught although only Current
   status was scanned: the v1-sentence ban now covers the whole doc, with a
   mutation in another section.
3. The v1 mutation "status sentence removed" had no v2 counterpart: AC-08 v2
   adds one mutation per removed status phrase.
4. The `business-rules/README.md` row kept v1 wording: it now shows v2 and its
   summary, as the BR-260 row did while pending.
5. BR-187 Verification did not name AC-08 v2: added as pending; the test names
   are filled in by the implementation.

Round 2 (`101-spec-review-2-reviewer`, Opus 5.5, diff-only `4fb5a16..1d522b0`):
approve, no finding.

### Freeze (v3)

Frozen autonomously (PROJECT.md D-1) on 2026-11-11: ticket ready, Open
questions empty, independent approval of reviewed SHA `1d522b0` (rounds 1–2
above). Next free IDs re-checked: F-019, BR-290 (none needed).

### Acceptance (v3)

Accepted on main `18c2325` on 2026-11-11 (`make check` rc=0, 133 files /
3,356 tests; AC-08 v2 and AC-07 pass; acceptance (archive issue 101)).
BR-187 v2 is active. The personal-server guide has not been run on a real
server.

## Context

Ticket #13 (P-13, milestone 0.2) asks for amd64/arm64 Docker builds, a non-root
runtime, secret-file configuration, generic Compose/Traefik/YAML examples and
operational startup/shutdown guidance. Its acceptance: both image variants
build; container smoke tests exercise a healthy HTTP answer, an authentication
rejection and a graceful shutdown; the examples contain no real hostname or
installation detail; build artifacts are tested without publishing to GHCR.

State on `main` today:

- `src/cli.ts` validates the configuration, then writes
  `Configuration validated locally; <transport> runtime is not implemented yet.`
  and exits 1. There is no CLI HTTP runtime and no production kDrive adapter;
  both arrive with #6/#7 (milestone 0.5). F-012 D-13 rejected a `--http` CLI
  mode whose tools all fail.
- F-012 BR-171 provides the dev-only acceptance composition
  `scripts/http-acceptance.ts`: authenticated proxy mode through the real HTTP
  layer over a synthetic in-memory drive, secrets only through
  `OAUTH_UPSTREAM_CLIENT_SECRET_FILE` / `OAUTH_SIGNING_KEY_FILE`, SIGTERM/SIGINT
  → `close()` (F-012 BR-169 ordered shutdown) → exit 0. It loads compiled
  modules from `../dist/` and is excluded from the npm package.
- Development is Docker-only (Compose service `dev`, `Dockerfile.dev`,
  Makefile compatible with GNU Make 3.81). Node is pinned to `v26.13.0`
  (`Dockerfile.dev`, `package.json` engines `>=26.13.0 <27`).

Users affected: operators who will self-host the server behind a reverse
proxy (they get an image recipe, examples and guidance, not a working kDrive
deployment yet); maintainers (Make targets and a CI job that keep the image
buildable and smoke-tested on both architectures).

## Scope

1. A production `Dockerfile` (separate from `Dockerfile.dev`) with stages
   `build`, `deps`, `runtime` and `smoke` (D-01, D-02).
2. Make targets `image-binfmt`, `image` and `image-smoke`, and a POSIX shell
   smoke runner `scripts/image-smoke.sh` driven by `image-smoke` (D-03, D-04,
   D-12).
3. A CI job `image` (per-architecture matrix) that builds and smoke-tests each
   architecture, and BR-015 v4: `tests/helpers/ci-policy.ts`, its mutation
   tests in `tests/ci-policy.test.ts` and `business-rules/BR-015.md` (v4,
   pending acceptance) admit that job and its three Make targets.
4. Examples under `examples/`: `compose.yaml` (with Traefik labels) and the
   alternative `config.yaml` (D-06).
5. `docs/deployment.md`: build, startup, secrets, shutdown, current status.
6. Static policy tests (vitest, in `dev`) over the Dockerfile, Makefile,
   `.dockerignore`, workflow, examples and doc.
7. Records prepared as pending: BR files, `business-rules/README.md` rows,
   a provisional `capability-map.md` entry, a `CHANGELOG.md` Unreleased line.

### Out of scope

- A CLI HTTP runtime, a production kDrive adapter or any change to `src/cli.ts`
  (#6/#7).
- Pushing or publishing any image (GHCR or any registry), registry login,
  signing, SBOM, release tags. Release stays under AGENTS.md §7.
- A `HEALTHCHECK` instruction or Compose healthcheck (D-07).
- Changes to `scripts/http-acceptance.ts`, F-012 or F-002 contracts.
- Native arm64 hosted runners (D-08), third-party GitHub Actions.
- Kubernetes manifests, TLS termination inside the container.

## Business rules

- **BR-172** — `Dockerfile` defines stages `build`, `deps`, `runtime` and
  `smoke`, in that order. `build` and `deps` start `FROM
  --platform=$BUILDPLATFORM` and `runtime` starts without `--platform`;
  `smoke` is `FROM runtime`. Every external `FROM` names
  `node:26.13.0-bookworm` (`build`, `deps`) or `node:26.13.0-bookworm-slim`
  (`runtime`) with an `@sha256:<64 hex>` digest. Each of `build` and
  `runtime` runs a check that `node --version` equals `v26.13.0`. Verified
  by: AC-02.
- **BR-173** — `deps` runs `npm ci --omit=dev --omit=optional --ignore-scripts` from the
  lockfile with `--cache` set to a directory that the same `RUN` removes.
  `runtime` has no `RUN` that invokes `npm` and copies into `/app` only
  `dist/` (from `build`), `node_modules/` (from `deps`), `package.json`,
  `package-lock.json`, `LICENSE`, `NOTICE` and `README.md`. The runtime image
  contains no `/app/src`, `/app/tests`, `/app/scripts`, `/app/.git`,
  `/app/secrets`, `/app/.env*`, no `node_modules/typescript` or
  `node_modules/vitest`, no `node_modules/@napi-rs` directory and no `*.node`
  file under `/app/node_modules`. In the runtime image, `node --input-type=module
  -e "await import('/app/dist/extraction-pdf.js')"` (which imports
  `pdfjs-dist`) exits 0. Verified by: AC-02, AC-04.
- **BR-174** — The `runtime` stage ends with `USER 1000:1000`. In the runtime
  image, `find /app \( ! -user 0 -o \( ! -type l -perm /022 \) \) -print`
  prints nothing (every entry is owned by root and no non-symlink entry is
  group- or other-writable). Verified by: AC-02, AC-04.
- **BR-175** — The `runtime` stage sets `ENV NODE_ENV=production`,
  `STOPSIGNAL SIGTERM`, `EXPOSE 3000` and `ENTRYPOINT ["node",
  "/app/dist/cli.js"]` with no `CMD`. Running the runtime image with
  `--version` prints exactly the `version` of `package.json` and exits 0.
  Running it with `--http`, under the BR-180 hardening flags and `--network
  none`, with proxy-mode settings whose URLs and identities are RFC 2606
  names and whose credentials (kDrive token, upstream client secret, signing
  key) are synthetic files generated in the BR-180 tmpfs and passed only
  through `KDRIVE_TOKEN_FILE`, `OAUTH_UPSTREAM_CLIENT_SECRET_FILE` and
  `OAUTH_SIGNING_KEY_FILE`, prints `runtime is not implemented yet` (the
  `src/cli.ts` diagnostic) and exits 1. Verified by: AC-02, AC-04.
- **BR-176** — The `smoke` stage adds only `scripts/http-acceptance.ts` at
  `/app/scripts/http-acceptance.ts` (owned by root, not writable by UID
  1000), sets `ENTRYPOINT ["node", "/app/scripts/http-acceptance.ts"]` and
  keeps `USER 1000:1000`. The smoke runner overrides that entrypoint only to
  prepend the BR-180 secret generation and then `exec`s the same command.
  Verified by: AC-02, AC-06.
- **BR-177** — `make image` first runs `docker buildx version` and fails with
  a message naming Buildx when it fails. Then, for each platform in
  `IMAGE_PLATFORMS` (default `linux/amd64 linux/arm64`), it builds the
  targets `runtime` and `smoke` with `docker buildx build --platform
  <platform> --target <target> --load`, tagged
  `kdrive-mcp-server:<target>-<arch>` (`<arch>` = `amd64` or `arm64`), with
  no `--build-arg` and no secret mount; after each load, `docker image
  inspect --format '{{.Os}}/{{.Architecture}}'` must equal `<platform>`, else
  it fails naming the tag. It never calls `image-binfmt`. Verified by: AC-01,
  AC-05.
- **BR-178** — No `Dockerfile`, Makefile recipe, script or workflow in the
  repository pushes or publishes an image or logs in to a registry: none
  contains `--push`, `docker push`, `docker login`, `type=registry`,
  `push=true` or `ghcr.io`. Verified by: AC-05.
- **BR-179** — The existing `.dockerignore` (which also feeds the
  `Dockerfile.dev` build) is kept and contains at least `.git`,
  `node_modules`, `secrets/`, `.env`, `.env.*`, `*.pem`, `*.key`,
  `coverage/` and `runs/`. The `Dockerfile` declares no `ARG` or `ENV` whose
  name contains `TOKEN`, `SECRET`, `PASSWORD` or `KEY`. Verified by: AC-05.
- **BR-180** — `make image-smoke` runs `scripts/image-smoke.sh` once per
  platform in `IMAGE_PLATFORMS`, against the local
  `kdrive-mcp-server:smoke-<arch>` and `kdrive-mcp-server:runtime-<arch>`.
  Every container it starts uses `--network none`, `--read-only`,
  `--cap-drop ALL`, `--security-opt no-new-privileges:true`, `--tmpfs
  /run/secrets:uid=1000,gid=1000,mode=0700` and no `--init`, `--privileged`
  or `-p`/`--publish`. The smoke container is started exactly as `docker run
  -d <those flags> -e <settings> --entrypoint sh
  kdrive-mcp-server:smoke-<arch> -c '<gen> && exec node
  /app/scripts/http-acceptance.ts'`, where `<gen>` is one `node -e` call that
  writes, with mode 0600, a synthetic EC P-256 signing key
  (`crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })`, the
  only key type F-012's proxy signer accepts) to `/run/secrets/signing-key.pem`, and 32
  random bytes in hex to each of `/run/secrets/upstream-client-secret` and
  `/run/secrets/kdrive-token`. The runtime checks of BR-173–BR-175 run in
  containers started with the same flags from
  `kdrive-mcp-server:runtime-<arch>`: the `--version` check and the BR-173
  absence, BR-173 import and BR-174 `find` checks run as `docker run <flags>
  --entrypoint <node|find|sh> … `, without secrets; the BR-175 `--http` check
  runs as `docker run <flags> -e <settings> --entrypoint sh
  kdrive-mcp-server:runtime-<arch> -c '<gen> && exec node /app/dist/cli.js
  --http'`, with `KDRIVE_TOKEN_FILE` naming `/run/secrets/kdrive-token`. The settings
  are `MCP_HTTP_HOST=127.0.0.1`, `MCP_HTTP_PORT=3000`,
  `OAUTH_SIGNING_KEY_FILE` and `OAUTH_UPSTREAM_CLIENT_SECRET_FILE` naming
  those files, and RFC 2606 names for every URL and identity setting.
  Verified by: AC-03, AC-06.
- **BR-181** — For each platform the smoke run passes only when all hold:
  (1) the line `http-acceptance listening on` appears in the container log
  within 60 s; (2) `docker exec <id> id -u` prints `1000` and `/proc/1/comm`
  in the container is `node` or `node-MainThread` (Node 26 renames its main
  thread); (3) a GET, sent from inside the container
  with `node:http` and the public URL's `Host`, on the BR-155
  protected-resource metadata URL returns 200 `application/json` whose
  `resource` equals the configured public URL; (4) a POST on the MCP
  endpoint, sent the same way with the public URL's `Host`, `Content-Type:
  application/json`, `Accept: application/json, text/event-stream`, a
  `Content-Length` JSON-RPC `initialize` body, no `Origin` and no
  `Authorization`, returns 401 with a `WWW-Authenticate` header starting
  with `Bearer` and containing `resource_metadata=`; (5) `docker stop --time
  10` delivers SIGTERM to Node as PID 1, whose handler runs F-012 BR-169
  `close()` and exits 0: `docker inspect --format '{{.State.ExitCode}}'`
  prints `0` (137 fails) and the script-measured stop time is below 10 s;
  (6) the runtime checks of BR-173, BR-174 and BR-175 hold. Verified by:
  AC-03, AC-04.
- **BR-182** — `scripts/image-smoke.sh` exits non-zero on the first failed
  check, writes one line naming that check to stderr, and on every exit path
  removes (`docker rm -f`) only the containers it started; it removes no
  image, volume or other container. Verified by: AC-06.
- **BR-183** — The CI workflow has a job `image` on `ubuntu-24.04` with
  `permissions: contents: read`, `timeout-minutes: 30`, no `if`, no `needs`,
  no `env`, no secrets reference and `strategy` `fail-fast: false` with
  `matrix.platform` exactly `[linux/amd64, linux/arm64]`. Its steps are, in
  order: the pinned checkout used by the gate jobs, then `make image-binfmt`,
  `make image` and `make image-smoke`, each with step `env` exactly
  `IMAGE_PLATFORMS: ${{ matrix.platform }}`. It needs no secret, so it runs
  on every pull request, fork pull requests included, and on every main
  push. Verified by: AC-05, AC-09.
- **BR-015 v4** — BR-015 v3 holds with these changes: the exact job set adds
  `image` (shape of BR-183); the Make-only `run` allowlist adds `make
  image-binfmt`, `make image` and `make image-smoke`, admitted only in the
  `image` job; `uses` still admits only `actions/checkout@<40-hex SHA>`.
  Verified by: AC-09.
- **BR-184** — `examples/compose.yaml` defines one service whose image is
  `${KDRIVE_MCP_IMAGE:?…}`, with `user: "1000:1000"`, `read_only: true`,
  `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `init: true`,
  `restart: on-failure:3`, `stop_signal: SIGTERM`, `stop_grace_period` of at
  least 10 s, no `ports` mapping, environment `KDRIVE_MCP_TRANSPORT: http`,
  `OAUTH_MODE: proxy`, `MCP_HTTP_HOST: 0.0.0.0` and `MCP_HTTP_PORT: "3000"`, Traefik labels routing a `Host(...)` rule to port
  3000, and every credential provided as a Compose file secret mounted under
  `/run/secrets/` and referenced only by `KDRIVE_TOKEN_FILE`,
  `OAUTH_UPSTREAM_CLIENT_SECRET_FILE` and `OAUTH_SIGNING_KEY_FILE`; it sets no
  `KDRIVE_TOKEN` or `OAUTH_UPSTREAM_CLIENT_SECRET` value and no `command`.
  Its service environment, with every `${NAME:?…}` replaced by an RFC 2606
  value and the `*_FILE` paths by temporary synthetic files, is accepted by
  F-002 `loadConfiguration` with transport `http` and OAuth mode `proxy`.
  Verified by: AC-07.
- **BR-185** — `examples/config.yaml` uses only F-002 YAML keys, sets
  `transport: http`, `oauthMode: proxy`, `httpHost: 0.0.0.0` and `httpPort: 3000`, carries credentials only through
  `tokenFile`, `oauthUpstreamClientSecretFile` and `oauthSigningKeyFile` with
  paths under `/run/secrets/`, and is accepted by F-002 `loadConfiguration`
  (`--config`) when its credential paths are replaced by temporary synthetic
  files. Verified by: AC-07.
- **BR-186** — In `examples/**` and `docs/deployment.md`: every scanned
  host is `example.com`, `example.org`, `example.net`, a subdomain of them, or
  `localhost`. Scanned hosts are exactly: the host of each `scheme://…` URL,
  the domain after `@` in each email address, and each argument of a Traefik
  `Host(…)` rule; file names, image names and YAML keys are not hosts. Also,
  the only IP addresses are `0.0.0.0`
  and `127.0.0.1`; after every `scheme://…` URL is removed from the text, no
  path starting with `/home/`, `/Users/`, `/root/`, `/srv/`, `/opt/`,
  `/var/`, `/etc/`, `/mnt/`, `/media/` or `/tmp/`, and no Windows drive path
  (`<letter>:\`), appears; installation-specific Compose values are
  `${NAME:?…}` variables. Verified by: AC-08.
- **BR-187** — `docs/deployment.md` has sections Build, Startup, Secrets,
  Shutdown and Current status. Current status states verbatim: "The runtime
  image does not serve kDrive yet: until the HTTP runtime and the kDrive
  adapter land (#6, #7), the container reports that the runtime is not
  implemented and exits 1." Startup states that `0.0.0.0` is the
  container-internal bind address, that no host port is published and that
  `compose.yaml` and `config.yaml` (with `--config /config/config.yaml`) are
  alternatives. Shutdown states that SIGTERM triggers the F-012 BR-169
  ordered close and that the grace period must be at least 10 s. Secrets
  states that secret files must be readable by UID 1000 and are never passed
  as environment values or build arguments. No file under `examples/` or
  `docs/deployment.md` contains, case-insensitively, `production-ready`,
  `production ready`, `ready for production` or `fully working`. Verified
  by: AC-08.
- **BR-188** — `make image-binfmt`, when `IMAGE_PLATFORMS` contains
  `linux/arm64` and `uname -m` is neither `aarch64` nor `arm64`, runs `docker
  run --rm --privileged tonistiigi/binfmt@sha256:<64 hex> --install arm64`;
  otherwise it prints one skip line and exits 0. It is the only Make recipe
  with `--privileged`, and it is never a prerequisite of another target.
  Verified by: AC-05, AC-01.

## Acceptance criteria

- **AC-01** (BR-172, BR-177, BR-188) — Given a CI runner with Docker and
  Buildx, When the `image` job entry for a platform runs `make image-binfmt`
  and `make image`, Then both exit 0 and `kdrive-mcp-server:runtime-<arch>`
  and `kdrive-mcp-server:smoke-<arch>` exist with `Os/Architecture` equal to
  the platform (checked by the recipe). Verified by: CI job `image`, both
  matrix entries.
- **AC-02** (BR-172, BR-173, BR-174, BR-175, BR-176) — Given the
  `Dockerfile`, When the static policy test parses it, Then stage order and
  names, `--platform=$BUILDPLATFORM` on `build`/`deps` only, digest-pinned
  bases, the Node version checks, the npm cache removal, no `npm` in
  `runtime`, `USER 1000:1000`, `NODE_ENV`, `STOPSIGNAL`, `EXPOSE`,
  entrypoints, the absence of `CMD` in `runtime` and the `COPY` allowlist
  hold, and each mutation (unpinned base, missing `USER`, `COPY . .`, extra
  `smoke` file, `RUN npm` in `runtime`) fails it. Verified by:
  `tests/image-policy.test.ts`.
- **AC-03** (BR-180, BR-181) — Given the built smoke images, When `make
  image-smoke` runs, Then for each platform the startup, UID, PID-1, metadata
  200, unauthenticated 401 and SIGTERM exit-0 checks pass and the run exits
  0. Verified by: CI job `image`, both matrix entries.
- **AC-04** (BR-173, BR-174, BR-175, BR-181) — Given the built runtime
  images, When `make image-smoke` runs its runtime checks, Then `--version`
  prints the `package.json` version with exit 0, `--http` with the BR-175
  configuration prints the not-implemented diagnostic with exit 1, `id -u`
  prints `1000`, the BR-174 `find` prints nothing, and the BR-173 absent
  paths and `*.node` files are absent. Verified by: CI job `image`.
- **AC-05** (BR-177, BR-178, BR-179, BR-183, BR-188) — Given the Makefile,
  `.dockerignore`, `Dockerfile` and CI workflow, When the static policy test
  runs, Then the build and binfmt recipes (digest-pinned binfmt image, sole
  `--privileged`, no prerequisite link), ignore entries, forbidden
  `ARG`/`ENV` names and publish/login markers hold, and each seeded mutation
  (`--push`, `docker login`, `ghcr.io`, a tag-pinned binfmt image, a missing
  `.dockerignore` entry, `image` depending on `image-binfmt`) fails it.
  Verified by: `tests/image-policy.test.ts`.
- **AC-06** (BR-176, BR-180, BR-182) — Given `scripts/image-smoke.sh` run
  against a stub `docker` command on `PATH` that records its arguments and
  fails a chosen check, When it runs, Then the recorded smoke `docker run`
  has the BR-180 flags, `--entrypoint sh`, no `--init` and a `-c` script
  ending in `exec node /app/scripts/http-acceptance.ts`; the script exits
  non-zero, names the failed check on stderr and issues `docker rm -f` only
  for the container IDs it started. Verified by:
  `tests/image-smoke-script.test.ts`.
- **AC-07** (BR-184, BR-185) — Given `examples/compose.yaml` and
  `examples/config.yaml`, When the examples test parses them, Then the
  Compose hardening, restart policy, bind settings, Traefik labels, file
  secrets and absence of inline secrets hold, and both the YAML and the
  Compose service environment load through `loadConfiguration` (transport
  `http`, OAuth mode `proxy`) with synthetic credential files. Verified by:
  `tests/deployment-examples.test.ts`.
- **AC-08** (BR-186, BR-187) — Given `examples/**` and `docs/deployment.md`,
  When the hygiene test scans them, Then only reserved hostnames, the two
  allowed addresses and no denied path appear, the required sections, bind
  statement and verbatim status sentence are present, no denied claim phrase
  appears, and seeded mutations (a non-reserved hostname, `10.0.0.1`, a
  `/home/` path, `production-ready`, the status sentence removed) fail it.
  URL paths such as `https://mcp.example.com/mcp` do not fail it. Verified
  by: `tests/deployment-examples.test.ts`.
- **AC-09** (BR-183, BR-015 v4) — Given the real workflow, When the CI policy
  validator runs, Then it accepts it, and each mutation (an `if` or a
  secrets reference on `image`, a missing `timeout-minutes`, a third matrix
  entry, `uses: docker/setup-qemu-action@<sha>`, `make image` in a gate job,
  `make image --push`) fails it. Verified by: `tests/ci-policy.test.ts`.

## Decisions

- **D-01 (owner, 2026-11-04) — Two image targets over shared layers.**
  Chosen: `runtime` (production, non-root, entrypoint = packaged CLI, honest
  not-implemented diagnostic until #6/#7, then a real HTTP runtime with no
  image change beyond the CLI) and `smoke` (`runtime` + the dev-only BR-171
  composition, used only by container smoke tests, never published).
  Rejected: a production `--http` CLI mode without a drive (contradicts F-012
  D-13: every tool would fail); deferring #13 to milestone 0.5 (leaves the
  image, examples and multi-arch build untested until the adapter lands).
- **D-02 — Multi-stage build with native build stages.** `build` (npm ci +
  TypeScript build) and `deps` (production dependencies) use the same
  digest-pinned `node:26.13.0-bookworm` as `Dockerfile.dev` and run on
  `$BUILDPLATFORM`, so `npm ci` and `tsc` never run under emulation; their
  output is pure JavaScript (no `*.node` file, checked by BR-173), so it is
  valid for both targets. `runtime` uses `node:26.13.0-bookworm-slim` and
  only copies. Digests are the official manifest-list digests, verified at
  implementation time and recorded with the date in a comment. Rejected:
  reusing `Dockerfile.dev` (mixes dev and production); distroless (no `sh`
  for the smoke secret bootstrap); Alpine (musl, different Node build).
- **D-03 — Make drives Buildx on the host Docker engine.** Image builds need
  the Docker engine; the `dev` Compose service has no Docker client or
  socket, by rule (F-001: no Docker socket mount; AGENTS.md: never change
  Docker engine or socket permissions). So `image-binfmt`, `image` and
  `image-smoke` are the only recipes that call host `docker` directly, using
  the Buildx shipped with the host Docker (CI: the runner's preinstalled
  Docker, default `docker` driver, `--load` per platform). Node and npm
  still run only inside containers (the build stages and the smoke/runtime
  images; secret generation runs inside the smoke container). Rejected: a
  Docker socket mount in `dev` (forbidden); an OCI tarball export only
  (cannot be run without a load step); a registry cache (implies a push).
- **D-04 — Smoke probes run inside the container with `--network none`.**
  Probes use `docker exec … node` with `node:http` (which allows setting
  `Host`), so no port is published and the composition cannot reach any
  network; OIDC discovery is lazy, so the 401 and metadata paths need no
  upstream call. Rejected: a published host port (exposes a listener; needs
  host HTTP tooling).
- **D-05 — Synthetic secrets generated in tmpfs at run time, PID 1 is Node.**
  The smoke key and client secret are synthetic test material, as in
  `tests/helpers/proxy.ts`; they live only in the container's tmpfs and die
  with it. `sh -c '<gen> && exec node …'` without `--init` makes Node PID 1,
  so `docker stop` delivers SIGTERM to the BR-171 handler. Rejected:
  committed test keys (secret-shaped files in the repo); host temp files
  (persist on the runner); `sh` without `exec` (sh as PID 1 ignores SIGTERM,
  SIGKILL at 10 s, exit 137); `docker exec` launch (not PID 1).
- **D-06 — Examples are templates for the future runtime.** They use the
  `runtime` image and the real F-002 settings, so they stay valid when #6/#7
  land; the doc says plainly that today the container exits 1. `compose.yaml`
  configures by environment and `*_FILE` secrets; `config.yaml` is the
  documented alternative for `--config`. `restart: on-failure:3` bounds a
  crash loop. Rejected: shipping examples only after #6/#7 (ticket
  acceptance requires them now); examples built on `smoke` (would advertise
  a synthetic drive).
- **D-07 — No HEALTHCHECK yet.** The `runtime` image serves nothing today,
  so any healthcheck would be false or always failing; health is exercised by
  the smoke test (BR-181). A healthcheck is added with the HTTP runtime.
- **D-08 — Full smoke on both architectures, arm64 under QEMU.** The repo is
  private, so native `ubuntu-24.04-arm` hosted runners are not assumed. arm64
  is emulated through binfmt registered by a digest-pinned
  `tonistiigi/binfmt` image (BR-188), without third-party Actions, so BR-015
  keeps checkout as the only `uses`. The same checks run on both
  architectures, so "both variants" is evidenced by behaviour. Cost
  trade-off: D-02 keeps `npm ci`/`tsc` native, so emulation covers only the
  runtime `node --version` check, RSA key generation and the smoke run; the
  matrix runs both entries in parallel and `timeout-minutes: 30` bounds a
  stuck emulated run. Rejected: build-only arm64 (misses arch-specific
  runtime failures); `docker/setup-qemu-action` and
  `docker/setup-buildx-action` (third-party Actions, unpinned helper
  images); native arm64 runners (not assumed available for a private repo).
- **D-09 — UID/GID 1000.** Matches the `node` user of the official image and
  is numeric, so orchestrators can enforce non-root. Rejected: UID 0; a
  name-only `USER` (not verifiable as non-root by orchestrators).
- **D-10 — No ADR.** The choices are reversible within the Dockerfile,
  Makefile and workflow; F-013 records them.
- **D-11 — Sonar hygiene.** New TypeScript (tests) uses `replaceAll`,
  `String.fromCodePoint`, `Number.parseInt` and array literals/`Array.from`
  (no S7781/S7758/S7773/S7723 patterns), per `learnings.md` 2026-11-04.
- **D-12 — Declared deviation from the Docker-only clause.** F-001 BR-009
  has every build target delegate to Compose. The three image targets run
  host `docker` instead (D-03), and `image-binfmt` runs one privileged
  container that registers arm64 binfmt handlers in the host kernel (until
  reboot); it changes no Docker engine or socket permission. Locally it is
  opt-in: nothing calls it implicitly. The PR states this deviation. F-001
  gets no new version: its dev-workflow contract is unchanged for every
  existing target, and this ticket adds an image workflow beside it.
  Rejected: building images inside `dev` (needs a socket mount).

## Open questions

None.

## Stress-test

### Round 1 (review `runs/13-spec-review-1.md`, SHA `fa80372`)

- **C-1 (critical)** — retained. BR-015 v4 added to scope and as a rule;
  BR-183 rewritten: per-arch matrix, `timeout-minutes: 30`, no secrets/`if`,
  checkout as the only `uses`. Native arm64 runners rejected by the
  orchestrator (private repo); QEMU kept through a digest-pinned binfmt image
  run by `make image-binfmt` (BR-188) and the runner's Buildx with the
  default `docker` driver (D-08).
- **M-1 (major)** — retained. BR-184/185 set the `0.0.0.0` bind and port
  3000; BR-186 allows only `0.0.0.0` and `127.0.0.1`; BR-187 documents the
  container-internal bind with no published port; BR-180 states the smoke
  `MCP_HTTP_HOST`/`MCP_HTTP_PORT`.
- **M-2 (major)** — retained. BR-180 fixes the exact launch (`--entrypoint
  sh -c '<gen> && exec node …'`, no `--init`); BR-176 reworded; BR-181(2)
  checks PID 1 is `node`, (5) the exit code 0 via SIGTERM to PID 1; AC-06
  asserts the launch; D-05 records the rejected variants.
- **m-1** — retained. Version taken from `package.json`; the `--http`
  configuration is specified in BR-175.
- **m-2** — retained. BR-174 uses the `find` ownership/permission probe,
  excluding symlink modes (npm `.bin` links are always `rwxrwxrwx`).
- **m-3** — retained. BR-181(4) fixes the probe headers and body; (5) defines
  the exit-code and elapsed-time pass condition.
- **m-4** — retained. Native `build`/`deps` stages (`$BUILDPLATFORM`), no
  `*.node` files, npm cache removed in the same `RUN`, no `npm` in `runtime`,
  `timeout-minutes: 30`.
- **m-5** — retained. The `Os/Architecture` check is part of BR-177.
- **m-6** — retained. The deployment-claim rule became a phrase denylist
  (BR-187); the host-path rule became a denylist over text with URLs removed
  (BR-186), so URL paths pass.
- **m-7** — retained. `restart: on-failure:3` is in BR-184; `compose.yaml`
  and `config.yaml` are alternatives (D-06, BR-187), and `compose.yaml` sets
  no `command`.
- **m-8** — retained. D-03/D-12 justify host `docker` (no socket in `dev`,
  by rule) and record the deviation for the PR; BR-179 says the existing
  `.dockerignore` is kept and extended.

### Round 2

Reviewer: Opus 5.5 high on 8948b19 (`runs/13-spec-review-2.md`). Fixes
applied by the orchestrator (mechanical, owner go for a third round on
2026-11-05).

- **M-A (major)** — retained. `deps` installs with `--omit=optional`, so the
  `@napi-rs/canvas` native optional dependency of `pdfjs-dist` (unused by
  `src/`) is absent on every platform; BR-173 checks the directory is absent
  and that `dist/extraction-pdf.js` (which imports `pdfjs-dist`) imports in
  the runtime image. Rejected: per-target `--os/--cpu` installs (keeps a
  native binary the code never loads).
- **m-A (minor)** — retained. BR-184/BR-185 set transport `http` and OAuth
  mode `proxy`; AC-07 also loads the Compose environment through
  `loadConfiguration`.
- **m-B (minor)** — retained. BR-180 defines how runtime checks start and
  makes `<gen>` also write `/run/secrets/kdrive-token`.
- **m-C (minor)** — retained. BR-186 defines the scanned hosts (URL hosts,
  email domains, Traefik `Host(…)` arguments); file and image names are not
  hosts.

### Round 3

Reviewer: Opus 5.5 high, diff-only on 6402a55 (`runs/13-spec-review-3.md`):
**approve**; M-A, m-A, m-B and m-C fixed.

- **m-D (minor)** — accepted as residual risk, no contract change. BR-173's
  import check does not prove PDF text extraction without the optional
  canvas. `src/` never uses canvas and pdfjs-dist treats it as optional; the
  extraction tools are not reachable in the image until a production runtime
  exists (#6/#7), whose acceptance will exercise them. Logged in `BACKLOG.md`.

## Freeze

Frozen autonomously (AGENTS.md project override) on 2026-11-05: ticket ready,
no open question, independent approval of reviewed SHA 6402a55 (rounds 1–3:
`runs/13-spec-review-1.md` … `-3.md`).

### v2 (2026-11-05)

Implementation (`runs/13-development-1.md`) found two factual errors in v1;
v2 corrects them without changing intent: BR-180 generates an EC P-256 key
(F-012 rejects RSA, so v1's smoke container could not start); BR-181(2)
accepts `node-MainThread`, the PID-1 thread name on Node 26.13 (`sh` still
fails). Reviewed with the code review of the implementation PR; frozen again
on that review's approval.
v2 frozen autonomously on 2026-11-05: code review round 1 (Opus 5.5 high,
`runs/13-code-review-1.md`, head 126faa4) approved the v2 correction; its
minor (curve named `prime256v1` here, `P-256` in the code; same curve in
Node) is aligned to `P-256`.
