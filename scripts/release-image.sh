#!/bin/sh
# F-024 BR-370: multi-platform release image build on the host Docker engine.
# The inputs are validated first (BR-359), before any interpolation or docker
# command. A dry run builds both platforms with no output, tag or login; a real
# run logs in with GITHUB_TOKEN on stdin, pushes the selected tags and logs
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

# Parse JSON inside the Docker-only dev toolchain. Stdin avoids mounting a
# host temporary path; validate before substitution strips trailing newlines.
parse_digest() {
	docker compose run --rm -T dev node -e '
const fs = require("node:fs");
try {
  const metadata = JSON.parse(fs.readFileSync(0, "utf8"));
  const digest = metadata?.["containerimage.digest"];
  if (typeof digest !== "string" || digest.length !== 71 ||
      !/^sha256:[0-9a-f]{64}$/.test(digest)) process.exit(1);
  process.stdout.write(digest);
} catch { process.exit(1); }
'
}

NUMBER='(0|[1-9][0-9]*)'
IDENTIFIER='(0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)'
SEMVER="^$NUMBER\\.$NUMBER\\.$NUMBER(-$IDENTIFIER(\\.$IDENTIFIER)*)?(\\+[0-9a-zA-Z-]+(\\.[0-9a-zA-Z-]+)*)?\$"
STABLE="^$NUMBER\\.$NUMBER\\.$NUMBER\$"
BETA="^$NUMBER\\.$NUMBER\\.$NUMBER-beta\\.$NUMBER\$"

case $version in
*"$newline"*) reason='version is not a SemVer version' ;;
*)
	if ! matches "$version" "$SEMVER"; then
		reason='version is not a SemVer version'
	elif matches "$version" "$BETA" || matches "$version" "$STABLE"; then
		reason=''
	else
		reason='unsupported release version'
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
metadata_dir=''
cleanup() {
	status=$?
	if test "$logged_in" = true; then docker logout "$REGISTRY" >/dev/null 2>&1 || true; fi
	docker buildx rm "$builder" >/dev/null 2>&1 || true
	if test -n "$metadata_dir"; then
		rm -f "$metadata_dir/metadata.json"
		rmdir "$metadata_dir"
	fi
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
if matches "$version" "$STABLE"; then
	metadata_dir=$(mktemp -d) || exit 1
	fixture_digest='sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
	printf '{"containerimage.digest":"%s"}\n' "$fixture_digest" > "$metadata_dir/metadata.json" || exit 1
	digest=$(parse_digest < "$metadata_dir/metadata.json") || {
		printf '%s\n' 'release-image: buildx metadata digest is not a sha256 digest' >&2
		exit 1
	}
	if test "${#digest}" -ne 71 || ! matches "$digest" '^sha256:[0-9a-f]{64}$' || test "$digest" != "$fixture_digest"; then
		printf '%s\n' 'release-image: buildx metadata digest is not a sha256 digest' >&2
		exit 1
	fi
	# The real build must write its own metadata; never reuse the fixture.
	rm -f "$metadata_dir/metadata.json" || exit 1
fi
logged_in=true
printf '%s' "$GITHUB_TOKEN" | docker login "$REGISTRY" \
	--username "${GITHUB_ACTOR:-x-access-token}" --password-stdin >/dev/null || exit 1
if test -z "$metadata_dir"; then metadata_dir=$(mktemp -d) || exit 1; fi
set -- --tag "$REGISTRY/$REPOSITORY:$version"
if matches "$version" "$STABLE"; then
	set -- "$@" --tag "$REGISTRY/$REPOSITORY:latest"
fi
docker buildx build --builder "$builder" \
	--platform linux/amd64,linux/arm64 --target runtime \
	"$@" --metadata-file "$metadata_dir/metadata.json" \
	--label "org.opencontainers.image.source=https://github.com/$REPOSITORY" \
	--label "org.opencontainers.image.version=$version" \
	--label "org.opencontainers.image.revision=$sha" \
	--push . || exit 1
printf 'release-image: pushed %s/%s:%s\n' "$REGISTRY" "$REPOSITORY" "$version"

if matches "$version" "$STABLE"; then
	digest=$(parse_digest < "$metadata_dir/metadata.json") || {
		printf '%s\n' 'release-image: buildx metadata digest is not a sha256 digest' >&2
		exit 1
	}
	if test "${#digest}" -ne 71 || ! matches "$digest" '^sha256:[0-9a-f]{64}$'; then
		printf '%s\n' 'release-image: buildx metadata digest is not a sha256 digest' >&2
		exit 1
	fi
	if test -n "${GITHUB_OUTPUT-}"; then
		printf 'image_digest=%s\n' "$digest" >> "$GITHUB_OUTPUT" || exit 1
	fi
	printf 'release-image: image digest %s\n' "$digest"
fi
