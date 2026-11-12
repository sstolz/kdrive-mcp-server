#!/bin/sh
# F-015 BR-222: entrypoint of the kdrive-ci-runner:local image. Reads the
# one-job JIT configuration from the tmpfs file written by the supervisor,
# deletes the file, then starts the runner. The value is held only in a
# non-exported shell variable and passed as the --jitconfig argument.
set -u

jit_file=/run/kdrive-runner/jitconfig

fail() {
  printf '%s\n' "kdrive-runner entrypoint: $1" >&2
  exit 1
}

if test -L "$jit_file" || ! test -f "$jit_file"; then
  fail 'the JIT configuration file is missing.'
fi
cfg=$(cat "$jit_file") || fail 'the JIT configuration file is unreadable.'
rm -f "$jit_file" 2>/dev/null
if test -e "$jit_file" || test -L "$jit_file"; then
  cfg=
  fail 'the JIT configuration file could not be deleted.'
fi
test -n "$cfg" || fail 'the JIT configuration file is empty.'
exec ./run.sh --jitconfig "$cfg"
