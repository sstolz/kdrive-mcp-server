# Ticket — independent review, round N

Template only. Role: reviewer. Act: spec, code or short-path review.
Sources: exact spec/version, diff/revision and relevant working instructions.
Author/reviewer identities must differ; reviewer never edits the code.
Use a new agent for every act/round with `fork_turns="none"`; standalone criteria,
no author conversation or prior-verdict anchoring. Read earlier findings as
artifacts only where needed to verify fixes. Never reuse a reviewer session.
Author model/effort: record actual metadata or unknown.
Reviewer model/effort: record actual metadata or unknown; strength >= author.

## Verdict

Select `approve` or `changes` only after inspection; summarize remaining blockers.

## Findings

For each finding: ID, critical/major/minor severity, file:line, problem, concrete
fix. Spec reviews check ambiguity, contradictions, untestable ACs, edge cases and
hidden scope. Authors record retained/rejected spec findings with reasons.

## Traceability and scope

For full-path reviews, record AC → test evidence and BR-named test coverage;
check frozen scope, bugs and security. For short-path reviews, check the request,
accuracy, behavior preservation and appropriate evidence; require no invented
spec/BR/unit test or freeze for prose. Do not approve unsupported claims.

## Evidence and limits

Quote executed commands/results and distinguish inspection from tests. State
unverified points honestly. Save to `runs/<ticket>-<act>-<round>.md` and return at
most 15 lines. After two unresolved rounds, escalate to the user via orchestrator.
