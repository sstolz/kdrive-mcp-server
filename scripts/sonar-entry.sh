#!/bin/sh
# BR-014 v2, BR-145, BR-150: metadata-only checks run before any dev container
# or test prerequisite. Values are never printed; every failure is a fixed text.
set -eu
fail() { printf '%s\n' "$1" >&2; exit 1; }
checkout=$(pwd -P)
target=$1
docker=$2
make_command=$3
makefile=$4
case "$target" in
  sonar|quality) mode=main ;;
  sonar-pr) mode=pr ;;
  *) fail 'Unsupported analysis target.' ;;
esac
# BR-189: an in-checkout secrets path is refused like a credential path.
for reserved in .config/qube-token .config/sonar-host-url secrets; do
  if test -e "$checkout/$reserved" || test -L "$checkout/$reserved"; then
    fail 'A supported credential or host path exists in this checkout. Use an isolated clean checkout.'
  fi
done
# Compose reads .env and override files implicitly; refuse them (BR-150).
compose_guard() {
  for name in compose.override.yaml compose.override.yml docker-compose.override.yaml docker-compose.override.yml .env; do
    if test -e "$checkout/$name" || test -L "$checkout/$name"; then
      fail 'A Compose override or .env file exists in this checkout; analysis refused.'
    fi
  done
}
compose_guard
# Prints the physical path of an external, regular, non-symlink file.
external_file() {
  case "$1" in /*) ;; *) fail 'Selected files must use an absolute external path.' ;; esac
  directory=${1%/*}
  basename=${1##*/}
  case "$basename" in ''|.|..) fail 'Invalid file selector.' ;; esac
  test -n "$directory" || directory=/
  physical=$(CDPATH= cd -P "$directory" 2>/dev/null && pwd -P) || fail 'Selected file directory is unavailable.'
  canonical=$physical/$basename
  case "$canonical" in "$checkout"/*) fail 'Selected file is inside the dev checkout. Use an isolated clean checkout.' ;; esac
  test ! -L "$canonical" || fail 'Selected file symlinks are forbidden.'
  test -f "$canonical" && test -r "$canonical" || fail 'Selected file is unavailable.'
  printf '%s\n' "$canonical"
}
if test "${SONAR_TOKEN+x}" = x && test "${SONAR_TOKEN_FILE+x}" = x; then
  fail 'Select exactly one credential mode.'
fi
token_file=false
if test "${SONAR_TOKEN_FILE+x}" = x; then
  SONAR_TOKEN_FILE=$(external_file "$SONAR_TOKEN_FILE") || exit 1
  export SONAR_TOKEN_FILE
  token_file=true
elif test "${SONAR_TOKEN+x}" = x; then
  # This checks the selected environment value only; file content is never read here.
  case "$SONAR_TOKEN" in *[![:space:]]*) ;; *) fail 'Analysis token is empty.' ;; esac
else
  fail 'Select SONAR_TOKEN or an explicit external SONAR_TOKEN_FILE.'
fi
if test "${SONAR_HOST_URL+x}" = x && test "${SONAR_HOST_URL_FILE+x}" = x; then
  fail 'Select exactly one analysis host mode.'
fi
host_file=false
if test "${SONAR_HOST_URL_FILE+x}" = x; then
  SONAR_HOST_URL_FILE=$(external_file "$SONAR_HOST_URL_FILE") || exit 1
  export SONAR_HOST_URL_FILE
  host_file=true
elif test "${SONAR_HOST_URL+x}" = x; then
  # The wrapper validates the value; it is never printed here.
  case "$SONAR_HOST_URL" in *[![:space:]]*) ;; *) fail 'Analysis host is empty.' ;; esac
else
  fail 'Select SONAR_HOST_URL or an explicit external SONAR_HOST_URL_FILE.'
fi
test "${SONAR_ENABLED:-}" = true || fail 'Remote analysis is not enabled.'
pristine=
if test "${SONAR_PRISTINE_TAR+x}" = x; then
  pristine=$(external_file "$SONAR_PRISTINE_TAR") || exit 1
elif test "${GITHUB_ACTIONS:-}" = true; then
  fail 'SONAR_PRISTINE_TAR is required in CI.'
else
  printf '%s\n' 'Local run without SONAR_PRISTINE_TAR: the pristine snapshot and manifest comparisons are skipped.' >&2
fi
if test "$target" = quality; then
  "$make_command" -f "$makefile" -S check
fi
"$make_command" -f "$makefile" -S _require-setup
mkdir -p "$checkout/artifacts/sonar-input"
# One outer watchdog bounds container startup, snapshot preparation and analysis.
# Its names are invocation-owned; no unrelated container or volume is touched.
owner=$$
SONAR_INVOCATION_ID=$owner
SONAR_ANALYSIS_MODE=$mode
export SONAR_INVOCATION_ID SONAR_ANALYSIS_MODE
prep=kdrive-sonar-prep-$owner
scan=kdrive-sonar-scan-$owner
extracted=
cleanup() {
  if test -n "${watchdog:-}"; then kill "$watchdog" 2>/dev/null || :; fi
  "$docker" kill "$prep" "$scan" >/dev/null 2>&1 || :
  if test -n "$extracted"; then rm -rf "$extracted"; fi
}
trap 'cleanup' EXIT
trap 'exit 1' HUP INT TERM
(
  sleep 900 &
  sleeper=$!
  trap 'kill "$sleeper" 2>/dev/null || :; exit 0' TERM HUP INT
  wait "$sleeper"
  "$docker" kill "$prep" "$scan" >/dev/null 2>&1 || :
  printf '%s\n' 'Analysis exceeded its shared 15-minute deadline.' >&2
  kill -TERM "$owner"
) &
watchdog=$!
# The prep service mounts the checkout read-only (BR-150).
"$docker" compose -f compose.yaml --profile prep run --rm --name "$prep" -e SONAR_ENABLED -e SONAR_INVOCATION_ID -e SONAR_ANALYSIS_MODE -e GITHUB_ACTIONS -e GITHUB_EVENT_NAME -e GITHUB_REF -e GITHUB_SHA -e GITHUB_REPOSITORY -e GITHUB_BASE_REF -e SONAR_PR_HEAD_REPOSITORY prep node scripts/sonar-snapshot.ts
compose_guard
parent=$(CDPATH= cd -P "$checkout/artifacts/sonar-input" 2>/dev/null && pwd -P) || fail 'Snapshot directory is unavailable.'
snapshot=$(CDPATH= cd -P "$parent/current-$owner" 2>/dev/null && pwd -P) || fail 'Prepared snapshot is unavailable.'
case "$snapshot" in "$parent"/*) ;; *) fail 'Prepared snapshot is outside artifacts/sonar-input.' ;; esac
run_id=${snapshot##*/}
if test -L "$snapshot/node_modules"; then
  test "$(readlink "$snapshot/node_modules")" = /workspace/node_modules || fail 'Snapshot dependency link is not the reviewed target.'
elif test -e "$snapshot/node_modules"; then
  fail 'Snapshot dependency link is not the reviewed target.'
fi
if test -n "$pristine"; then
  extracted=$(mktemp -d "${TMPDIR:-/tmp}/kdrive-pristine.XXXXXX") || fail 'Temporary directory is unavailable.'
  case "$(CDPATH= cd -P "$extracted" && pwd -P)" in "$checkout"|"$checkout"/*) fail 'Temporary directory is inside the checkout.' ;; esac
  tar -xf "$pristine" -C "$extracted" 2>/dev/null || fail 'Pristine archive is unreadable.'
  diff -r --no-dereference --exclude=coverage --exclude=dist --exclude=analysis-snapshot.json --exclude='*.tsbuildinfo' --exclude=node_modules "$extracted" "$snapshot" >/dev/null 2>&1 || fail 'Snapshot differs from the pristine archive.'
  # GNU diff exclusions match base names at every depth; they cover root entries only.
  nested=$(find "$snapshot" -mindepth 2 \( -name coverage -o -name dist -o -name node_modules -o -name analysis-snapshot.json -o -name '*.tsbuildinfo' \) -print -quit) || fail 'Snapshot differs from the pristine archive.'
  test -z "$nested" || fail 'Snapshot differs from the pristine archive.'
fi
if test "${GITHUB_ACTIONS:-}" = true; then
  manifest=$snapshot/analysis-snapshot.json
  test -f "$manifest" && test ! -L "$manifest" || fail 'Snapshot manifest does not match this run.'
  # JSON escapes could alias keys, so the reviewed manifest never contains one.
  if grep -q '\\' "$manifest"; then fail 'Snapshot manifest does not match this run.'; fi
  test "$(grep -c '"commit"' "$manifest")" = 1 || fail 'Snapshot manifest does not match this run.'
  test "$(grep -c '"runId"' "$manifest")" = 1 || fail 'Snapshot manifest does not match this run.'
  grep -Fqx "  \"commit\": \"${GITHUB_SHA:-}\"," "$manifest" || fail 'Snapshot manifest does not match this run.'
  grep -Fqx "  \"runId\": \"$run_id\"," "$manifest" || fail 'Snapshot manifest does not match this run.'
fi
compose_guard
SONAR_SNAPSHOT=$snapshot
export SONAR_SNAPSHOT
set --
if test "$token_file" = true; then set -- "$@" -f compose.sonar-file.yaml; fi
if test "$host_file" = true; then set -- "$@" -f compose.sonar-host-file.yaml; fi
"$docker" compose -f compose.yaml "$@" --profile analysis run --rm --name "$scan" analysis
