# PRD: Webex MCP Server — OAuth2 Integration Support

## Vision

The Webex Messaging MCP Server provides AI assistants with comprehensive access to Cisco Webex, but its 12-hour bearer token authentication makes it unusable for any production or automated workflow. This feature adds OAuth2 Integration support with transparent token refresh, enabling the server to run indefinitely without human intervention while remaining fully backward compatible with the existing bearer token auth.

## Users

- **Primary**: Developers running the MCP server as a long-lived service for agentic workflows, scheduled automation, or CI/CD integration. They have a Webex account, can register an Integration at developer.webex.com, and are comfortable with environment variables and Docker.
- **Secondary**: The existing user base using short-lived developer tokens for interactive/demo use. Their experience must not change.

## Core Workflow

### One-Time Setup (OAuth Integration Mode)

1. User registers a Webex Integration at developer.webex.com, specifying the required scopes (messaging, rooms, memberships, etc.) and a redirect URI (localhost for CLI setup)
2. User sets `WEBEX_CLIENT_ID` and `WEBEX_CLIENT_SECRET` in `.env`
3. User runs `npm run auth:setup`
4. Setup command opens the Webex OAuth authorization URL in the user's browser
5. User authenticates and grants permissions
6. Webex redirects to the local callback with an authorization code
7. Setup command exchanges the code for an access token + refresh token pair
8. Tokens are stored in a local credential file (`~/.webex-mcp/tokens.json`) with filesystem-only permissions (0600)
9. Setup command confirms success and reports token expiry times

### Runtime (Transparent to MCP Clients)

1. Server starts → TokenProvider reads env vars to determine auth mode
2. If OAuth mode: TokenProvider loads stored tokens, checks access token expiry
3. If access token is expired or within refresh window (configurable, default 1 hour before expiry): TokenProvider calls `POST https://webexapis.com/v1/access_token` with `grant_type=refresh_token`
4. New access token + refreshed refresh token are persisted to credential file
5. All 52 tools continue using `getHeaders()` from webex-config — they are unaware of the auth mode
6. If a tool call receives a 401: TokenProvider intercepts, attempts one refresh, retries the request
7. If refresh fails (e.g., refresh token expired after 90 days of inactivity): server logs a clear error directing the user to re-run `npm run auth:setup`

### Bearer Token Mode (Unchanged)

1. `WEBEX_PUBLIC_WORKSPACE_API_KEY` is present → server uses it directly
2. No refresh logic. Token expires in 12 hours. Current behavior preserved exactly.

### Bot Token Mode (New, Simple)

1. `WEBEX_BOT_TOKEN` is present → server uses it directly
2. No refresh logic needed — bot tokens don't expire
3. Scoped to bot permissions (no user-context operations)

## Secondary Workflows

### Token Status Check
- `GET /health` (HTTP mode) or a new `npm run auth:status` CLI command reports: auth mode, token type, expiry timestamp, time until expiry, last successful refresh time
- Useful for monitoring dashboards and debugging

### Token Refresh Failure Recovery
- If automatic refresh fails, server enters degraded mode: continues serving cached data where possible, returns clear error messages on API calls that require fresh auth
- Logs include the specific Webex error response and remediation steps
- Does not crash — allows the operator to fix credentials without restart

### Credential Rotation
- Running `npm run auth:setup` again overwrites stored credentials
- No migration needed — the token file is stateless (just current token pair + metadata)

## Data Model

### TokenCredential (persisted to `~/.webex-mcp/tokens.json`)
```
{
  "auth_mode": "oauth" | "bearer" | "bot",
  "access_token": string,
  "access_token_expires_at": ISO8601 timestamp,
  "refresh_token": string | null,
  "refresh_token_expires_at": ISO8601 timestamp | null,
  "scopes": string[],
  "last_refresh_at": ISO8601 timestamp | null,
  "created_at": ISO8601 timestamp
}
```

All fields required except refresh_token fields (null for bearer/bot modes). The file should be created with `0600` permissions (owner read/write only).

### TokenProvider (in-memory, runtime)
```
{
  mode: "oauth" | "bearer" | "bot",
  currentToken: string,
  expiresAt: Date | null,
  refreshBuffer: number (ms, default 3600000),
  isRefreshing: boolean (mutex for concurrent refresh)
}
```

## Integrations

| Service | Auth Mechanism | Purpose |
|---------|---------------|---------|
| Webex OAuth2 (`webexapis.com/v1/access_token`) | OAuth2 authorization code grant + refresh token | Token acquisition and refresh |
| Webex REST API (`webexapis.com/v1/*`) | Bearer token in Authorization header | All 52 existing tools (unchanged) |
| Local filesystem (`~/.webex-mcp/tokens.json`) | Filesystem permissions (0600) | Credential persistence |

## Technical Constraints

- **Language/framework**: Node.js 18+ (matching existing codebase). No new runtime dependencies for the token refresh — use native `fetch` (already used throughout). The setup CLI may use `open` (npm package) to launch browser.
- **Deployment target**: Same as current — local Node.js, Docker (STDIO and HTTP modes). Token file must be volume-mountable in Docker for persistence across container restarts.
- **Performance requirements**: Token refresh adds one HTTP round-trip (~200-500ms) at most once per 14 days during normal operation. The pre-expiry refresh window means this never happens during a user-facing tool call under normal conditions.
- **Security requirements**: Tokens at rest protected by filesystem permissions only (v1). No encryption at rest. Credentials never logged (mask in all log output). Client secret only needed during setup, not at runtime. Refresh token is the sensitive long-lived credential.
- **Compatibility**: Must pass all 118 existing unit tests without modification. Bearer token mode must be byte-for-byte identical in behavior to current implementation.

## Module Map (Proposed)

```
lib/
├── webex-config.js          ← MODIFY: delegate to TokenProvider for headers
├── token-provider.js        ← NEW: auth mode detection, token lifecycle, refresh logic
├── token-store.js           ← NEW: read/write credential file, permissions management
└── tools.js                 ← UNCHANGED
commands/
├── auth-setup.js            ← NEW: interactive OAuth grant flow CLI
└── auth-status.js           ← NEW: token status reporter
scripts/
└── setup-oauth-callback.js  ← NEW: minimal localhost HTTP server for OAuth redirect capture
```

### Key Design Decisions

**TokenProvider as a singleton**: Instantiated once at server startup, injected into webex-config. All tools call `getHeaders()` which delegates to `TokenProvider.getAuthHeader()`. This is the only change existing code sees.

**Refresh mutex**: Multiple concurrent tool calls could trigger simultaneous 401s. The TokenProvider must use a mutex/promise-based lock so only one refresh executes; others await the result.

**Pre-emptive refresh**: Don't wait for a 401. Check `expiresAt - refreshBuffer` on every `getAuthHeader()` call and refresh proactively. This avoids ever serving a stale token to a tool.

**Docker volume for tokens**: Document that Docker deployments should mount `~/.webex-mcp/` as a volume:
```yaml
volumes:
  - webex-mcp-tokens:/home/mcp/.webex-mcp
```

## Domain Warnings

⚠️ **WARNING: OAuth redirect on headless/Docker** — The one-time setup command requires a browser for the OAuth consent flow. This cannot run inside a Docker container. Document that `npm run auth:setup` must be run on the host, then the resulting token file mounted into the container.

⚠️ **WARNING: Refresh token expiry cliff** — Refresh tokens expire after 90 days of *non-use*. If the server is stopped for >90 days, the refresh token dies silently. The setup command must be re-run. Log a warning when the refresh token is within 30 days of expiry.

⚠️ **WARNING: Concurrent refresh race condition** — Multiple tool calls failing with 401 simultaneously can trigger parallel refresh attempts. Only the first should execute; others must await. Without a mutex, you'll get redundant refresh calls and potentially invalidate a just-refreshed token.

⚠️ **WARNING: Token invalidation by admin** — A Webex org admin can deactivate/reactivate a user's account, which invalidates all tokens. The refresh will fail with a specific error. Surface this clearly — it's not a bug, it's an admin action.

⚠️ **WARNING: Scope mismatch** — If the user registers the Integration with insufficient scopes, tools will get 403s, not 401s. The token refresh will succeed but the tool call still fails. Auth:status should report scopes so users can diagnose this.

⚠️ **WARNING: Husky pre-commit gate** — The repo has 118 unit tests running via Husky on every commit. All new code must have tests, and all tests must pass. The pre-commit hook runs `npm run validate`. Factor this into the development workflow.

## Out of Scope (v1)

- **Token encryption at rest** — Filesystem permissions only. Encryption is a v2 concern.
- **Multi-user token management** — One user, one token pair. Multi-tenant is a different architecture.
- **Web-based setup UI** — CLI only for the OAuth grant flow.
- **Automatic scope detection** — User must manually select scopes during Integration registration.
- **Changes to existing tools** — Zero modifications to any of the 52 tool files.
- **Webex Meetings API** — This is messaging-only, matching the existing server scope.
- **Token migration tooling** — No migration from bearer to OAuth needed; they coexist.
- **Rate limiting** — Already out of scope for the existing server; remains so.

## Definition of Done

1. All three auth modes work: bearer (existing behavior unchanged), OAuth Integration (with refresh), bot token (pass-through)
2. `npm run auth:setup` completes the full OAuth grant flow and persists tokens
3. `npm run auth:status` reports token mode, expiry, and scopes
4. Token refresh happens transparently — no MCP client awareness
5. A server running in OAuth mode can operate for >14 days without manual intervention (token refreshes automatically)
6. Docker deployment documented with volume mount for token persistence
7. All 118 existing tests pass without modification
8. New tests cover: mode detection, token refresh lifecycle, 401 retry, mutex behavior, token file I/O, credential file permissions
9. README updated with OAuth setup instructions alongside existing bearer token docs
10. `.env.example` updated with new environment variables

## Open Questions

1. **Credential file location**: `~/.webex-mcp/tokens.json` or relative to the project directory? Project-relative is simpler for Docker but messier for multi-project setups. Recommend `~/.webex-mcp/` with an env var override (`WEBEX_TOKEN_STORE_PATH`).
2. **Minimum scopes for the 52 tools**: Should the setup command validate that the registered Integration has sufficient scopes for all tools? Or just document the recommended scope set?
3. **Bot token priority**: If both `WEBEX_BOT_TOKEN` and `WEBEX_CLIENT_ID` are set, which wins? Recommend: explicit `WEBEX_AUTH_MODE` env var, with auto-detection as fallback (precedence: OAuth > Bot > Bearer).
4. **Maintainer preferences**: The upstream repo has only 2 commits. Are there contributing guidelines beyond what's in `.github/`? Should align with maintainers before building.

---

## For the Issues Agent

This PRD is ready for decomposition into agent-executable issue specifications.
The module map above should seed the issue boundary definitions.
Domain warnings should become explicit ⚠️ WARNING blocks in each relevant issue.
Out of scope items should appear in every issue's OUT OF SCOPE section.

Suggested issue sequence:
1. `lib/token-store.js` — credential file I/O (no external dependencies)
2. `lib/token-provider.js` — auth mode detection, refresh logic, mutex (depends on token-store)
3. Modify `lib/webex-config.js` — delegate to TokenProvider (depends on token-provider)
4. `commands/auth-setup.js` + `scripts/setup-oauth-callback.js` — OAuth grant flow CLI (depends on token-store)
5. `commands/auth-status.js` — status reporter (depends on token-provider)
6. Health check enhancement in `mcpServer.js` (depends on token-provider)
7. Tests for all new modules
8. README + `.env.example` documentation update
