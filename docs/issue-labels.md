# Issue labels

Labels follow common GitHub practice (decision D-10 in [PROJECT.md](../PROJECT.md)):
plain type labels, mostly GitHub's defaults, and `area/*` labels for the
domain. Every label has a description; each group has its own colour.

Use exactly one type label and one or two `area/*` labels per issue. Titles
stay readable English without administrative prefixes; historical planning IDs
such as `[P-22]` are preserved in existing titles.

| Type            | Meaning                                                        |
| --------------- | -------------------------------------------------------------- |
| `bug`           | Correct an observed defect.                                    |
| `enhancement`   | Add user-facing behavior or capability.                        |
| `documentation` | Write or maintain documentation.                               |
| `chore`         | Maintenance, tooling, CI or tests with no user-visible change. |
| `research`      | Measurement or investigation before a decision.                |
| `question`      | A question that needs an answer before work can start.         |

All `area/*` labels share the colour `#c5def5`.

| Area                 | Subject                                         |
| -------------------- | ----------------------------------------------- |
| `area/auth`          | OAuth proxy, tokens and authorization.          |
| `area/build-ci`      | Build, Docker toolchain and CI.                 |
| `area/config`        | Runtime configuration.                          |
| `area/content`       | Content extraction (text, PDF, office, images). |
| `area/kdrive-api`    | kDrive API client and observed behaviour.       |
| `area/mcp`           | MCP tools, resources and protocol.              |
| `area/observability` | Logs, audit and health.                         |
| `area/packaging`     | Image and npm package.                          |
| `area/policy`        | Access and mutation policy.                     |
| `area/quality`       | Lint, Sonar and code quality.                   |
| `area/release`       | Release and publication.                        |
| `area/sharing`       | Links and invitations.                          |
| `area/transport`     | stdio and HTTP transports.                      |
| `area/workflow`      | Development method and records.                 |

GitHub's `good first issue`, `help wanted`, `duplicate`, `invalid` and
`wontfix` labels keep their default meaning.

Example: #1, **Move development to this repository**, uses `chore`,
`area/workflow` and `area/build-ci`.

Before 2026-11-12, the archive used `type:*` and `area:*` labels; the mapping
is `type:feature` → `enhancement`, `type:fix` and `type:bug` → `bug`,
`type:docs` → `documentation`, `type:chore` and `type:test` → `chore`,
`type:research` → `research`, `area:x` → `area/x`.
