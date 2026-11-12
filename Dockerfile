# Production image (F-013). Separate from Dockerfile.dev.
# Official manifest-list digests verified on 2026-11-05:
#   node:26.13.0-bookworm      sha256:fa52d1669505e29b58c042875b1d65c229e0787a3610fd52869b22b68e480853
#   node:26.13.0-bookworm-slim sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9
# The build stages run on the build platform; their output is pure JavaScript.

FROM --platform=$BUILDPLATFORM node:26.13.0-bookworm@sha256:fa52d1669505e29b58c042875b1d65c229e0787a3610fd52869b22b68e480853 AS build
WORKDIR /build
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
RUN test "$(node --version)" = v26.13.0 \
    && npm ci --ignore-scripts --cache /tmp/npm-cache \
    && rm -rf /tmp/npm-cache
COPY src/ src/
RUN npm run build

FROM --platform=$BUILDPLATFORM node:26.13.0-bookworm@sha256:fa52d1669505e29b58c042875b1d65c229e0787a3610fd52869b22b68e480853 AS deps
WORKDIR /deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional --ignore-scripts --cache /tmp/npm-cache \
    && rm -rf /tmp/npm-cache

FROM node:26.13.0-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9 AS runtime
RUN test "$(node --version)" = v26.13.0
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /build/dist/ /app/dist/
COPY --from=deps /deps/node_modules/ /app/node_modules/
COPY --chmod=0644 package.json package-lock.json LICENSE NOTICE README.md /app/
STOPSIGNAL SIGTERM
EXPOSE 3000
# F-021 BR-327: liveness probe of the HTTP runtime (docs/deployment.md, Health check).
HEALTHCHECK --interval=10s --timeout=10s --start-period=30s --retries=3 CMD ["node", "/app/dist/healthcheck.js"]
ENTRYPOINT ["node", "/app/dist/cli.js"]
USER 1000:1000

# Dev-only container smoke composition (F-012 BR-171); never published.
FROM runtime AS smoke
COPY --chmod=0755 scripts/http-acceptance.ts /app/scripts/http-acceptance.ts
ENTRYPOINT ["node", "/app/scripts/http-acceptance.ts"]
USER 1000:1000
