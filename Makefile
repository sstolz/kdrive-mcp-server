# Development tools run inside Compose. Compatible with GNU Make 3.81 and 4.x.
DOCKER ?= docker
COMPOSE = "$(DOCKER)" compose

# Serialize initialization and consumers, including with make -j.
.NOTPARALLEL:
.PHONY: help lockfile setup lint format-check format typecheck build test pack check shell \
	coverage sonar sonar-pr quality oidc-qualify http-acceptance kdrive-record kdrive-acceptance \
	kdrive-write-acceptance kdrive-upload-acceptance \
	image-binfmt image image-smoke \
	audit ci-changes privacy-scan runner-probe runner-reset-mark runner-reset-check \
	release-check release-setup release-npm release-image release-verify \
	_require-container-config _require-config _require-setup

help:
	@{ printf '%s\n' \
		'Development commands (Docker Compose; no host Node/npm):' \
		'  make setup         Build dev and install locked dependencies' \
		'  make lockfile      Generate/update lockfile inside dev (explicit)' \
		'  make check         Run all checks, build, tests and package verification' \
		'  make lint          Check lint errors and warnings' \
		'  make format-check  Check formatting without writing' \
		'  make format        Apply formatting explicitly' \
		'  make typecheck     Check source and test types' \
		'  make build         Compile the package' \
		'  make test          Build and run tests' \
		'  make pack          Pack and verify the executable artifact' \
		'  make audit         Fail on any high or critical npm audit finding (network)' \
		'  make shell         Open a shell inside dev' \
		'  make coverage      Run container tests with V8/LCOV coverage' \
		'  make sonar         Fresh trusted-main coverage and guarded official analysis' \
		'  make sonar-pr      CI-only same-repository PR analysis (PR Quality Gate)' \
		'  make quality       Run check, then guarded remote analysis' \
		'  make oidc-qualify  Interactive OIDC provider qualification (ARGS="...")' \
		'  make http-acceptance  Owner-run HTTP acceptance composition (synthetic drive, HTTP_ACCEPTANCE_SECRETS_DIR)' \
		'  make kdrive-record  Owner-run sanitized kDrive recordings (KDRIVE_ACCEPTANCE_DIR)' \
		'  make kdrive-acceptance  Owner-run kDrive acceptance on actual main (KDRIVE_ACCEPTANCE_DIR)' \
		'  make kdrive-write-acceptance  Owner-run kDrive write acceptance on actual main (KDRIVE_WRITE_FOLDER, KDRIVE_ACCEPTANCE_DIR)' \
		'  make kdrive-upload-acceptance Owner-run kDrive upload acceptance on actual main (KDRIVE_WRITE_FOLDER, KDRIVE_ACCEPTANCE_DIR)' \
		'  make image         Build runtime and smoke images per IMAGE_PLATFORMS (host Buildx, --load)' \
		'  make image-smoke   Smoke-test the local images per IMAGE_PLATFORMS (no network, no port)' \
		'  make image-binfmt  Register arm64 emulation on a non-arm64 host (privileged, opt-in)' \
		'  make privacy-scan  CI privacy scan with deny patterns from PRIVACY_DENY_PATTERNS (no setup)' \
		'  make release-check   Release checks for RELEASE_VERSION and RELEASE_SHA (release.yml)' \
		'  make release-setup   Build dev and install locked dependencies without install scripts' \
		'  make release-npm     Check the packed tarball, then the npm release step (release.yml)' \
		'  make release-image   Build both release image platforms; real runs only in release.yml' \
		'  make release-verify  Read back the released npm version and image (release.yml)' \
		'  make help          Show this help without Docker or network access'; }

_require-container-config:
	@for file in compose.yaml Dockerfile.dev package.json; do \
		if ! test -f "$$file"; then \
			printf '%s\n' "Missing $$file: the Docker development foundation is not available yet." >&2; \
			exit 1; \
		fi; \
	done
	@command -v "$(DOCKER)" >/dev/null 2>&1 || { \
		printf '%s\n' 'Docker is unavailable. Use Docker with Compose; do not install host Node/npm.' >&2; \
		exit 1; \
	}

_require-config: _require-container-config
	@test -f package-lock.json || { \
		printf '%s\n' 'Missing package-lock.json: run make lockfile inside Docker before make setup.' >&2; \
		exit 1; \
	}

lockfile: _require-container-config
	$(COMPOSE) build dev
	$(COMPOSE) run --rm dev npm install --package-lock-only --ignore-scripts

_require-setup: _require-config
	@$(COMPOSE) run --rm dev sh -c \
		'test -f node_modules/.package-lock.json || { printf "%s\n" "Run make setup before development commands." >&2; exit 1; }'

setup: _require-config
	$(COMPOSE) build dev
	$(COMPOSE) run --rm dev npm ci

lint: _require-setup
	$(COMPOSE) run --rm dev npm run lint

format-check: _require-setup
	$(COMPOSE) run --rm dev npm run format:check

format: _require-setup
	$(COMPOSE) run --rm dev npm run format

typecheck: _require-setup
	$(COMPOSE) run --rm dev npm run typecheck

build: _require-setup
	$(COMPOSE) run --rm dev npm run build

test: build
	$(COMPOSE) run --rm dev npm test

# F-024 BR-376: the production npm-shrinkwrap.json is generated before npm
# pack and removed after it whatever the outcome (a root shrinkwrap would take
# the lockfile's place for npm ci).
pack: build
	$(COMPOSE) run --rm dev sh -c \
		'mkdir -p artifacts && node scripts/shrinkwrap.ts && { npm pack --pack-destination artifacts; status=$$?; rm -f npm-shrinkwrap.json; test "$$status" -eq 0; } && npm run pack:check'

check:
	+$(MAKE) -f "$(firstword $(MAKEFILE_LIST))" -S lint format-check typecheck build test pack

# BR-319: not part of check; npm audit queries the registry advisory service.
audit: _require-setup
	$(COMPOSE) run --rm dev npm audit --audit-level=high

shell: _require-setup
	$(COMPOSE) run --rm dev sh

coverage: build
	$(COMPOSE) run --rm dev npm run coverage

sonar:
	@/bin/sh scripts/sonar-entry.sh sonar "$(DOCKER)" "$(MAKE)" "$(firstword $(MAKEFILE_LIST))"

sonar-pr:
	@/bin/sh scripts/sonar-entry.sh sonar-pr "$(DOCKER)" "$(MAKE)" "$(firstword $(MAKEFILE_LIST))"

quality:
	@/bin/sh scripts/sonar-entry.sh quality "$(DOCKER)" "$(MAKE)" "$(firstword $(MAKEFILE_LIST))"

# Interactive (no -T) and silent, so allowlist values are not echoed (F-008).
oidc-qualify: _require-setup
	@$(COMPOSE) run --rm dev node scripts/oidc-qualify.ts $(ARGS)

# F-012 BR-171 v2: owner-run acceptance composition. The port is published on
# the host loopback only. The entry script validates the owner-provided
# directory outside the checkout (HTTP_ACCEPTANCE_SECRETS_DIR) before any Docker
# command or prerequisite, then builds and mounts it read-only at /run/secrets.
HTTP_ACCEPTANCE_PORT ?= 3000
http-acceptance:
	@HTTP_ACCEPTANCE_PORT='$(HTTP_ACCEPTANCE_PORT)' /bin/sh scripts/http-acceptance-entry.sh "$(DOCKER)" "$(MAKE)" "$(firstword $(MAKEFILE_LIST))"

# F-014 BR-211/BR-212/BR-215: owner-run kDrive targets. The entry script
# validates KDRIVE_ACCEPTANCE_DIR (and, for acceptance, actual main) before any
# Docker command or prerequisite, then mounts it read-only.
kdrive-record:
	@/bin/sh scripts/kdrive-entry.sh record "$(DOCKER)" "$(MAKE)" "$(firstword $(MAKEFILE_LIST))"

kdrive-acceptance:
	@/bin/sh scripts/kdrive-entry.sh acceptance "$(DOCKER)" "$(MAKE)" "$(firstword $(MAKEFILE_LIST))"

# F-017 BR-276: owner-run real-API writes in the designated folder only.
# KDRIVE_WRITE_FOLDER is checked first, before any Docker command.
kdrive-write-acceptance:
	@/bin/sh scripts/kdrive-entry.sh write-acceptance "$(DOCKER)" "$(MAKE)" "$(firstword $(MAKEFILE_LIST))"

# F-018 BR-287: owner-run upload acceptance under the BR-276 conditions.
kdrive-upload-acceptance:
	@/bin/sh scripts/kdrive-entry.sh upload-acceptance "$(DOCKER)" "$(MAKE)" "$(firstword $(MAKEFILE_LIST))"

# F-013: production image targets. They call the host Docker engine directly
# (D-03, D-12): the dev service has no Docker socket. Nothing is pushed.
IMAGE_PLATFORMS ?= linux/amd64 linux/arm64
# Official manifest-list digest verified on 2026-11-05.
BINFMT_IMAGE = tonistiigi/binfmt@sha256:400a4873b838d1b89194d982c45e5fb3cda4593fbfd7e08a02e76b03b21166f0

# BR-188: registers arm64 binfmt handlers in the host kernel (until reboot).
# Opt-in: never a prerequisite of another target.
image-binfmt:
	@case " $(IMAGE_PLATFORMS) " in \
		*" linux/arm64 "*) \
			host=$$(uname -m); \
			if test "$$host" = aarch64 || test "$$host" = arm64; then \
				printf '%s\n' "image-binfmt: native $$host host; nothing to register."; \
			else \
				"$(DOCKER)" run --rm --privileged $(BINFMT_IMAGE) --install arm64; \
			fi ;; \
		*) printf '%s\n' 'image-binfmt: linux/arm64 not requested; nothing to register.' ;; \
	esac

# BR-177: builds and loads runtime and smoke per platform, then checks the
# platform of each loaded image.
image:
	@"$(DOCKER)" buildx version >/dev/null 2>&1 || { \
		printf '%s\n' 'Docker Buildx is unavailable: make image needs the docker buildx plugin.' >&2; \
		exit 1; \
	}
	@for platform in $(IMAGE_PLATFORMS); do \
		case "$$platform" in \
			linux/amd64) arch=amd64 ;; \
			linux/arm64) arch=arm64 ;; \
			*) printf '%s\n' "Unsupported image platform: $$platform" >&2; exit 1 ;; \
		esac; \
		for target in runtime smoke; do \
			"$(DOCKER)" buildx build --platform "$$platform" --target "$$target" --load \
				--tag "kdrive-mcp-server:$$target-$$arch" . || exit 1; \
			actual=$$("$(DOCKER)" image inspect --format '{{.Os}}/{{.Architecture}}' \
				"kdrive-mcp-server:$$target-$$arch") || exit 1; \
			test "$$actual" = "$$platform" || { \
				printf '%s\n' "Image kdrive-mcp-server:$$target-$$arch is $$actual, expected $$platform." >&2; \
				exit 1; \
			}; \
		done; \
	done

# BR-180: container smoke tests of the local images, one platform at a time.
image-smoke:
	@for platform in $(IMAGE_PLATFORMS); do \
		DOCKER="$(DOCKER)" /bin/sh scripts/image-smoke.sh "$$platform" || exit 1; \
	done

# F-015 BR-226: classify the changed paths of a CI run for the job conditions.
# CI only (D-12): runs on the runner side with the checkout's git. Fails
# closed: a git failure or another event runs every job.
ci-changes:
	@test -n "$${GITHUB_OUTPUT:-}" && test -n "$${GITHUB_EVENT_NAME:-}" || { \
		printf '%s\n' 'ci-changes needs GITHUB_OUTPUT and GITHUB_EVENT_NAME (CI only).' >&2; \
		exit 1; \
	}
	@list=$$(mktemp) || exit 1; \
	if test "$$GITHUB_EVENT_NAME" = pull_request; then \
		if git diff --no-renames --name-only -z HEAD^1 HEAD > "$$list"; then \
			result=$$(tr '\000' '\n' < "$$list" | /bin/sh scripts/ci-changes.sh pull_request); \
		else \
			result=$$(printf 'heavy=true\nimage=true'); \
		fi; \
	else \
		result=$$(/bin/sh scripts/ci-changes.sh "$$GITHUB_EVENT_NAME" < /dev/null); \
	fi; \
	unlink "$$list"; \
	case "$$result" in \
		heavy=true?image=true | heavy=true?image=false | heavy=false?image=true | heavy=false?image=false) ;; \
		*) result=$$(printf 'heavy=true\nimage=true') ;; \
	esac; \
	printf '%s\n' "$$result"; \
	printf '%s\n' "$$result" >> "$$GITHUB_OUTPUT"

# F-023 BR-342, BR-352: the secret-fed privacy scan. Node built-ins only, so
# no make setup; every PRIVACY_* value is passed by name, never on the command
# line.
privacy-scan: _require-container-config
	$(COMPOSE) run --rm -T -e PRIVACY_DENY_PATTERNS -e PRIVACY_EVENT -e PRIVACY_RANGE_BASE -e PRIVACY_RANGE_HEAD -e PRIVACY_PR_TITLE -e PRIVACY_PR_BODY dev node scripts/privacy-scan.ts

# F-015 BR-229–BR-231: owner-dispatched runner acceptance
# (.github/workflows/runner-acceptance.yml). Self-hosted runner only: they use
# the VM's Docker engine.
runner-probe:
	@/bin/bash ops/runner/probe.sh run

runner-reset-mark:
	@/bin/bash ops/runner/probe.sh reset-mark

runner-reset-check:
	@/bin/bash ops/runner/probe.sh reset-check

# F-024 BR-375: release targets driven by .github/workflows/release.yml. The
# scripts/release.ts targets use Node built-ins only (no make setup) and pass
# every variable by name; none of these targets is a prerequisite of another.
release-check: _require-container-config
	$(COMPOSE) run --rm -T -e GITHUB_ACTIONS -e GITHUB_SHA -e GITHUB_TOKEN -e RELEASE_VERSION -e RELEASE_SHA -e RELEASE_DRY_RUN -e RELEASE_PHASE -e RELEASE_GITHUB_API_URL -e RELEASE_NPM_REGISTRY_URL -e RELEASE_GHCR_URL dev node scripts/release.ts check

release-setup: _require-container-config
	$(COMPOSE) build dev
	$(COMPOSE) run --rm -T dev npm ci --ignore-scripts

# After the script exits 0 (the version is validated), a dry run in CI hands
# the tarball digest to later jobs as the verify job output (BR-356).
release-npm: _require-container-config
	$(COMPOSE) run --rm -T -e GITHUB_ACTIONS -e ACTIONS_ID_TOKEN_REQUEST_URL -e ACTIONS_ID_TOKEN_REQUEST_TOKEN -e GITHUB_EVENT_NAME -e GITHUB_REF -e GITHUB_REPOSITORY -e GITHUB_REPOSITORY_ID -e GITHUB_REPOSITORY_OWNER_ID -e GITHUB_RUN_ATTEMPT -e GITHUB_RUN_ID -e GITHUB_SERVER_URL -e GITHUB_SHA -e GITHUB_WORKFLOW_REF -e RUNNER_ENVIRONMENT -e RELEASE_VERSION -e RELEASE_SHA -e RELEASE_DRY_RUN -e RELEASE_TARBALL_SHA256 dev node scripts/release.ts npm
	@if test "$${RELEASE_DRY_RUN:-}" = true && test -n "$${GITHUB_OUTPUT:-}"; then \
		sum=$$(sha256sum "artifacts/sstolz-kdrive-mcp-server-$$RELEASE_VERSION.tgz") || exit 1; \
		printf 'tarball-sha256=%s\n' "$$(printf '%s' "$$sum" | cut -c1-64)" >> "$$GITHUB_OUTPUT"; \
	fi

# Host Docker (BR-370): the script validates its inputs before any docker call.
release-image:
	/bin/sh scripts/release-image.sh

release-verify: _require-container-config
	$(COMPOSE) run --rm -T -e GITHUB_ACTIONS -e GITHUB_TOKEN -e RELEASE_VERSION -e RELEASE_SHA -e RELEASE_DRY_RUN -e RELEASE_TARBALL_SHA256 -e RELEASE_GITHUB_API_URL -e RELEASE_NPM_REGISTRY_URL -e RELEASE_GHCR_URL dev node scripts/release.ts verify
