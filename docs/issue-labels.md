# Issue labels

Use exactly one `type:*` label and one or two `area:*` labels per issue. Labels
classify the work; titles stay readable English without administrative prefixes.
Preserve historical planning IDs such as `P01` in existing titles. Retain unrelated
labels when updating this classification.

| Type            | Meaning                                              |
| --------------- | ---------------------------------------------------- |
| `type:feature`  | Add user-facing behavior or capability.              |
| `type:fix`      | Correct an observed defect.                          |
| `type:chore`    | Maintain repository operations or delivery workflow. |
| `type:docs`     | Write or maintain documentation.                     |
| `type:research` | Investigate a question or collect evidence.          |
| `type:test`     | Add or maintain verification coverage.               |

| Area                 | Subject                                  |
| -------------------- | ---------------------------------------- |
| `area:auth`          | Authentication and credential handling.  |
| `area:policy`        | Provider policy and access restrictions. |
| `area:kdrive-api`    | kDrive API integration and evidence.     |
| `area:config`        | Application configuration.               |
| `area:build-ci`      | Build tools, containers and CI.          |
| `area:quality`       | Static analysis and quality checks.      |
| `area:content`       | File content and metadata.               |
| `area:mcp`           | MCP tools and resources.                 |
| `area:transport`     | stdio and HTTP transport.                |
| `area:packaging`     | Distribution and installation.           |
| `area:sharing`       | Sharing links and permissions.           |
| `area:release`       | Versioning and releases.                 |
| `area:workflow`      | Contribution and ticket workflow.        |
| `area:observability` | Usage measurements and diagnostics.      |

Example: #38, **Track token usage at ticket closure**, uses `type:chore`,
`area:workflow` and `area:observability`.

The #38 development record (archived evidence `runs/38-development-1.md`) records the verified
classification snapshot. This convention adds no application behavior or gate.
