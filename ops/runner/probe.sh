#!/bin/bash
# F-015 BR-230, BR-231: acceptance probes of the isolated self-hosted runner.
# Called only by make runner-probe, runner-reset-mark and runner-reset-check
# in .github/workflows/runner-acceptance.yml, on the self-hosted runner.
#   probe.sh run              mask the inputs, probe from the runner container,
#                             then from a host-network container of the VM
#   probe.sh network <view>   one probe pass; view is container or vm
#   probe.sh reset-mark       leave the BR-231 sentinels in the VM
#   probe.sh reset-check      fail when any BR-231 sentinel or leftover exists
# Each probe prints `PASS <id>` or `FAIL <id>`; an id never holds an address.
set -u

TIMEOUT=5
GATEWAY='192.168.5.2'
GATEWAY_PORTS='22 80 443 2375 2376 47999'
PRIVATE_TARGETS='10.0.0.1 172.16.0.1 192.168.0.1 192.168.1.1'
SENTINEL=kdrive-reset-sentinel

mask_inputs() {
  for value in "${LAN_TARGET:-}" "${HOST_TARGET:-}"; do
    if test -n "$value"; then
      printf '::add-mask::%s\n' "$value"
      printf '::add-mask::%s\n' "${value%:*}"
    fi
  done
}

failures=0
view=unknown
pass() { printf 'PASS %s-%s\n' "$view" "$1"; }
fail() {
  printf 'FAIL %s-%s\n' "$view" "$1"
  failures=$((failures + 1))
}
note() { printf 'NOTE %s-%s not applicable\n' "$view" "$1"; }

# Succeeds when a TCP connection opens within the limit.
tcp_connects() {
  timeout "$TIMEOUT" bash -c 'exec 3<>"/dev/tcp/$1/$2"' _ "$1" "$2" >/dev/null 2>&1
}
negative_tcp() {
  if tcp_connects "$2" "$3"; then fail "$1"; else pass "$1"; fi
}
# Succeeds when 9.9.9.9 answers a DNS query sent directly to it.
direct_dns_answers() {
  timeout "$TIMEOUT" bash -c '
    exec 3<>/dev/udp/9.9.9.9/53 || exit 1
    printf "\x4b\x44\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00\x06github\x03com\x00\x00\x01\x00\x01" >&3 || exit 1
    IFS= read -r -t 4 -N 1 answer <&3
  ' >/dev/null 2>&1
}
negative_target() {
  id=$1
  target=$2
  host=${target%:*}
  port=${target##*:}
  case "$port" in
    '' | *[!0-9]*)
      fail "$id"
      return
      ;;
  esac
  if test -z "$host" || test "$host" = "$target"; then
    fail "$id"
    return
  fi
  negative_tcp "$id" "$host" "$port"
}
positive_https() {
  code=$(curl --silent --output /dev/null --proto '=https' --max-time 15 \
    --write-out '%{http_code}' "$2" 2>/dev/null)
  case "$code" in
    '' | 000) fail "$1" ;;
    *) pass "$1" ;;
  esac
}

network() {
  view=$1
  mask_inputs
  for port in $GATEWAY_PORTS; do
    negative_tcp "gateway-tcp-$port" "$GATEWAY" "$port"
  done
  if timeout "$TIMEOUT" getent hosts host.lima.internal >/dev/null 2>&1; then
    negative_tcp host-lima-internal-tcp-443 host.lima.internal 443
  else
    note host-lima-internal-tcp-443
  fi
  index=0
  for address in $PRIVATE_TARGETS; do
    index=$((index + 1))
    negative_tcp "private-$index-tcp-22" "$address" 22
    negative_tcp "private-$index-tcp-443" "$address" 443
  done
  negative_tcp metadata-tcp-80 169.254.169.254 80
  negative_tcp github-tcp-80 github.com 80
  if direct_dns_answers; then fail dns-direct; else pass dns-direct; fi
  negative_tcp ipv6-literal-tcp-443 2606:4700:4700::1111 443
  ipv6=$(timeout "$TIMEOUT" getent ahostsv6 github.com 2>/dev/null |
    awk '$1 !~ /^::ffff:/ { print $1; exit }')
  if test -n "$ipv6"; then
    negative_tcp ipv6-github-tcp-443 "$ipv6" 443
  else
    note ipv6-github-tcp-443
  fi
  if test -n "${LAN_TARGET:-}"; then negative_target lan-target "$LAN_TARGET"; fi
  if test -n "${HOST_TARGET:-}"; then negative_target host-target "$HOST_TARGET"; fi
  if timeout "$TIMEOUT" getent hosts github.com >/dev/null 2>&1; then
    pass dns-github
  else
    fail dns-github
  fi
  positive_https https-api-github 'https://api.github.com'
  positive_https https-github 'https://github.com'
  positive_https https-ghcr 'https://ghcr.io/v2/'
  positive_https https-docker-registry 'https://registry-1.docker.io/v2/'
  positive_https https-npm-registry 'https://registry.npmjs.org/'
  positive_https https-docker-download 'https://download.docker.com/'
  if test "$view" = vm; then
    if mounts=$(nsenter -t 1 -m cat /proc/self/mounts 2>/dev/null) &&
      ! printf '%s\n' "$mounts" | awk '$3 == "9p" || $3 == "virtiofs" || $3 == "fuse.sshfs" { found = 1 } END { exit !found }'; then
      pass no-host-mount
    else
      fail no-host-mount
    fi
  fi
  test "$failures" -eq 0
}

run() {
  mask_inputs
  here=$(cd "$(dirname "$0")" && pwd)
  status=0
  "$0" network container || status=1
  docker run --rm --network host --pid host --privileged --user 0:0 \
    --entrypoint /bin/bash --env LAN_TARGET --env HOST_TARGET \
    --volume "$here/probe.sh:/kdrive-probe.sh:ro" \
    kdrive-ci-runner:local /kdrive-probe.sh network vm || status=1
  return "$status"
}

reset_mark() {
  docker run --rm --user 0:0 --entrypoint /bin/sh --volume /var/lib:/kdrive-var-lib \
    kdrive-ci-runner:local -c "touch /kdrive-var-lib/$SENTINEL" &&
    docker volume create "$SENTINEL" >/dev/null &&
    docker tag kdrive-ci-runner:local "$SENTINEL:local" &&
    docker run --detach --name "$SENTINEL" --entrypoint sleep kdrive-ci-runner:local infinity >/dev/null &&
    touch "$(dirname "$GITHUB_WORKSPACE")/$SENTINEL" &&
    touch "$RUNNER_TEMP/$SENTINEL" &&
    printf '%s\n' 'reset-mark: sentinels left in the VM.'
}

reset_check() {
  status=0
  if test -e "$RUNNER_TEMP/$SENTINEL" || test -L "$RUNNER_TEMP/$SENTINEL"; then
    printf '%s\n' 'reset-check: the RUNNER_TEMP sentinel exists.' >&2
    status=1
  fi
  if ! docker run --rm --user 0:0 --entrypoint /bin/sh --volume /var/lib:/kdrive-var-lib:ro \
    kdrive-ci-runner:local -c "test ! -e /kdrive-var-lib/$SENTINEL"; then
    printf '%s\n' 'reset-check: the /var/lib sentinel exists.' >&2
    status=1
  fi
  if docker volume inspect "$SENTINEL" >/dev/null 2>&1; then
    printf '%s\n' 'reset-check: the sentinel volume exists.' >&2
    status=1
  fi
  if docker image inspect "$SENTINEL:local" >/dev/null 2>&1; then
    printf '%s\n' 'reset-check: the sentinel image tag exists.' >&2
    status=1
  fi
  if docker container inspect "$SENTINEL" >/dev/null 2>&1; then
    printf '%s\n' 'reset-check: the sentinel container exists.' >&2
    status=1
  fi
  parent=$(dirname "$GITHUB_WORKSPACE")
  checkout=$(basename "$GITHUB_WORKSPACE")
  others=$(ls -A "$parent" | grep -vxF "$checkout")
  if test -n "$others"; then
    printf '%s\n' 'reset-check: the workspace parent holds an entry other than the checkout.' >&2
    status=1
  fi
  if test "$status" -eq 0; then printf '%s\n' 'reset-check: no sentinel or leftover found.'; fi
  return "$status"
}

case "${1:-}" in
  run) run ;;
  network)
    case "${2:-}" in
      container | vm) network "$2" ;;
      *) printf '%s\n' 'usage: probe.sh network container|vm' >&2; exit 2 ;;
    esac
    ;;
  reset-mark) reset_mark ;;
  reset-check) reset_check ;;
  *) printf '%s\n' 'usage: probe.sh run|network <view>|reset-mark|reset-check' >&2; exit 2 ;;
esac
