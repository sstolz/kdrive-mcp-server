#!/bin/sh
# F-013 BR-180–BR-182: container smoke test of one platform's local images.
# Usage: scripts/image-smoke.sh <linux/amd64|linux/arm64>. DOCKER overrides the
# docker client. Every container runs without network, read-only, without
# capabilities; secrets are synthetic and generated in a tmpfs at run time.
set -u
set -f

platform=${1:-}
case "$platform" in
  linux/amd64) arch=amd64 ;;
  linux/arm64) arch=arm64 ;;
  *)
    printf '%s\n' "image-smoke: unsupported platform '$platform'" >&2
    exit 2
    ;;
esac
docker=${DOCKER:-docker}
runtime_image="kdrive-mcp-server:runtime-$arch"
smoke_image="kdrive-mcp-server:smoke-$arch"
root=$(cd "$(dirname "$0")/.." && pwd)
expected_version=$(sed -n 's/^  "version": "\([^"]*\)",$/\1/p' "$root/package.json")
public_url=https://mcp.example.com/mcp

started=""
cleanup() {
  for id in $started; do
    "$docker" rm -f "$id" > /dev/null 2>&1 || true
  done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

fail() {
  printf '%s\n' "image-smoke $platform: check failed: $1" >&2
  exit 1
}

# BR-180 hardening flags; values contain no whitespace or glob characters.
flags="--network none --read-only --cap-drop ALL --security-opt no-new-privileges:true --tmpfs /run/secrets:uid=1000,gid=1000,mode=0700"
settings="-e MCP_HTTP_HOST=127.0.0.1 -e MCP_HTTP_PORT=3000 -e MCP_PUBLIC_URL=$public_url -e KDRIVE_ID=1 -e OAUTH_MODE=proxy -e OAUTH_ISSUER=https://idp.example.com -e OAUTH_ALLOWED_EMAILS=user@example.com -e OAUTH_UPSTREAM_CLIENT_ID=client.example.com -e OAUTH_ALLOWED_REDIRECT_URIS=https://client.example.com/callback -e KDRIVE_TOKEN_FILE=/run/secrets/kdrive-token -e OAUTH_UPSTREAM_CLIENT_SECRET_FILE=/run/secrets/upstream-client-secret -e OAUTH_SIGNING_KEY_FILE=/run/secrets/signing-key.pem"

# One node call: synthetic EC P-256 signing key (the F-012 key type) and two 32-byte hex secrets,
# each written with mode 0600 into the tmpfs.
gen=$(cat << 'EOF'
node -e "const c=require('node:crypto'),f=require('node:fs'),d='/run/secrets/',o={mode:0o600};f.writeFileSync(d+'signing-key.pem',c.generateKeyPairSync('ec',{namedCurve:'P-256'}).privateKey.export({type:'pkcs8',format:'pem'}),o);for(const n of ['upstream-client-secret','kdrive-token'])f.writeFileSync(d+n,c.randomBytes(32).toString('hex'),o)"
EOF
)

# In-container probes (node:http, so Host can be set; nothing is published).
probe_metadata=$(cat << 'EOF'
const r=require('node:http').request({host:'127.0.0.1',port:3000,path:'/.well-known/oauth-protected-resource/mcp',headers:{host:'mcp.example.com'}},(s)=>{let b='';s.on('data',(d)=>{b+=d});s.on('end',()=>{let v='';try{v=JSON.parse(b).resource}catch{}process.stdout.write(s.statusCode+'|'+String(s.headers['content-type']).split(';')[0]+'|'+v+'\n')})});r.on('error',()=>process.exit(1));r.end()
EOF
)
probe_unauthenticated=$(cat << 'EOF'
const b=JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'image-smoke',version:'1'}}});const r=require('node:http').request({host:'127.0.0.1',port:3000,path:'/mcp',method:'POST',headers:{host:'mcp.example.com','content-type':'application/json',accept:'application/json, text/event-stream','content-length':Buffer.byteLength(b)}},(s)=>{s.resume();s.on('end',()=>{process.stdout.write(s.statusCode+'|'+(s.headers['www-authenticate']||'')+'\n')})});r.on('error',()=>process.exit(1));r.end(b)
EOF
)

# F-021 BR-181 v2 (8): GET /healthz with the loopback, public and a foreign Host.
probe_health=$(cat << 'EOF'
const h=require('node:http'),o=[];const g=(l)=>{if(!l.length){process.stdout.write(o.join('\n')+'\n');return}const r=h.request({host:'127.0.0.1',port:3000,path:'/healthz',headers:{host:l[0]}},(s)=>{let b='';s.on('data',(d)=>{b+=d});s.on('end',()=>{o.push(s.statusCode+'|'+String(s.headers['content-type']).split(';')[0]+'|'+b);g(l.slice(1))})});r.on('error',()=>process.exit(1));r.end()};g(['127.0.0.1:3000','mcp.example.com','attacker.example'])
EOF
)
health_ok='200|application/json|{"status":"ok"}'
health_expected=$(printf '%s\n%s\n%s' "$health_ok" "$health_ok" '403|application/json|{"error":"invalid_host"}')
health_format='{{.Config.Healthcheck.Test}}|{{.Config.Healthcheck.Interval}}|{{.Config.Healthcheck.Timeout}}|{{.Config.Healthcheck.StartPeriod}}|{{.Config.Healthcheck.Retries}}'

# Starts a detached hardened container and records its ID for cleanup.
start() {
  id=$("$docker" run -d $flags "$@") || return 1
  started="$started $id"
}

# Waits for a detached container and prints its exit code.
finish() {
  "$docker" wait "$1"
}

# BR-175: --version prints the package version.
start --entrypoint node "$runtime_image" /app/dist/cli.js --version || fail runtime-version
code=$(finish "$id") || fail runtime-version
out=$("$docker" logs "$id" 2> /dev/null) || fail runtime-version
test "$code" = 0 && test "$out" = "$expected_version" || fail runtime-version

# BR-173: no source, tests, scripts, Git, secrets, env files, dev tools,
# native canvas package or native addon in the runtime image.
start --entrypoint sh "$runtime_image" -c 'for p in /app/src /app/tests /app/scripts /app/.git /app/secrets /app/.env* /app/node_modules/typescript /app/node_modules/vitest /app/node_modules/@napi-rs; do if test -e "$p" || test -L "$p"; then exit 1; fi; done; test -z "$(find /app/node_modules -name "*.node" -print)"' || fail runtime-absent
code=$(finish "$id") || fail runtime-absent
test "$code" = 0 || fail runtime-absent

# BR-173: pdfjs-dist imports without its optional native canvas.
start --entrypoint node "$runtime_image" --input-type=module -e "await import('/app/dist/extraction-pdf.js')" || fail runtime-import
code=$(finish "$id") || fail runtime-import
test "$code" = 0 || fail runtime-import

# BR-174: everything under /app is root-owned and not group/other-writable.
start --entrypoint find "$runtime_image" /app '(' '!' -user 0 -o '(' '!' -type l -perm /022 ')' ')' -print || fail runtime-find
code=$(finish "$id") || fail runtime-find
out=$("$docker" logs "$id" 2>&1) || fail runtime-find
test "$code" = 0 && test -z "$out" || fail runtime-find

# BR-174: the runtime user is UID 1000.
start --entrypoint sh "$runtime_image" -c 'id -u' || fail runtime-uid
code=$(finish "$id") || fail runtime-uid
out=$("$docker" logs "$id" 2> /dev/null) || fail runtime-uid
test "$code" = 0 && test "$out" = 1000 || fail runtime-uid

# BR-175 v2: under --network none, --http reaches production preflight, which
# cannot resolve the API host; it prints exactly the sanitized preflight line.
start $settings --entrypoint sh "$runtime_image" -c "$gen && exec node /app/dist/cli.js --http" || fail runtime-http
code=$(finish "$id") || fail runtime-http
out=$("$docker" logs "$id" 2>&1) || fail runtime-http
test "$code" = 1 || fail runtime-http
test "$out" = 'Configuration error [PREFLIGHT_FAILED] (preflight).' || fail runtime-http

# BR-180 v2/BR-181: the smoke composition with Node as PID 1; Docker runs the
# image's health check every 2 s.
start --health-interval=2s $settings --entrypoint sh "$smoke_image" -c "$gen && exec node /app/scripts/http-acceptance.ts" || fail startup
smoke=$id
waited=0
until "$docker" logs "$smoke" 2>&1 | grep -q 'http-acceptance listening on'; do
  running=$("$docker" inspect --format '{{.State.Running}}' "$smoke" 2> /dev/null) || fail startup
  test "$running" = true || fail startup
  waited=$((waited + 1))
  test "$waited" -lt 60 || fail startup
  sleep 1
done
listened=$(date +%s)

out=$("$docker" exec "$smoke" id -u) || fail uid
test "$out" = 1000 || fail uid
out=$("$docker" exec "$smoke" cat /proc/1/comm) || fail pid1
# Node 26 names its main thread node-MainThread; sh would read "sh".
case "$out" in
  node | node-MainThread) ;;
  *) fail pid1 ;;
esac

out=$("$docker" exec "$smoke" node -e "$probe_metadata") || fail metadata
test "$out" = "200|application/json|$public_url" || fail metadata

out=$("$docker" exec "$smoke" node -e "$probe_unauthenticated") || fail unauthenticated
case "$out" in
  "401|Bearer"*resource_metadata=*) ;;
  *) fail unauthenticated ;;
esac

# F-021 BR-181 v2 (7): both images carry the BR-327 health check.
for image in "$runtime_image" "$smoke_image"; do
  out=$("$docker" image inspect --format "$health_format" "$image") || fail healthcheck-config
  test "$out" = '[CMD node /app/dist/healthcheck.js]|10s|10s|30s|3' || fail healthcheck-config
done

# F-021 BR-181 v2 (8): the route answers the loopback and public Host only.
out=$("$docker" exec "$smoke" node -e "$probe_health") || fail healthcheck-route
test "$out" = "$health_expected" || fail healthcheck-route

# F-021 BR-181 v2 (9): Docker reports the smoke container healthy within 30 s
# of the listening line; a transient unhealthy (slow emulated start) may still
# turn healthy before that deadline.
while :; do
  out=$("$docker" inspect --format '{{.State.Health.Status}}' "$smoke" 2> /dev/null) || fail healthcheck-status
  case "$out" in
    healthy) break ;;
    starting | unhealthy) ;;
    *) fail healthcheck-status ;;
  esac
  test $(($(date +%s) - listened)) -lt 30 || fail healthcheck-status
  sleep 1
done

# F-021 BR-180 v2/BR-181 v2 (10): with no server, the probe fails on connection.
start --entrypoint node "$runtime_image" /app/dist/healthcheck.js || fail healthcheck-down
code=$(finish "$id") || fail healthcheck-down
out=$("$docker" logs "$id" 2>&1) || fail healthcheck-down
test "$code" = 1 && test "$out" = 'healthcheck failed: connection' || fail healthcheck-down

before=$(date +%s)
"$docker" stop --time 10 "$smoke" > /dev/null || fail sigterm
elapsed=$(($(date +%s) - before))
code=$("$docker" inspect --format '{{.State.ExitCode}}' "$smoke") || fail sigterm
test "$code" = 0 && test "$elapsed" -lt 10 || fail sigterm

printf '%s\n' "image-smoke $platform: all checks passed"
