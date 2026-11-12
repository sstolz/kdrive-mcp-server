# ADR-005 — Blocking PR Quality Gate on SonarQube Community Edition

Design accepted by autonomously frozen [F-011 v1](../features/F-011-pre-merge-quality-gates.md),
ticket #50, reviewed SHA `b4abcfd` on 2026-11-03 (D1–D5, D15). Implementation is
in the #50 PR; actual-main acceptance and the owner prerequisites P1–P3 remain
pending.

## Context

Sonar findings surfaced only after a merge, because the official scanner ran on
trusted `main` alone. The owner's server is SonarQube Community Edition, which
has no branch or pull-request analysis. The repository is private on a plan
without branch protection, rulesets with required checks or protected
environments (`gh api .../branches/main/protection` answered HTTP 403 on
2026-11-03). Two project analysis tokens exist: `SONAR_TOKEN` for
`kdrive-mcp-server` and `SONAR_PR_TOKEN` for the dedicated project
`kdrive-mcp-server-pr`.

## Decision

- Same-repository pull requests are analysed, at their merge commit, as the
  single branch of the dedicated project `kdrive-mcp-server-pr`, with
  `SONAR_PR_TOKEN`, through `make sonar-pr` and the `sonar-pr` CI job. The
  scanner waits for the task's own Quality Gate and a failed gate fails the job.
- The PR project uses the owner-configured gate `kdrive-pr-gate` on overall code
  with exactly Reliability, Security and Maintainability rating A; no hotspot or
  coverage condition.
- The workflow uses `pull_request`, never `pull_request_target`. Fork pull
  requests receive no secret and fail closed with a fixed message.
- Before enablement (`SONAR_ENABLED` not `true`), the job is a successful no-op
  with a fixed notice, so the introducing PR can merge.
- Blocking is procedural: AGENTS.md §3 step 6 merges only when every check,
  including `sonar-pr`, is green on the latest commit; a cancelled run is not
  green. If the plan later allows it, the owner can require these checks.

## Options rejected (and why)

- Analysing pull requests into `kdrive-mcp-server`: pollutes the `main`
  history and its new-code period.
- The community branch plugin or Developer Edition: third-party server change
  or licence cost, both owner decisions outside this repository.
- Lint-only checks: miss server-side rules and gate conditions.
- Skipping the job for forks: a skipped job counts as passing, so the gate
  would be silently bypassed.
- Failing the job while disabled: would block the introducing PR itself.
- The default "Sonar way" gate on the PR project: new-code conditions are
  meaningless on a single-branch project that receives unrelated merge commits.

## Consequences

- The PR project's dashboard shows only the last analysed pull request;
  concurrent runs are serialized by the `sonar-kdrive-mcp-server-pr` concurrency
  group, which may cancel a pending run that must then be re-run.
- Anyone with push access can read every Actions secret (accepted residual
  risk T3); project-scoped tokens limit a leak to analysis writes on one project.
- Bot pull requests receive no Actions secrets and fail closed, like forks.
- Reversing this choice needs owner server work (projects, gate, tokens) and a
  new CI contract version.
