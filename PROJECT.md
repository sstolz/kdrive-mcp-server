# PROJECT.md — project parameters

This file sets the parameters that [AGENTS.md](AGENTS.md) leaves to the
project, and records the owner decisions behind them. AGENTS.md stays a
portable method; everything specific to this repository lives here.

## Parameters

| Parameter                        | Value                                                                                                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation language            | French                                                                                                                                                                                   |
| Artifact language                | English, unless the user explicitly asks otherwise                                                                                                                                       |
| Main branch                      | `main`                                                                                                                                                                                   |
| Forge and tickets                | GitHub issues and pull requests of `sstolz/kdrive-mcp-server`                                                                                                                            |
| Label taxonomy                   | English `type:*` and `area:*` labels, see [docs/issue-labels.md](docs/issue-labels.md)                                                                                                   |
| Local gate (full path)           | `make check` (lint, format, typecheck, build, tests, package verification)                                                                                                               |
| Local gate (short path)          | `make format-check` plus the content and link checks the change needs                                                                                                                    |
| Freeze mode                      | autonomous (decision D-1)                                                                                                                                                                |
| In-scope corrections             | continue without asking the owner (decision D-2), within the round limit of AGENTS.md §3                                                                                                 |
| Soft token budget per ticket     | 600k sub-agent tokens (decision D-3)                                                                                                                                                     |
| Diff-only confirmation threshold | 50k sub-agent tokens per round (decision D-7)                                                                                                                                            |
| Model tier: strong               | Opus 5.5, effort high — every iterative spec and code review round (decision D-3)                                                                                                        |
| Model tier: strongest            | Fable 5.2 — decision passes and the milestone global pass (decisions D-3, D-8); the per-milestone plan is in docs/github-backlog.md (archive `docs/github-backlog.md`) ("Review models") |
| Model tiers: light, standard     | not fixed; the orchestrator picks per AGENTS.md §5                                                                                                                                       |
| Reviewer tool                    | [`.claude/agents/reviewer.md`](.claude/agents/reviewer.md) (strong tier, read-only); use it for every strong-tier review round with a narrow diff-only brief when possible               |
| Toolchain                        | Docker-only (decision D-4)                                                                                                                                                               |
| Companion records repository     | none                                                                                                                                                                                     |

## Toolchain rules (Docker-only)

Everything runs inside the dev Compose service, driven by a Makefile (GNU Make
3.81 compatible): install, Node/npm, TypeScript, lint, format, tests, build,
packing, and fixture Git operations.

- Never install host tools.
- Never change Docker engine or socket permissions to get around a restriction.
- Keep the dev containers separate from the production image.
- Never remove a volume or any data without authorization.
- Check `docker info` before each gate; in a cloud container, start the daemon
  by hand when it fails (see `learnings.md`, 2026-11-10).
- F-001 v2 records this contract change.

## Transitional deviations

- **Evidence files in `runs/` (2026-11-11, #92).** AGENTS.md §9 keeps per-run files out of the
  product repository. This repository still holds its historical `runs/`
  directory. From #92 on, new evidence goes to tickets and PRs as §9 says;
  existing `runs/` files are preserved unchanged. Exit condition: the
  public-publication preparation ticket. Extracting the kDrive API
  observations into `docs/observations/kdrive-api.md` and keeping `runs/` only
  in a private archive belongs to the public-publication preparation ticket.
- **Reviewer publication (2026-11-11, #92).** AGENTS.md §9 has the reviewer publish its own
  verdict. The reviewer tool above has no forge write access, so until it does,
  the orchestrator posts the reviewer's report verbatim and unedited on the PR,
  under the reviewer's evidence identifier, and adds nothing to it. Exit condition: the reviewer tool
  gains forge write access.

## History

- **CI bootstrap.** Tickets #1 and #2 were docs and admin work done before CI
  existed. For them, an independent `approve` plus successful local document,
  link and content checks stood in for CI. This granted no product waiver and
  is never called "green CI". CI is mandatory from #3 onward.
- **README-only exception.** One direct commit to `main` initialized the empty
  repository. That exception is used up and authorizes no further direct-main
  operation.

## Decisions log

Owner decisions that set the parameters above, with their date and source.

- **D-1 — 2026-11-01 — Autonomous freeze.** Owner's words: “ok go, on va
  supprimer l'étape de freeze par humain pour ce projet, conserve néanmoins la
  directive dans AGENTS.md”. The human freeze stays in AGENTS.md §2 as the
  default mode; this project uses the autonomous mode.
- **D-2 — 2026-11-02 — Autonomous in-scope corrections.** Owner's words: “tu
  peux corriger et pas besoin de mon avis pour corriger”. Routine corrections
  within the approved ticket scope continue regardless of review rounds, bounded by the
  AGENTS.md §3 round limit and the D-3 budget; every
  corrected head still needs the local gate, CI and a fresh independent review.
  Unresolved product or contract decisions still go to the owner.
- **D-3 — 2026-11-03 — Review models and token economy.** Recorded in #50 and
  docs/github-backlog.md (archive `docs/github-backlog.md`) ("Review models"): Opus 5.5
  effort high for iterative rounds; one Fable 5.1 decision pass on the spec and
  one on the code for security-sensitive tickets, each after an Opus approval;
  one global Fable pass per milestone; a fresh author per phase; per-ticket
  token records at freeze and closure; a 600k soft budget with stop-and-report.
- **D-4 — 2026-11-01 — Docker-only development.** Recorded in F-001 v2 and
  `learnings.md` (2026-11-01).
- **D-5 — 2026-11-11 — Portable method.** Recorded in #92: AGENTS.md holds the
  method only, with no reference to this product or to any agent vendor, model
  or tool; this file holds the parameters and the decisions.
- **D-6 — 2026-11-11 — Evidence location in multi-user work.** Recorded in the
  #92 comment of 2026-11-11 (archive issue 92):
  durable knowledge in `docs/observations/`, decision proof in tickets and PRs,
  no per-run files in the product repository (AGENTS.md §9).
- **D-7 — 2026-11-11 — Diff-only threshold.** #92 asks for "a small token
  threshold" below which a diff-only confirmation round does not count toward
  the round limit. The orchestrator set it at 50k sub-agent tokens: diff-only
  rounds of the reviewer tool measured about 17–38k (`learnings.md`,
  2026-11-05). The owner may change it.
- **D-8 — 2026-11-11 — Strongest tier on Fable 5.2.** Recorded in #101. Owner's
  words: “dans PROJECT.md, la correspondance du niveau le plus fort de Fable 5.1
  vers Fable 5.2”. The strongest tier maps to Fable 5.2 instead of Fable 5.1;
  the rest of D-3 is unchanged. The milestone 0.4 global pass was already
  served by Fable 5.2 (#100 comment of 2026-11-11).
