#!/bin/sh
# F-014 BR-211/BR-212/BR-215: metadata-only checks of the owner-provided
# kDrive acceptance directory, run before any Docker command or Make
# prerequisite. Paths and file contents are never printed; every failure is
# one fixed line. F-017 BR-276 adds write-acceptance, which first requires
# KDRIVE_WRITE_FOLDER (a positive decimal folder ID); F-018 BR-287 adds
# upload-acceptance under the same conditions.
# Usage: kdrive-entry.sh <record|acceptance|write-acceptance|upload-acceptance> DOCKER MAKE MAKEFILE
set -eu
fail() { printf '%s\n' "$1" >&2; exit 1; }
checkout=$(pwd -P)
target=${1-}
docker=${2-}
make_command=${3-}
makefile=${4-}
newline='
'
case "$target" in record|acceptance|write-acceptance|upload-acceptance) ;; *) fail 'Unknown kDrive owner target.' ;; esac
if test "$target" = write-acceptance || test "$target" = upload-acceptance; then
  folder=${KDRIVE_WRITE_FOLDER-}
  invalid_folder='Set KDRIVE_WRITE_FOLDER to a positive decimal folder ID.'
  case "$folder" in ''|0*|*[!0-9]*) fail "$invalid_folder" ;; esac
  test "${#folder}" -le 15 || fail "$invalid_folder"
fi
compose_guard() {
  for name in compose.override.yaml compose.override.yml docker-compose.override.yaml docker-compose.override.yml .env; do
    if test -e "$checkout/$name" || test -L "$checkout/$name"; then
      fail 'A Compose override or .env file exists in this checkout; analysis refused.'
    fi
  done
}
compose_guard
selected=${KDRIVE_ACCEPTANCE_DIR-}
invalid_selection='Set KDRIVE_ACCEPTANCE_DIR to an absolute directory outside the checkout.'
case "$selected" in /*) ;; *) fail "$invalid_selection" ;; esac
case "$selected" in *:*|*"$newline"*) fail "$invalid_selection" ;; esac
case "/$selected/" in */./*|*/../*) fail "$invalid_selection" ;; esac
while :; do
  case "$selected" in */) selected=${selected%/} ;; *) break ;; esac
done
test -n "$selected" || selected=/
unavailable='The kDrive acceptance directory is unavailable.'
test ! -L "$selected" || fail "$unavailable"
test -d "$selected" || fail "$unavailable"
physical=$(CDPATH= cd -P "$selected" 2>/dev/null && pwd -P) || fail "$unavailable"
test -r "$physical" || fail "$unavailable"
inside='The kDrive acceptance directory is inside the dev checkout.'
case "$physical" in *:*|*"$newline"*) fail "$inside" ;; esac
case "$physical" in "$checkout"|"$checkout"/*) fail "$inside" ;; esac
test "$physical" != / || fail "$inside"
case "$checkout" in "$physical"/*) fail "$inside" ;; esac
for name in kdrive-token fixtures.json; do
  file=$physical/$name
  test ! -L "$file" || fail 'A kDrive acceptance file is unavailable.'
  test -f "$file" && test -r "$file" || fail 'A kDrive acceptance file is unavailable.'
done
for entry in "$physical"/* "$physical"/.[!.]* "$physical"/..?*; do
  case "${entry##*/}" in kdrive-token|fixtures.json) continue ;; esac
  if test -e "$entry" || test -L "$entry"; then
    fail 'The kDrive acceptance directory holds other entries.'
  fi
done
if test "$target" != record; then
  # BR-215: "actual main" is a clean worktree whose HEAD equals the
  # origin/main ref the owner fetched beforehand (BR-276 for write-acceptance).
  name=kdrive-$target
  test -z "$(git status --porcelain 2>/dev/null)" && git rev-parse --verify -q HEAD >/dev/null 2>&1 \
    || fail "$name requires a clean worktree."
  head=$(git rev-parse --verify -q HEAD 2>/dev/null) || fail "$name requires HEAD to equal origin/main."
  main=$(git rev-parse --verify -q refs/remotes/origin/main 2>/dev/null) || fail "$name requires HEAD to equal origin/main."
  test "$head" = "$main" || fail "$name requires HEAD to equal origin/main."
fi
"$make_command" -f "$makefile" -S build
compose_guard
# The directory is mounted read-only for this run only; the token reaches the
# process only through KDRIVE_TOKEN_FILE.
if test "$target" = record; then
  exec "$docker" compose -f compose.yaml run --rm -T \
    --volume "$physical:/run/kdrive-acceptance:ro" \
    -e KDRIVE_TOKEN_FILE=/run/kdrive-acceptance/kdrive-token \
    dev node scripts/kdrive-record.ts
fi
if test "$target" = write-acceptance; then
  exec "$docker" compose -f compose.yaml run --rm -T \
    --volume "$physical:/run/kdrive-acceptance:ro" \
    -e KDRIVE_TOKEN_FILE=/run/kdrive-acceptance/kdrive-token \
    -e "KDRIVE_ACCEPTANCE_SHA=$head" \
    -e "KDRIVE_WRITE_FOLDER=$folder" \
    dev node scripts/kdrive-write-acceptance.ts
fi
if test "$target" = upload-acceptance; then
  exec "$docker" compose -f compose.yaml run --rm -T \
    --volume "$physical:/run/kdrive-acceptance:ro" \
    -e KDRIVE_TOKEN_FILE=/run/kdrive-acceptance/kdrive-token \
    -e "KDRIVE_ACCEPTANCE_SHA=$head" \
    -e "KDRIVE_WRITE_FOLDER=$folder" \
    dev node scripts/kdrive-upload-acceptance.ts
fi
exec "$docker" compose -f compose.yaml run --rm \
  --volume "$physical:/run/kdrive-acceptance:ro" \
  -e KDRIVE_TOKEN_FILE=/run/kdrive-acceptance/kdrive-token \
  -e "KDRIVE_ACCEPTANCE_SHA=$head" \
  dev node scripts/kdrive-acceptance.ts
