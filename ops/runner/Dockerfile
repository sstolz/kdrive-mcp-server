# F-015 BR-222: thin self-hosted runner image, built inside the VM only by
# ops/runner/provision.sh as kdrive-ci-runner:local. Never pushed.
# Official runner image 2.338.2, manifest-list digest verified on 2026-11-06.
FROM ghcr.io/actions/actions-runner:2.338.2@sha256:759a1d94a15b05941aba5196974ff43fe15b4cbba29b694b35cbc32a1166b232

USER root

# make for the CI targets. APT goes over HTTPS: the egress filter admits 443 only.
RUN for source in /etc/apt/sources.list /etc/apt/sources.list.d/*; do \
      if test -f "$source"; then sed -i 's#http://#https://#g' "$source"; fi; \
    done \
    && apt-get update \
    && apt-get install -y --no-install-recommends make \
    && rm -rf /var/lib/apt/lists/*

# Docker Compose CLI plugin v5.7.0, SHA-256 from the release checksums.
RUN curl -fsSL --proto '=https' -o /usr/local/lib/docker/cli-plugins/docker-compose \
      https://github.com/docker/compose/releases/download/v5.7.0/docker-compose-linux-x86_64 \
    && echo '7758048ad38e580f22559603312874fec8bb638d021a9e64182385fc17cc12a2  /usr/local/lib/docker/cli-plugins/docker-compose' | sha256sum -c - \
    && chmod 0755 /usr/local/lib/docker/cli-plugins/docker-compose

COPY --chmod=0755 entrypoint.sh /usr/local/bin/kdrive-runner-entrypoint
ENTRYPOINT ["/usr/local/bin/kdrive-runner-entrypoint"]

USER runner
