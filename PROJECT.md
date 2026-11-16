# PROJECT.md — project parameters

The parameters that [AGENTS.md](AGENTS.md) leaves to the project, and the owner
decisions behind them. AGENTS.md stays a portable method; everything specific
to this repository lives here.

## Parameters

- **Languages:** conversation in French; artifacts in English unless the user
  asks otherwise.
- **Main branch and forge:** `main`; GitHub issues and pull requests of
  `sstolz/kdrive-mcp-server`.
- **Labels:** GitHub default type labels plus `chore`, `research` and `area/*`
  ([docs/issue-labels.md](docs/issue-labels.md)) (D-10).
- **Local gate:** `make check` on the full path (lint, format, typecheck, build,
  tests, package verification); `make format-check` plus the needed content and
  link checks on the short path.
- **Freeze mode:** autonomous (D-1). In-scope corrections continue without
  asking the owner, within the AGENTS.md §3 round limit (D-2).
- **Token budget:** 600k sub-agent tokens per ticket, soft (D-3); diff-only
  confirmation threshold 50k per round (D-7).
- **Model tiers:** strong = Opus 5.5, effort high, for every iterative spec and
  code review round, through the reviewer tool
  [`.claude/agents/reviewer.md`](.claude/agents/reviewer.md) (read-only; narrow
  diff-only briefs when possible). Strongest = Fable 5.2, for the decision
  passes of security-sensitive tickets, the milestone global pass and complex
  work (D-3); the per-milestone plan is in the archive's
  `docs/github-backlog.md` ("Review models").
  Light and standard are picked per AGENTS.md §5.
- **Authoring:** the Codex CLI authors specs, implementations and records; the
  orchestrator runs the gate, commits, pushes and merges (D-11).
- **Toolchain:** Docker-only (D-4). Companion records repository: none.

## Toolchain rules (Docker-only)

Everything runs in the dev Compose service through the Makefile (GNU Make 3.81
compatible). Never install host tools. Never change Docker engine or socket
permissions to get around a restriction. Never remove a volume or data
without authorization. Keep the dev
containers separate from the production image. Check `docker info` before each
gate; in a cloud container start the daemon by hand when it fails
(`learnings.md`, 2026-11-10). F-001 v2 records this contract.

## Transitional deviation

- **Reviewer publication (2026-11-11).** The reviewer tool has no forge write
  access, so the orchestrator posts its report verbatim on the PR under the
  reviewer's evidence identifier, adding nothing. Exit: the tool gains forge
  write access.

## Public-content rule

This repository is public. Commits, issues, pull requests, review records and
tracked files carry no session links, e-mail addresses other than GitHub
`noreply` ones, personal names, organisation domains, private hostnames or
links to private repositories (D-9). Evidence from private systems is
summarised without identifiers.

## History

- Development moved on 2026-11-12 from a private repository (the archive, with
  the closed tickets and the `runs/` evidence files) to this one, which started
  from a clean root commit (D-9). In records dated before 2026-11-12, `#N` and
  "archive issue N" refer to the archive; later records cite this repository.
- Archive tickets 1 and 2 ran before CI existed (independent approval plus
  local checks, never called green CI, granting no product waiver); CI is
  mandatory from archive ticket 3 onward. One direct commit initialized
  `main`; that exception is used up.

## Decisions log

Owner decisions, with their date. Entries state the decision; they do not
quote anyone's words.

- **D-1 — 2026-11-01 — Autonomous freeze.** No human freeze step for this
  project; AGENTS.md §2 keeps the human mode as the default.
- **D-2 — 2026-11-02 — Autonomous in-scope corrections.** Within the ticket
  scope, bounded by the round limit and the budget; every corrected head still
  needs the gate, CI and a fresh review. Product or contract decisions go to
  the owner.
- **D-3 — 2026-11-03, updated 2026-11-11 — Review models and token economy.**
  Strong tier for iterative rounds; one strongest-tier decision pass on the
  spec and one on the code for security-sensitive tickets only, each after a
  strong-tier approval; one strongest-tier global pass per milestone; a fresh
  author per phase; token records at freeze and closure; the 600k soft budget
  with stop-and-report. The strongest tier moved from Fable 5.1 to Fable 5.2
  on 2026-11-11.
- **D-4 — 2026-11-01 — Docker-only development** (F-001 v2).
- **D-5 — 2026-11-11 — Portable method.** AGENTS.md names no product, vendor,
  model or tool; this file holds the parameters and decisions. `CLAUDE.md`
  only imports both files.
- **D-6 — 2026-11-11 — Evidence location.** Durable knowledge in
  `docs/observations/`, decision proof in tickets and PRs, no per-run files in
  this repository (AGENTS.md §9).
- **D-7 — 2026-11-11 — Diff-only threshold** of 50k sub-agent tokens, from
  measured diff-only rounds of 17–38k (`learnings.md`, 2026-11-05); the owner
  may change it.
- **D-9 — 2026-11-12 — Development in this repository.** The archive is
  frozen; its open tickets were recreated here (#2–#8). No `runs/` directory
  here.
- **D-10 — 2026-11-12 — Labels** follow common practice
  ([docs/issue-labels.md](docs/issue-labels.md)).
- **D-11 — 2026-11-15 — Codex CLI as author.** The Codex CLI, on the owner's
  ChatGPT plan, authors specs, implementations, review fixes and records in a
  dedicated worktree, with writes limited to it. The orchestrator writes the
  briefs, runs the gate, commits, pushes, publishes evidence and merges; Codex
  never pushes, merges, comments on the forge or changes the environment.
  Codex output is reviewed and checked like any author's. Reviews stay with
  the strong and strongest tiers. An optional Codex review, for
  security-sensitive tickets or on owner request, uses the identifier
  `<ticket>-<act>-<round>-codex` and is posted verbatim with the Codex
  version, model and effort (`unknown` if not reported); its findings are
  accepted, rejected with a reason, or sent to the owner, and accepted ones go
  to the next strong-tier round. It never counts toward the round limit or
  replaces a strong-tier approval. Prompts follow the public-content rule.
  Codex usage counts on the owner's plan, not on the sub-agent budget; the
  orchestrator notes the tokens Codex reports per ticket. Setup:
  [docs/development.md](docs/development.md#codex-cli).
- **D-12 — 2026-11-15 — No backlog file.** Out-of-scope findings become
  GitHub issues with no milestone; `BACKLOG.md` was triaged into #72–#81 and
  removed (#6). Where a decision is the owner's, the issue says
  "owner decision needed".

D-8 (Fable 5.2) is folded into D-3.
