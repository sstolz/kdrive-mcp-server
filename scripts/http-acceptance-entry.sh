#!/bin/sh
# BR-171 v3: metadata-only checks of the owner-provided acceptance secrets
# directory (unchanged from v2) and of the optional state directory (BR-397),
# run before any Docker command or Make prerequisite. Paths and file contents
# are never printed; every failure is one fixed line.
set -eu
fail() { printf '%s\n' "$1" >&2; exit 1; }
checkout=$(pwd -P)
docker=${1-}
make_command=${2-}
makefile=${3-}
newline='
'
# Compose reads .env and override files implicitly; refuse them (BR-150, same
# guard and line as scripts/sonar-entry.sh).
compose_guard() {
  for name in compose.override.yaml compose.override.yml docker-compose.override.yaml docker-compose.override.yml .env; do
    if test -e "$checkout/$name" || test -L "$checkout/$name"; then
      fail 'A Compose override or .env file exists in this checkout; analysis refused.'
    fi
  done
}
compose_guard
if test -e "$checkout/secrets" || test -L "$checkout/secrets"; then
  fail 'A secrets path exists in this checkout. Move the acceptance secrets outside the checkout.'
fi
selected=${HTTP_ACCEPTANCE_SECRETS_DIR-}
invalid_selection='Set HTTP_ACCEPTANCE_SECRETS_DIR to an absolute directory outside the checkout.'
case "$selected" in /*) ;; *) fail "$invalid_selection" ;; esac
case "$selected" in *:*|*"$newline"*) fail "$invalid_selection" ;; esac
# A `.` or `..` component would let a symlinked parent pass the symlink check.
case "/$selected/" in */./*|*/../*) fail "$invalid_selection" ;; esac
while :; do
  case "$selected" in */) selected=${selected%/} ;; *) break ;; esac
done
test -n "$selected" || selected=/
unavailable='The acceptance secrets directory is unavailable.'
test ! -L "$selected" || fail "$unavailable"
test -d "$selected" || fail "$unavailable"
physical=$(CDPATH= cd -P "$selected" 2>/dev/null && pwd -P) || fail "$unavailable"
# The directory must be listable, or the extra-entry check below sees nothing.
test -r "$physical" || fail "$unavailable"
inside='The acceptance secrets directory is inside the dev checkout.'
case "$physical" in *:*|*"$newline"*) fail "$inside" ;; esac
case "$physical" in "$checkout"|"$checkout"/*) fail "$inside" ;; esac
test "$physical" != / || fail "$inside"
case "$checkout" in "$physical"/*) fail "$inside" ;; esac
for name in upstream-client-secret signing-key.pem; do
  file=$physical/$name
  test ! -L "$file" || fail 'An acceptance secret file is unavailable.'
  test -f "$file" && test -r "$file" || fail 'An acceptance secret file is unavailable.'
done
# Only the two files are mounted; any other entry, hidden ones included, is refused.
for entry in "$physical"/* "$physical"/.[!.]* "$physical"/..?*; do
  case "${entry##*/}" in upstream-client-secret|signing-key.pem) continue ;; esac
  if test -e "$entry" || test -L "$entry"; then
    fail 'The acceptance secrets directory holds other entries.'
  fi
done
# BR-397: the optional private state directory, checked after the secrets
# directory and before any Docker command; mounted read-write for this run only.
if test -n "${OAUTH_STATE_FILE-}"; then
  fail 'Do not set OAUTH_STATE_FILE; set HTTP_ACCEPTANCE_STATE_DIR to persist the acceptance OAuth state.'
fi
state=${HTTP_ACCEPTANCE_STATE_DIR-}
state_physical=
if test -n "$state"; then
  state_selection='Set HTTP_ACCEPTANCE_STATE_DIR to an absolute directory outside the checkout.'
  case "$state" in /*) ;; *) fail "$state_selection" ;; esac
  case "$state" in *:*|*"$newline"*) fail "$state_selection" ;; esac
  case "/$state/" in */./*|*/../*) fail "$state_selection" ;; esac
  while :; do
    case "$state" in */) state=${state%/} ;; *) break ;; esac
  done
  test -n "$state" || state=/
  state_unavailable='The acceptance state directory is unavailable.'
  test ! -L "$state" || fail "$state_unavailable"
  test -d "$state" || fail "$state_unavailable"
  state_physical=$(CDPATH= cd -P "$state" 2>/dev/null && pwd -P) || fail "$state_unavailable"
  test -r "$state_physical" && test -w "$state_physical" && test -x "$state_physical" || fail "$state_unavailable"
  state_inside='The acceptance state directory is inside the dev checkout.'
  case "$state_physical" in *:*|*"$newline"*) fail "$state_inside" ;; esac
  case "$state_physical" in "$checkout"|"$checkout"/*) fail "$state_inside" ;; esac
  test "$state_physical" != / || fail "$state_inside"
  case "$checkout" in "$state_physical"/*) fail "$state_inside" ;; esac
  state_overlap='The acceptance state directory overlaps the secrets directory.'
  case "$state_physical" in "$physical"|"$physical"/*) fail "$state_overlap" ;; esac
  case "$physical" in "$state_physical"/*) fail "$state_overlap" ;; esac
  shared=$(find "$state_physical" -prune \( -perm -040 -o -perm -020 -o -perm -010 -o -perm -004 -o -perm -002 -o -perm -001 \) -print 2>/dev/null) \
    || fail "$state_unavailable"
  test -z "$shared" || fail 'The acceptance state directory is not private.'
  for entry in "$state_physical"/* "$state_physical"/.[!.]* "$state_physical"/..?*; do
    case "${entry##*/}" in oauth-state.sqlite|oauth-state.sqlite-journal) continue ;; esac
    if test -e "$entry" || test -L "$entry"; then
      fail 'The acceptance state directory holds other entries.'
    fi
  done
  for name in oauth-state.sqlite oauth-state.sqlite-journal; do
    file=$state_physical/$name
    if test -e "$file" || test -L "$file"; then
      test ! -L "$file" && test -f "$file" || fail 'An acceptance state file is unavailable.'
    fi
  done
fi
port=${HTTP_ACCEPTANCE_PORT:-3000}
"$make_command" -f "$makefile" -S build
compose_guard
# BR-171 v3: the state arguments only when a state directory is set.
set --
if test -n "$state_physical"; then
  set -- --volume "$state_physical:/run/oauth-state" \
    -e OAUTH_STATE_FILE=/run/oauth-state/oauth-state.sqlite
fi
# The secrets directory is mounted read-only for this run only (D-20).
exec "$docker" compose -f compose.yaml run --rm --publish "127.0.0.1:$port:$port" \
  -e MCP_HTTP_HOST=0.0.0.0 -e "MCP_HTTP_PORT=$port" \
  -e MCP_PUBLIC_URL -e OAUTH_ISSUER -e OAUTH_ALLOWED_SUBJECTS -e OAUTH_ALLOWED_EMAILS \
  -e OAUTH_UPSTREAM_CLIENT_ID -e OAUTH_ALLOWED_REDIRECT_URIS -e OAUTH_ALLOWED_CLIENT_ID_ORIGINS \
  --volume "$physical:/run/secrets:ro" \
  -e OAUTH_UPSTREAM_CLIENT_SECRET_FILE=/run/secrets/upstream-client-secret \
  -e OAUTH_SIGNING_KEY_FILE=/run/secrets/signing-key.pem \
  "$@" dev node scripts/http-acceptance.ts
