#!/bin/sh
# F-015 BR-226: classify the changed paths of a CI run.
# Usage: scripts/ci-changes.sh <event> < paths (one per line).
# Prints exactly `heavy=<true|false>` then `image=<true|false>`. Fail closed:
# only a non-empty pull_request list can turn a value to false.
set -u
set -f

event=${1:-}
heavy=false
image=false
count=0
while IFS= read -r path || test -n "$path"; do
  test -n "$path" || continue
  count=$((count + 1))
  case "$path" in
    runs/* | features/* | business-rules/* | architecture-decisions/* | \
      learnings.md | BACKLOG.md | CHANGELOG.md | capability-map.md) ;;
    *) heavy=true ;;
  esac
  case "$path" in
    Dockerfile | .dockerignore | package.json | package-lock.json | \
      tsconfig.json | tsconfig.build.json | LICENSE | NOTICE | README.md | \
      Makefile | scripts/image-smoke.sh | scripts/http-acceptance.ts | \
      scripts/ci-changes.sh | .github/workflows/ci.yml | src/*)
      image=true
      ;;
  esac
done

if test "$event" != pull_request || test "$count" -eq 0; then
  heavy=true
  image=true
fi
printf 'heavy=%s\nimage=%s\n' "$heavy" "$image"
