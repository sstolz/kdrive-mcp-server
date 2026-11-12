#!/bin/sh
# F-015 BR-233: single owner-run entry point of the isolated self-hosted runner.
# Run as root (directly or through sudo), from a checkout of this repository:
#   install.sh --token-file <path>   install or update; idempotent
#   install.sh --check               change nothing; nonzero when the state differs
#   install.sh --uninstall           remove what install mode created
# The token is read only from the file at <path>. Output never contains the
# token, a JIT configuration, a host name or an address.
# KDRIVE_RUNNER_TEST_ROOT prefixes every absolute path (stub tests only).
set -u
PATH="$PATH:/usr/sbin:/sbin"
umask 022

here=$(cd "$(dirname "$0")" && pwd)
root=${KDRIVE_RUNNER_TEST_ROOT:-}
kvm="$root/dev/kvm"
opt_dir="$root/opt/kdrive-runner"
ops_dir="$opt_dir/ops"
lima_dir="$opt_dir/lima"
etc_dir="$root/etc/kdrive-runner"
unit_dir="$root/etc/systemd/system"
user=kdrive-runner
nft_unit=kdrive-runner-nft.service
runner_unit=kdrive-ci-runner.service
ops_files='install.sh host-setup.sh nftables.conf lima.yaml kdrive-ci-runner.service kdrive-runner-nft.service egress-selftest.sh supervise.sh provision.sh Dockerfile entrypoint.sh compose.yaml probe.sh'

# Pinned Lima release, installed into its own prefix; any other limactl on the
# host is never used or replaced. SHA-256 from the release SHA256SUMS.
LIMA_VERSION=2.2.1
LIMA_SHA256=b391ac7fcac2b2a5a1628107756463188ded4d18d3104a40a66a8bb6fec01bcb
LIMA_URL="https://github.com/lima-vm/lima/releases/download/v$LIMA_VERSION/lima-$LIMA_VERSION-Linux-x86_64.tar.gz"

# Scripts run as kdrive-runner through runuser; root never opens a path inside
# that user's home. Exit 3 means a symlink sits at the token path.
TOKEN_DIGEST='# token-digest
f="$HOME/.config/kdrive-runner/github-token"
if test -L "$f"; then exit 3; fi
if test -f "$f"; then sha256sum < "$f" | cut -d " " -f 1; fi'
TOKEN_STORE='# token-store
umask 077
dir="$HOME/.config/kdrive-runner"
f="$dir/github-token"
mkdir -p "$dir" || exit 1
if test -L "$f"; then exit 3; fi
rm -f "$f.new" || exit 1
set -C
cat > "$f.new" || exit 1
set +C
chmod 0600 "$f.new" && mv -f "$f.new" "$f"'
TOKEN_MODE='# token-mode
f="$HOME/.config/kdrive-runner/github-token"
test -f "$f" && ! test -L "$f" && test "$(stat -c %u:%a "$f")" = "$(id -u):600"'

refuse() {
  printf '%s\n' "install.sh: $1" >&2
  exit 1
}
usage() {
  refuse 'usage: install.sh --token-file <path> | --check | --uninstall'
}

mode=
token_path=
case "$#" in
  1)
    case "$1" in
      --check) mode=check ;;
      --uninstall) mode=uninstall ;;
      *) usage ;;
    esac
    ;;
  2)
    test "$1" = --token-file || usage
    mode=install
    token_path=$2
    ;;
  *) usage ;;
esac

test "$(uname -m)" = x86_64 || refuse 'refused: this machine is not x86_64.'
test -e "$kvm" || refuse 'refused: /dev/kvm is missing.'
command -v nft >/dev/null 2>&1 || refuse 'refused: nft is missing.'
test "$(id -u)" = 0 || refuse 'refused: run as root.'
if test "$mode" = install; then
  if test -L "$token_path" || ! test -f "$token_path"; then
    refuse 'refused: the token file must be a regular file, not a symlink or a directory.'
  fi
fi

work=$(mktemp -d) || refuse 'cannot create a temporary directory.'
trap 'rm -rf "$work"' EXIT HUP INT TERM
changed=0

user_exists() {
  id "$user" >/dev/null 2>&1
}
as_user() {
  runuser -u "$user" -- "$@"
}
ops_ok() {
  for file in $ops_files; do
    cmp -s "$here/$file" "$ops_dir/$file" || return 1
  done
}
lima_ok() {
  test -x "$lima_dir/bin/limactl" &&
    user_exists &&
    test "$(as_user "$lima_dir/bin/limactl" --version 2>/dev/null)" = "limactl version $LIMA_VERSION"
}
unit_ok() {
  systemctl is-enabled "$1" >/dev/null 2>&1 && systemctl is-active "$1" >/dev/null 2>&1
}

install_ops() {
  ops_ok && return 0
  mkdir -p "$ops_dir" || refuse 'the runner files could not be installed.'
  chmod 0755 "$opt_dir" "$ops_dir"
  for file in $ops_files; do
    cmp -s "$here/$file" "$ops_dir/$file" && continue
    cp "$here/$file" "$ops_dir/$file.new" || refuse 'the runner files could not be installed.'
    case "$file" in
      *.sh) chmod 0755 "$ops_dir/$file.new" ;;
      *) chmod 0644 "$ops_dir/$file.new" ;;
    esac
    mv -f "$ops_dir/$file.new" "$ops_dir/$file" || refuse 'the runner files could not be installed.'
  done
  changed=1
}

install_lima() {
  lima_ok && return 0
  curl --fail --silent --show-error --location --proto '=https' \
    --output "$work/lima.tar.gz" "$LIMA_URL" || refuse 'the pinned Lima release could not be downloaded.'
  actual=$(sha256sum "$work/lima.tar.gz" | cut -d ' ' -f 1)
  test "$actual" = "$LIMA_SHA256" || refuse 'refused: the pinned Lima release failed its SHA-256 check.'
  mkdir "$work/lima"
  tar --no-same-owner -xzf "$work/lima.tar.gz" -C "$work/lima" || refuse 'the Lima release could not be extracted.'
  chmod 0755 "$work/lima"
  rm -rf "$lima_dir"
  mv "$work/lima" "$lima_dir"
  lima_ok || refuse 'the installed Lima release does not report the pinned version.'
  changed=1
}

store_token() {
  wanted=$(sha256sum < "$token_path" | cut -d ' ' -f 1)
  stored=$(as_user sh -c "$TOKEN_DIGEST")
  case "$?" in
    0) ;;
    3) refuse 'refused: a symlink sits at the runner token path; nothing written.' ;;
    *) refuse 'the stored runner token could not be read.' ;;
  esac
  test "$stored" = "$wanted" && return 0
  as_user sh -c "$TOKEN_STORE" < "$token_path"
  case "$?" in
    0) ;;
    3) refuse 'refused: a symlink sits at the runner token path; nothing written.' ;;
    *) refuse 'the runner token could not be stored.' ;;
  esac
  if test -n "$stored"; then printf '%s\n' 'kdrive-runner install: token rotated'; fi
  changed=1
}

start_unit() {
  if ! systemctl is-enabled "$1" >/dev/null 2>&1; then
    systemctl enable "$1" >/dev/null 2>&1 || refuse "systemctl enable $1 failed."
    changed=1
  fi
  if ! systemctl is-active "$1" >/dev/null 2>&1; then
    systemctl start "$1" || refuse "systemctl start $1 failed."
    changed=1
  fi
}

build_golden() {
  as_user "$ops_dir/supervise.sh" status && return 0
  if systemctl is-active "$runner_unit" >/dev/null 2>&1; then
    systemctl stop "$runner_unit" || refuse "systemctl stop $runner_unit failed."
  fi
  as_user "$ops_dir/supervise.sh" golden || refuse 'the golden disk could not be built.'
  changed=1
}

install_mode() {
  if user_exists; then
    as_user sh -c "$TOKEN_DIGEST" >/dev/null 2>&1
    test "$?" = 3 && refuse 'refused: a symlink sits at the runner token path; nothing written.'
  fi
  install_ops
  if ! "$ops_dir/host-setup.sh" --check >/dev/null 2>&1; then
    "$ops_dir/host-setup.sh" || refuse 'host-setup.sh failed.'
    changed=1
  fi
  install_lima
  store_token
  start_unit "$nft_unit"
  build_golden
  start_unit "$runner_unit"
  if test "$changed" = 0; then
    printf '%s\n' 'kdrive-runner install: already installed, no change'
  else
    printf '%s\n' 'kdrive-runner install: installed'
  fi
}

check_mode() {
  status=0
  report() {
    printf '%s\n' "install.sh --check: $1" >&2
    status=1
  }
  user_exists || report 'the kdrive-runner user is missing.'
  ops_ok || report 'the installed runner files differ from this checkout.'
  if test -x "$ops_dir/host-setup.sh"; then
    "$ops_dir/host-setup.sh" --check >/dev/null 2>&1 ||
      report 'the user, groups, egress files or units differ (host-setup.sh --check).'
  fi
  nft list table inet kdrive_runner >/dev/null 2>&1 || report 'the egress table is not loaded.'
  lima_ok || report "the pinned Lima release $LIMA_VERSION is not installed."
  if user_exists; then
    as_user sh -c "$TOKEN_MODE" >/dev/null 2>&1 ||
      report 'the runner token file is missing or not a 0600 file of kdrive-runner.'
    if test -x "$ops_dir/supervise.sh"; then
      as_user "$ops_dir/supervise.sh" status >/dev/null 2>&1 ||
        report 'the golden overlay or the instance is missing.'
    else
      report 'the golden overlay or the instance is missing.'
    fi
  fi
  unit_ok "$nft_unit" || report "$nft_unit is not enabled and active."
  unit_ok "$runner_unit" || report "$runner_unit is not enabled and active."
  exit "$status"
}

uninstall_mode() {
  if test -f "$unit_dir/$runner_unit"; then
    systemctl stop "$runner_unit"
    systemctl disable "$runner_unit" >/dev/null 2>&1
    rm -f "$unit_dir/$runner_unit"
  fi
  if user_exists && test -x "$ops_dir/supervise.sh"; then
    as_user "$ops_dir/supervise.sh" remove || refuse 'the Lima instance could not be removed.'
  fi
  if nft list table inet kdrive_runner >/dev/null 2>&1; then
    nft delete table inet kdrive_runner || refuse 'the egress table could not be deleted.'
  fi
  if test -f "$unit_dir/$nft_unit"; then
    systemctl stop "$nft_unit"
    systemctl disable "$nft_unit" >/dev/null 2>&1
    rm -f "$unit_dir/$nft_unit"
  fi
  systemctl daemon-reload
  rm -f "$etc_dir/nftables.conf" "$etc_dir/nft-sets.conf"
  rmdir "$etc_dir" 2>/dev/null
  rm -rf "$opt_dir"
  printf '%s\n' 'kdrive-runner uninstall: done. The kdrive-runner user, its home and the token file were kept.'
  printf '%s\n' 'Revoke the runner token on GitHub now (fine-grained token of this repository).'
}

case "$mode" in
  install) install_mode ;;
  check) check_mode ;;
  uninstall) uninstall_mode ;;
esac
