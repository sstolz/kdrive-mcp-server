#!/bin/sh
# F-024 BR-370: multi-platform release image build on the host Docker engine.
# The inputs are validated first (BR-359), before any interpolation or docker
# command. A dry run builds both platforms with no output, tag or login; a real
# run logs in with GITHUB_TOKEN on stdin, pushes the one version tag and logs
# out on exit whatever the outcome. No cache import or export, no build
# argument and no secret mount.
set -u
LC_ALL=C
export LC_ALL

BUILDKIT_IMAGE='moby/buildkit:v0.23.2@sha256:ddd1ca44b21eda906e81ab14a3d467fa6c39cd73b9a39df1196210edcb8db59e'
REGISTRY='ghcr.io'
REPOSITORY='sstolz/kdrive-mcp-server'

version=${RELEASE_VERSION-}
sha=${RELEASE_SHA-}
dry_run=${RELEASE_DRY_RUN-}
failures=0
newline='
'

report() {
	if test -z "$2"; then
		printf 'release-image: %s ok\n' "$1"
	else
		printf 'release-image: %s FAIL %s\n' "$1" "$2"
		failures=$((failures + 1))
	fi
}

matches() {
	printf '%s\n' "$1" | grep -Eq "$2"
}

NUMBER='(0|[1-9][0-9]*)'
IDENTIFIER='(0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)'
SEMVER="^$NUMBER\\.$NUMBER\\.$NUMBER(-$IDENTIFIER(\\.$IDENTIFIER)*)?(\\+[0-9a-zA-Z-]+(\\.[0-9a-zA-Z-]+)*)?\$"
STABLE="^$NUMBER\\.$NUMBER\\.$NUMBER(\\+[0-9a-zA-Z-]+(\\.[0-9a-zA-Z-]+)*)?\$"
BETA="^$NUMBER\\.$NUMBER\\.$NUMBER-beta\\.$NUMBER\$"

case $version in
*"$newline"*) reason='version is not a SemVer version' ;;
*)
	if ! matches "$version" "$SEMVER"; then
		reason='version is not a SemVer version'
	elif matches "$version" "$BETA"; then
		reason=''
	elif matches "$version" "$STABLE"; then
		reason='stable releases are out of scope (F-024 v1)'
	else
		reason='unsupported pre-release'
	fi
	;;
esac
report version "$reason"

case $sha in
*[!0-9a-f]* | '') reason='sha is not a full commit id' ;;
*) if test "${#sha}" -eq 40; then reason=''; else reason='sha is not a full commit id'; fi ;;
esac
report sha "$reason"

case $dry_run in
true | false) reason='' ;;
*) reason='dry_run is not a boolean' ;;
esac
report dry_run "$reason"

if test "$failures" -ne 0; then
	printf 'release-image: %s of 3 checks failed\n' "$failures"
	exit 1
fi

builder="kdrive-release-$$"
logged_in=false
cleanup() {
	status=$?
	if test "$logged_in" = true; then docker logout "$REGISTRY" >/dev/null 2>&1 || true; fi
	docker buildx rm "$builder" >/dev/null 2>&1 || true
	exit "$status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

docker buildx create --name "$builder" --driver docker-container \
	--driver-opt "image=$BUILDKIT_IMAGE" >/dev/null || exit 1

if test "$dry_run" = true; then
	docker buildx build --builder "$builder" \
		--platform linux/amd64,linux/arm64 --target runtime . || exit 1
	printf '%s\n' 'release-image: dry run built linux/amd64 and linux/arm64'
	exit 0
fi

test -n "${GITHUB_TOKEN-}" || {
	printf '%s\n' 'release-image: GITHUB_TOKEN missing' >&2
	exit 1
}
logged_in=true
printf '%s' "$GITHUB_TOKEN" | docker login "$REGISTRY" \
	--username "${GITHUB_ACTOR:-x-access-token}" --password-stdin >/dev/null || exit 1
docker buildx build --builder "$builder" \
	--platform linux/amd64,linux/arm64 --target runtime \
	--tag "$REGISTRY/$REPOSITORY:$version" \
	--label "org.opencontainers.image.source=https://github.com/$REPOSITORY" \
	--label "org.opencontainers.image.version=$version" \
	--label "org.opencontainers.image.revision=$sha" \
	--push . || exit 1
printf 'release-image: pushed %s/%s:%s\n' "$REGISTRY" "$REPOSITORY" "$version"
