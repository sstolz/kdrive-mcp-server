#!/bin/sh
# F-015 BR-223, BR-224: supervisor of the isolated self-hosted runner. Runs as
# the kdrive-runner host user from the installed copy /opt/kdrive-runner/ops,
# with the pinned Lima release of /opt/kdrive-runner/lima (install.sh).
#   supervise.sh golden   build the VM once and save its disk as the golden overlay
#   supervise.sh run      one VM restored from the golden overlay per job, forever
#   supervise.sh status   exit 0 when the instance and a 0444 golden overlay exist
#   supervise.sh remove   delete the instance and the golden overlay
set -u
umask 077

here=$(cd "$(dirname "$0")" && pwd)
limactl="$here/../lima/bin/limactl"
instance=kdrive-ci
LIMA_HOME=${LIMA_HOME:-$HOME/.lima}
export LIMA_HOME
instance_dir="$LIMA_HOME/$instance"
state_dir="$HOME/.local/share/kdrive-runner"
golden="$state_dir/golden.qcow2"
token_file="$HOME/.config/kdrive-runner/github-token"
backoff=60
api=https://api.github.com/repos/sstolz/kdrive-mcp-server/actions/runners/generate-jitconfig

log() {
  printf '%s\n' "supervise: $1"
}
fail() {
  printf '%s\n' "supervise: $1" >&2
  exit 1
}

# BR-223: the credential file is a regular non-symlink file owned by this user
# with mode 0600; anything else stops before any call.
token_file_ok() {
  test -f "$token_file" && ! test -L "$token_file" &&
    test "$(stat -c '%u:%a' "$token_file" 2>/dev/null)" = "$(id -u):600"
}
require_token_file() {
  token_file_ok ||
    fail 'the runner token file must be a regular file owned by this user with mode 0600.'
}

# BR-224: the egress filter must refuse a direct UDP datagram with EPERM.
selftest() {
  "$here/egress-selftest.sh"
}

# BR-224: no QEMU process of the instance may survive the forced stop.
qemu_gone() {
  pid_file="$instance_dir/qemu.pid"
  test -e "$pid_file" || return 0
  pid=$(cat "$pid_file") || return 1
  case "$pid" in
    '' | *[!0-9]*) return 1 ;;
  esac
  ! ps -p "$pid" >/dev/null 2>&1
}

# Lima 2.x keeps the instance disk in <instance>/disk (no basedisk/diffdisk).
# Replaces the writable disk with a fresh overlay backed by the golden overlay.
fresh_disk() {
  next="$instance_dir/disk.new"
  rm -f "$next"
  qemu-img create -f qcow2 -F qcow2 -b "$golden" "$next" >/dev/null || return 1
  mv -f "$next" "$instance_dir/disk"
}

# BR-223: one JIT configuration; the credential goes to curl on stdin only.
request_jit() {
  token=$(cat "$token_file") || return 1
  test -n "$token" || return 1
  name="kdrive-ci-$(date -u +%Y%m%dT%H%M%SZ)"
  body=$(printf '{"name":"%s","runner_group_id":1,"labels":["self-hosted","linux","x64","kdrive-ci"],"work_folder":"_work"}' "$name")
  response=$(printf 'Authorization: Bearer %s\n' "$token" |
    curl --silent --show-error --fail --proto '=https' --max-time 30 \
      -X POST -H 'Accept: application/vnd.github+json' \
      -H 'X-GitHub-Api-Version: 2022-11-28' -H @- --data "$body" "$api") ||
    return 1
  token=
  jit=$(printf '%s\n' "$response" |
    sed -n 's/.*"encoded_jit_config"[[:space:]]*:[[:space:]]*"\([A-Za-z0-9+/=]*\)".*/\1/p' |
    head -n 1)
  response=
  test -n "$jit"
}

# BR-222: the JIT configuration reaches the VM on stdin only, as a 0400 file of
# uid 1001 in a 0700 tmpfs directory recreated every cycle.
write_jit() {
  printf '%s' "$jit" | "$limactl" shell --workdir / "$instance" sudo sh -c \
    'umask 077 && rm -rf /run/kdrive-runner && mkdir -m 0700 /run/kdrive-runner && chown 1001:1001 /run/kdrive-runner && cat > /run/kdrive-runner/jitconfig && chown 1001:1001 /run/kdrive-runner/jitconfig && chmod 0400 /run/kdrive-runner/jitconfig'
}

run_runner() {
  "$limactl" shell --workdir / "$instance" sudo sh -c \
    'DOCKER_GID=$(cat /etc/kdrive-runner/docker-gid) && export DOCKER_GID && exec docker compose --project-name kdrive-ci --file /etc/kdrive-runner/compose.yaml up --no-log-prefix --abort-on-container-exit runner' \
    </dev/null
}

# One job: every step before the runner start must succeed, else no disk is
# replaced after the failure and no runner is registered or started.
cycle() {
  selftest || { log 'egress self-test failed; no VM started.'; return 1; }
  "$limactl" stop -f "$instance" >/dev/null 2>&1
  qemu_gone || { log 'a QEMU process of the instance remains after the stop; disk kept.'; return 1; }
  fresh_disk || { log 'the fresh overlay could not be created.'; return 1; }
  "$limactl" start --tty=false "$instance" >/dev/null 2>&1 || { log 'the VM did not start.'; return 1; }
  require_token_file
  request_jit || { log 'the JIT configuration request failed.'; return 1; }
  write_jit || { jit=; log 'the JIT configuration could not be written to the VM.'; return 1; }
  jit=
  log 'runner started.'
  run_runner
  log 'runner exited.'
  return 0
}

golden() {
  selftest || fail 'egress self-test failed; the golden disk was not built.'
  if test -d "$instance_dir"; then
    "$limactl" delete -f "$instance" >/dev/null 2>&1 || fail 'the old instance could not be deleted.'
  fi
  mkdir -p "$state_dir"
  "$limactl" create --name="$instance" --tty=false "$here/lima.yaml" ||
    fail 'the instance could not be created.'
  "$limactl" start --tty=false "$instance" || fail 'the VM did not start.'
  "$limactl" shell --workdir / "$instance" mkdir -p /tmp/kdrive-runner ||
    fail 'the VM shell failed.'
  "$limactl" copy "$here/provision.sh" "$here/Dockerfile" "$here/compose.yaml" \
    "$here/entrypoint.sh" "$here/probe.sh" "$instance:/tmp/kdrive-runner/" ||
    fail 'the provisioning files could not be copied.'
  "$limactl" shell --workdir / "$instance" sudo sh /tmp/kdrive-runner/provision.sh /tmp/kdrive-runner ||
    fail 'provisioning failed.'
  "$limactl" stop "$instance" || fail 'the VM did not stop.'
  rm -f "$golden.new"
  qemu-img convert -O qcow2 "$instance_dir/disk" "$golden.new" ||
    fail 'the golden overlay could not be saved.'
  chmod 0444 "$golden.new"
  if test -e "$golden"; then
    chmod u+w "$golden"
  fi
  mv -f "$golden.new" "$golden"
  log 'golden overlay saved.'
}

status() {
  test -d "$instance_dir" && test -f "$golden" && ! test -L "$golden" &&
    test "$(stat -c '%a' "$golden")" = 444
}

remove() {
  if test -d "$instance_dir"; then
    "$limactl" stop -f "$instance" >/dev/null 2>&1
    "$limactl" delete -f "$instance" >/dev/null 2>&1 || fail 'the instance could not be deleted.'
  fi
  if test -e "$golden"; then
    chmod u+w "$golden"
    rm -f "$golden"
  fi
}

case "${1:-}" in
  golden) golden ;;
  run)
    require_token_file
    cycles=0
    while :; do
      cycle || sleep "$backoff"
      cycles=$((cycles + 1))
      if test -n "${KDRIVE_RUNNER_MAX_CYCLES:-}" && test "$cycles" -ge "$KDRIVE_RUNNER_MAX_CYCLES"; then
        break
      fi
    done
    ;;
  status) status ;;
  remove) remove ;;
  *) fail 'usage: supervise.sh golden|run|status|remove' ;;
esac
