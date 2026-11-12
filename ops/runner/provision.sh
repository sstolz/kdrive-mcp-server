#!/bin/sh
# F-015 BR-221: provisions the golden runner VM. Run once as root inside the
# VM by `ops/runner/supervise.sh golden`, which copies this script, Dockerfile,
# compose.yaml, entrypoint.sh and probe.sh into the directory given as $1.
# Every package source uses HTTPS: the host egress filter admits TCP 443 only.
set -eu
umask 022
src=${1:-/tmp/kdrive-runner}

# Exact versions from https://download.docker.com/linux/debian (bookworm,
# stable, amd64), checked on 2026-11-06. An update is a reviewed PR.
DOCKER_CE_VERSION='5:29.9.3-1~debian.12~bookworm'
CONTAINERD_VERSION='2.4.2-3~debian.12~bookworm'
BUILDX_VERSION='0.38.1-1~debian.12~bookworm'
COMPOSE_VERSION='5.7.0-1~debian.12~bookworm'
# Docker's release signing key.
DOCKER_KEY_FINGERPRINT='9DC858229FC7DD38854AE2D88D81803C0EBFCD88'

fail() {
  printf '%s\n' "provision: $1" >&2
  exit 1
}

for source in /etc/apt/sources.list /etc/apt/sources.list.d/*; do
  if test -f "$source"; then sed -i 's#http://#https://#g' "$source"; fi
done
if grep -rqs 'http://' /etc/apt/sources.list /etc/apt/sources.list.d; then
  fail 'an APT source still uses plain HTTP.'
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl gnupg

install -d -m 0755 /etc/apt/keyrings
curl -fsSL --proto '=https' -o /etc/apt/keyrings/docker.asc.new \
  https://download.docker.com/linux/debian/gpg
fingerprint=$(gpg --show-keys --with-colons /etc/apt/keyrings/docker.asc.new |
  awk -F: '$1 == "fpr" { print $10; exit }')
test "$fingerprint" = "$DOCKER_KEY_FINGERPRINT" || fail 'unexpected Docker signing key.'
chmod 0644 /etc/apt/keyrings/docker.asc.new
mv -f /etc/apt/keyrings/docker.asc.new /etc/apt/keyrings/docker.asc
printf '%s\n' 'deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable' \
  > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y --no-install-recommends \
  docker-ce="$DOCKER_CE_VERSION" \
  docker-ce-cli="$DOCKER_CE_VERSION" \
  containerd.io="$CONTAINERD_VERSION" \
  docker-buildx-plugin="$BUILDX_VERSION" \
  docker-compose-plugin="$COMPOSE_VERSION"
apt-mark hold docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# dockerd listens on its Unix socket only (systemd socket activation).
install -d -m 0755 /etc/systemd/system/docker.service.d
printf '%s\n' '[Service]' 'ExecStart=' \
  'ExecStart=/usr/bin/dockerd -H fd:// --containerd=/run/containerd/containerd.sock' \
  > /etc/systemd/system/docker.service.d/kdrive-runner.conf
systemctl daemon-reload
systemctl enable docker.service docker.socket
systemctl restart docker.service

docker build --tag kdrive-ci-runner:local --file "$src/Dockerfile" "$src"

install -d -m 0755 /home/runner
install -d -o 1001 -g 1001 -m 0755 /home/runner/_work
install -d -m 0755 /etc/kdrive-runner
getent group docker | cut -d: -f3 > /etc/kdrive-runner/docker-gid
test -s /etc/kdrive-runner/docker-gid || fail 'the docker group id is unknown.'
install -m 0644 "$src/compose.yaml" /etc/kdrive-runner/compose.yaml

apt-get clean
printf '%s\n' 'provision: done.'
