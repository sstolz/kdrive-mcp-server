# ADR-001 — Docker TypeScript and SDK-independent foundation

Status: accepted design; implementation pending acceptance.
Date: 2026-11-01. Source: frozen F-001 version 3, issue #3 / P-03.

## Context

The initial protocol target requires the stable v2 SDK. Contributors require
Docker-only development with existing Make, isolated dependencies and separate
lint, formatting, compiler and coverage checks. Upstream provenance is incomplete
for copying implementation. Sonar analysis targets an existing remote Community
server with privacy and installed-compatibility prerequisites.

## Decision

Use pinned Node 26.13.0/npm 11.20.0 in an official digest-pinned development image,
strict ESM TypeScript NodeNext, the stable v2 server SDK, typed ESLint, Prettier
and Vitest V8. Use GNU Make 3.81-compatible Compose orchestration and the same
commands in five mandatory CI jobs. Bind each client to one drive and inject its
only data adapter. Copy no upstream implementation. Keep optional remote analysis
separate from local gates, restricted to clean trusted-main immutable snapshots
with verified private target and version compatibility.

## Options rejected (and why)

- SDK v1: its maintenance line excludes the intended protocol revision.
- Host development tooling: contradicts the user's Docker-only requirement.
- Immediate upstream copying or a generic HTTP client: unresolved provenance and
  premature behavior contracts belong to P-05.
- A shared production/development image: deployment work belongs to P-13.
- Sonar-only checks, a local Qube server or Community branch analysis: conflict
  with independent local checks and the remote main-only topology.

## Consequences

The lockfile and base digest bind development/CI tooling. The foundation supplies
no MCP runtime, HTTP/auth or real kDrive calls. Future upstream reuse requires
provenance resolution. Sonar upload cannot begin until privacy, access and the
installed analyzer/scanner pairing are verified. Release remains explicitly
user-authorized. A material change supersedes this ADR through a new record.
