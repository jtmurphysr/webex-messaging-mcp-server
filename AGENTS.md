# AGENTS.md — Agent Operating Constitution

This file is the primary context document for all agents operating in this repository.
Read it in full before taking any action. It is the source of truth for conventions,
boundaries, and the definition of "done."

---

## Repository Identity

- **Stack**: Node.js 18+ (20+ recommended), plain JavaScript (not TypeScript)
- **Origin**: Fork of [webex/webex-messaging-mcp-server](https://github.com/webex/webex-messaging-mcp-server)
- **Purpose**: MCP server providing AI assistants access to Cisco Webex messaging (52 tools)
- **Transport modes**: STDIO (default) and HTTP (StreamableHTTP)
- **Pipeline**: Issue → Agent → Code → PR → CI → Auto-merge
- **Human role**: Intent specification, issue authoring, outcome validation

---

## Repository Structure

```
├── lib/
│   ├── tools.js              # Tool discovery and loading
│   └── webex-config.js       # Centralized API configuration (auth headers, base URL)
├── tools/
│   └── webex-public-workspace/webex-messaging/
│       ├── create-a-message.js
│       ├── list-messages.js
│       └── ... (52 tools total)
├── commands/                  # CLI command modules (NEW — added by this fork)
├── scripts/
│   └── update-webex-tools.js  # Automated tool updates
├── tests/                     # Unit tests (118 tests across 53 suites)
├── mcpServer.js               # Main MCP server entry point
├── index.js                   # CLI interface
├── discover-tools.js          # Tool discovery utility
├── tools-manifest.json        # Tool metadata and categories
├── Dockerfile                 # Production container
├── docker-compose.yml         # Multi-container setup
└── docs/
    └── PRD.md                 # Product Requirements Document (agent reads this)
```

### Key architectural facts

- **All 52 tools use `fetch`** with headers from `lib/webex-config.js`. The config module is the single point of auth injection.
- **Tools are plain JS modules** in `tools/webex-public-workspace/webex-messaging/`. Each exports a standard MCP tool definition.
- **No build step**. No transpilation. Raw `.js` files run directly on Node.js.
- **Docker runs as non-root** user `mcp` (UID 1001).
- **Environment-driven configuration**: all secrets via env vars, never hardcoded.

---

## CI Gates

The repo has an existing test infrastructure. **All of these must pass before any PR merges.**

### Validation command (single gate)
```bash
npm run validate
```

This runs the full quality suite including:
- JavaScript syntax checking
- All 118 unit tests
- Code quality standards
- API implementation correctness

### Individual commands (for debugging)
```bash
npm test                  # Run all tests
npm run test:coverage     # Tests with coverage report
npm run test:local        # Same as npm test
node index.js tools       # Verify tool loading
npm run discover-tools    # Tool discovery analysis
```

### Pre-commit hooks
The repo uses **Husky** for pre-commit validation. On `git commit`, Husky automatically runs
`npm run validate`. If validation fails, the commit is rejected. This is enforced locally;
the CI workflow runs the same gate independently.

---

## Coding Conventions

### Style
- **Plain JavaScript** — no TypeScript, no JSX, no transpilation
- **CommonJS modules** — `require()` / `module.exports`, not ES module `import`/`export`
- **`fetch` for HTTP** — native Node.js fetch (18+), no axios, no node-fetch
- **No semicolons or specific style enforced** — follow the existing patterns in each file

### File patterns
- New tool files go in `tools/webex-public-workspace/webex-messaging/` following existing naming: `verb-a-noun.js`
- New library modules go in `lib/`
- New CLI commands go in `commands/` (new directory for this fork)
- Tests mirror source structure in `tests/`

### Error handling
- All API calls must handle network errors and non-2xx responses
- Error messages must include the Webex API tracking ID when available
- Never log credentials — mask tokens in all log output

### Environment variables
- New env vars must be added to `.env.example` with documentation
- Auth-related env vars must be documented in README under Configuration
- Use descriptive prefixes: `WEBEX_` for all Webex-related config

---

## Module Boundaries

### `lib/webex-config.js` — Auth and config ONLY
- Provides `getHeaders()`, `getBaseUrl()`, and configuration accessors
- **Must not** contain business logic, tool definitions, or I/O beyond config reading
- This is the integration point for the TokenProvider (see PRD)

### `lib/token-provider.js` — Token lifecycle ONLY (NEW)
- Auth mode detection (bearer / OAuth / bot)
- Token refresh logic with mutex
- Pre-emptive refresh (before expiry, not on 401)
- **Must not** know about MCP, tools, or Webex API endpoints beyond the token endpoint

### `lib/token-store.js` — Credential persistence ONLY (NEW)
- Read/write token credential file
- Filesystem permissions management
- **Must not** contain refresh logic or auth mode decisions

### `tools/*` — UNCHANGED
- The 52 existing tools are not modified by this fork
- Tools call `getHeaders()` from webex-config — they are unaware of auth mode
- New tools (if any) follow the same pattern

### `commands/` — CLI commands (NEW)
- `auth-setup.js` — one-time OAuth grant flow
- `auth-status.js` — token status reporter
- **Must not** import from `tools/` or modify tool behavior

---

## Agent Workflow

### Reading an issue
1. Read this AGENTS.md in full
2. Read `docs/PRD.md` for the product specification
3. Read the issue body — it contains the module spec, interface contracts, domain warnings, and test cases
4. Check the issue's dependency chain — if it depends on another issue, verify that issue's PR is merged first

### Building
1. Create a feature branch from `main`: `feature/<issue-slug>`
2. Write the code specified in the issue
3. Write tests for all new code — aim for the patterns in `tests/`
4. Run `npm run validate` — all 118+ tests must pass (existing + new)
5. Run `node index.js tools` — verify all 52 tools still load correctly

### Opening a PR
- Title: `feat: <short description>` or `fix: <short description>`
- Body: reference the issue number (`Closes #N`)
- Include a summary of what was built and any design decisions
- If domain warnings from the issue were encountered, document how they were handled

### Definition of Done
- [ ] Code matches the issue specification
- [ ] All existing tests pass (`npm run validate`)
- [ ] New code has unit tests
- [ ] No changes to any of the 52 existing tool files
- [ ] Environment variables documented in `.env.example`
- [ ] No credentials in logs or output (masked)
- [ ] PR references the issue it closes

---

## Domain Warnings (Global)

These apply across all issues in this fork:

⚠️ **WARNING: Do not modify existing tools** — The 52 tool files in `tools/` are upstream code.
Any change to them creates merge conflicts with the upstream repo. The auth abstraction must be
entirely transparent — tools call `getHeaders()` and get back valid headers, regardless of auth mode.

⚠️ **WARNING: Husky pre-commit hooks** — `git commit` triggers `npm run validate` automatically.
If you're running in a CI environment where Husky isn't installed, use `HUSKY=0 git commit` to skip.
But CI must still run `npm run validate` independently.

⚠️ **WARNING: Node.js 18+ required for fetch** — All HTTP calls use native `fetch`. If running on
Node.js < 18, `fetch` is undefined. The CI environment must use Node.js 18 or 20.

⚠️ **WARNING: Token security** — Never log access tokens, refresh tokens, or client secrets.
Use `token.substring(0, 8) + '...'` for debug output. The credential file must be created with
`0600` permissions (owner read/write only).

---

## Out of Scope (All Issues)

- Changes to any of the 52 existing tool files
- Multi-user / multi-tenant token management
- Web-based OAuth consent UI
- Token encryption at rest (v1 uses filesystem permissions only)
- Webex Meetings API (this is messaging-only)
- Rate limiting (not in scope for upstream, not in scope here)

---

## Learnings

_This section is updated as issues are completed. Each entry records what the agent learned
that should inform future work._

<!-- LEARNING: template
### Issue #N — <title>
- **What worked**: ...
- **What broke**: ...
- **Convention added**: ...
-->
