# ADR-011 — OAuth state file version 2 for CIMD families

Status: proposed (2026-11-14). Design of
[F-028 v1](../features/F-028-client-id-metadata-documents.md) (ticket #3,
D-10, BR-311, BR-295 v2, BR-298 v2, BR-299 v2). Not frozen.

## Context

F-019 stores registered clients and refresh families in an SQLite file at
format version 1 (`user_version` 1). A version 1 family must name a client
row, and a client row's ID is a 43-character random identifier. A CIMD client
(F-028) has no registration: its client ID is an `https` URL resolved on
demand, yet its refresh families must survive a restart like any other.
Older releases refuse a `user_version` above 1 with `OAUTH_STATE_VERSION` and
any row that breaks the version 1 rules with `OAUTH_STATE_CORRUPT`. A format
written in the field cannot be withdrawn: every later release must read it.

## Decision

Define format version 2 as the version 1 schema with one relaxed row rule: a
family's `client_id` may be a CIMD client ID (syntax checks only) with no
client row. The version is content-dependent: a transaction that inserts a
CIMD family sets `user_version` to 2, and the startup transaction sets it to
2 when a CIMD family survives the purge and to 1 otherwise; between startups
the version is never lowered, so a file stays at 2 after its last CIMD family
is deleted until the next startup transaction. Readers accept 1 and 2 and
apply the row rules of the file's own version. Writers check each row against
the rules of the version their transaction writes (2 when the file is at 2 or
the transaction inserts a CIMD family, 1 otherwise; F-028 BR-298 v2 and
BR-299 v2), so the first CIMD family write is not a failed write.

## Options rejected

- Store CIMD clients as client rows: needs a schema change (ID format, no
  secret, no idle purge) and turns an on-demand client into a registration.
- Always write version 2 after an upgrade: every operator loses the downgrade
  path, including those who never enable CIMD.
- Keep version 1 with the relaxed rule: an older release would report a
  CIMD file as corrupt instead of as a newer version.

## Consequences

- A file without CIMD families stays readable by the F-019 release.
- A file with CIMD families is refused by the F-019 release with
  `OAUTH_STATE_VERSION`; the documented path back is to empty
  `OAUTH_ALLOWED_CLIENT_ID_ORIGINS`, start this release once (the purge
  removes the CIMD families and writes version 1), then downgrade.
- Every later format version must migrate from both 1 and 2.
