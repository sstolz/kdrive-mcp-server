# MCP client compatibility matrix

Reference MCP authorization specification version: `2026-07-28` (SPEC §8).

This matrix records what each MCP client's public documentation says about the
OAuth mechanisms that decide the HTTP authentication mode of
[SPEC §8](../SPEC.md). It is defined by
[F-008 v1](../features/F-008-oidc-qualification.md) (BR-108) and read by
`make oidc-qualify`, which computes each client's mode from it (BR-103).

Rules for every row:

- Facts take only `supported`, `not supported` or `unverified`. A fact not read
  in a cited source on the check date is `unverified`.
- "Rejects inconsistent issuer identification" refers to RFC 9207: the client
  rejects an authorization response whose `iss` differs from the issuer, or is
  missing while the server advertises
  `authorization_response_iss_parameter_supported`.
- The two redirect URI columns give the form the client uses when the
  authorization server supports RFC 9207 issuer identification (metadata flag
  `true` and a matching `iss` in the response) and otherwise.
- "Equals reference" compares the stated MCP authorization version with the
  reference above (`yes`, `no`, or `unverified` when no version is stated).
- The real-test result is `not tested`, `passed` or `failed`. Real results come
  only from the owner-run qualification and P-12 client connections. As of
  2026-11-03 every row stays `not tested`: both qualified providers are
  `proxy-only`, so no client connection exists until the P-21 proxy and P-12
  HTTP runtime are delivered.

The agent read the claude.com and code.claude.com pages itself. The OpenAI
pages marked "owner-supplied" were provided by the owner on 2026-11-02 because
the agent could not fetch that host; the Apps SDK page was seen only as a
search excerpt.

| Client         | Checked    | Sources                                                                                                                                                                                                                                                          | Dynamic registration | CIMD       | Manual client ID | Rejects inconsistent issuer identification | Redirect URI with RFC 9207 issuer identification                | Redirect URI otherwise                                          | MCP authorization version | Equals reference | Real test  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------- | ---------------- | ------------------------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------- | ---------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| claude.ai      | 2026-11-02 | [Claude connector authentication](https://claude.com/docs/connectors/building/authentication)                                                                                                                                                                    | supported            | supported  | supported        | unverified                                 | `https://claude.ai/api/mcp/auth_callback`                       | `https://claude.ai/api/mcp/auth_callback`                       | 2025-11-25                | no               | not tested | Dynamic registration is the default. CIMD is used only when the metadata sets `client_id_metadata_document_supported` to `true` and lists `none` in `token_endpoint_auth_methods_supported`; otherwise dynamic registration. Custom connectors accept an OAuth client ID registered by the customer, with an optional secret. The page states no RFC 9207 condition for the callback.                                                                                                                                                                                                              |
| Claude iOS     | 2026-11-02 | [Claude connector authentication](https://claude.com/docs/connectors/building/authentication)                                                                                                                                                                    | supported            | supported  | supported        | unverified                                 | `https://claude.ai/api/mcp/auth_callback`                       | `https://claude.ai/api/mcp/auth_callback`                       | 2025-11-25                | no               | not tested | Relies on the page's statement that the callback serves web, Desktop, mobile and Cowork; no iOS-specific page was read. Same CIMD conditions as claude.ai.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Claude Desktop | 2026-11-02 | [Claude connector authentication](https://claude.com/docs/connectors/building/authentication)                                                                                                                                                                    | supported            | supported  | supported        | unverified                                 | `https://claude.ai/api/mcp/auth_callback`                       | `https://claude.ai/api/mcp/auth_callback`                       | 2025-11-25                | no               | not tested | Relies on the page's statement that the callback serves web, Desktop, mobile and Cowork; no Desktop-specific page was read. Same CIMD conditions as claude.ai.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Claude Code    | 2026-11-02 | [Claude Code MCP](https://code.claude.com/docs/en/mcp), [Claude connector authentication](https://claude.com/docs/connectors/building/authentication)                                                                                                            | supported            | unverified | supported        | unverified                                 | `http://localhost:<port>/callback`; `http://127.0.0.1/callback` | `http://localhost:<port>/callback`; `http://127.0.0.1/callback` | unverified                | unverified       | not tested | Manual entry: `--client-id`, `--client-secret` (masked prompt or `MCP_CLIENT_SECRET`) and `--callback-port`. CIMD appeared only in a summarized part of the Claude Code page. The connector page lists `http://localhost/callback` and `http://127.0.0.1/callback` with the port ignored. The Claude Code page mentions protocol revision 2026-07-28 but states no authorization specification version.                                                                                                                                                                                            |
| ChatGPT        | 2026-11-02 | [OpenAI authentication (owner-supplied)](https://developers.openai.com/plugins/build/auth), [Apps SDK authentication (search excerpt)](https://developers.openai.com/apps-sdk/build/auth), [Codex MCP (owner-supplied)](https://developers.openai.com/codex/mcp) | supported            | supported  | supported        | supported                                  | `https://chatgpt.com/connector_platform_oauth_redirect`         | `https://chatgpt.com/connector/oauth/{callback_id}`             | 2025-11-25                | no               | not tested | Owner-supplied pages. CIMD is preferred (client ID `https://chatgpt.com/oauth/client.json` or a per-callback document) with token authentication `none` or `private_key_jwt` only; dynamic registration happens once per connection; predefined OAuth clients are supported. PKCE S256 is mandatory and `resource` is sent on both requests. The rejection of a mismatched or missing advertised `iss` is stated on the Codex MCP page for the flow shared by the ChatGPT desktop app, the Codex CLI and the IDE extension. The authentication page also cites 2026-07-28 for response validation. |
| Codex          | 2026-11-02 | [Codex MCP (owner-supplied)](https://developers.openai.com/codex/mcp), [OpenAI authentication (owner-supplied)](https://developers.openai.com/plugins/build/auth)                                                                                                | supported            | supported  | supported        | supported                                  | `http://127.0.0.1/callback`                                     | `http://127.0.0.1:<port>/callback/<callback_id>`                | 2025-11-25                | no               | not tested | Owner-supplied pages. CIMD is chosen only when `client_id_metadata_document_supported` is `true`, `none` is listed and a loopback callback is supported (document `https://chatgpt.com/oauth/codex/client.json`, or a per-callback document). Manual entry: `codex mcp add --oauth-client-id` and `[mcp_servers.<name>.oauth]` `client_id`. The authorization server must accept a variable loopback port (RFC 8252 §7.3). The Codex page states no authorization version; the version comes from the authentication page, which covers ChatGPT and Codex.                                         |

## CIMD with the OAuth proxy (F-028)

The CIMD column records what each client documents. The proxy advertises CIMD
only with a nonempty `OAUTH_ALLOWED_CLIENT_ID_ORIGINS`; with the default empty
list every client above uses dynamic registration. The document URLs in the
ChatGPT and Codex rows come from owner-supplied pages and are unverified; no
document origin is listed by default.

Origins are found with the origin discovery procedure of
[the OAuth proxy notes](oauth-proxy.md#origin-discovery-procedure) and recorded
here, with the check date, before they are listed.

| Client    | Document origin found | Checked |
| --------- | --------------------- | ------- |
| claude.ai | none recorded yet     | n/a     |

## Parallel tool calls

Some clients, claude.ai among them, send several tool calls of one session in
parallel. The server runs one tool call (or resource read) per session at a
time, in arrival order:

- up to 4 further calls wait for the running one to finish, each for at most
  12 seconds; a waiting call makes no kDrive request;
- a call that finds 4 calls already waiting, or that waits 12 seconds, gets
  `SERVER_BUSY`;
- `SERVER_BUSY` means the call was refused before any kDrive request, so it is
  safe to retry, writes included, once an earlier call has completed;
- each call's own 10-second deadline and request budgets start only when it
  runs, so waiting does not shorten them.

Sessions never wait for each other: each stdio process and each HTTP session
has its own queue.
