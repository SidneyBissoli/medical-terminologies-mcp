# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build       # esbuild bundle: src/index.ts -> dist/index.js (ESM, node20)
npm start           # node dist/index.js (runs the MCP server over stdio)
npm run dev         # build + start
npm test            # vitest run (skips integration tests by default)
npm run test:watch  # vitest in watch mode
npm run typecheck   # tsc --noEmit (strict; not invoked by `npm run build`)
```

Run a single test: `npx vitest run src/utils/cache.test.ts` (or `-t '<name pattern>'` for a single case).

Run integration tests against live APIs: `INTEGRATION_TESTS=1 npm test`. They live in `src/integration/` and skip by default. WHO and SNOMED integration tests skip cleanly when their respective creds/flags (`WHO_CLIENT_ID`/`WHO_CLIENT_SECRET`, `ENABLE_SNOMED_TOOLS`/`SNOMED_BASE_URL`) are absent. The daily cron CI workflow at `.github/workflows/integration.yml` runs them and surfaces upstream API drift close to when it happens.

The build is a single `esbuild` invocation that bundles everything except `@modelcontextprotocol/sdk` (kept external) and injects a `createRequire` shim so the ESM bundle can still `require()` CJS deps. `tree-shaking=false` is intentional — see "Tool registration" below.

The build also imports `package.json` directly (`resolveJsonModule: true`) so `SERVER_INFO.version` stays in sync with `package.json` — bump the version there only.

To exercise the server interactively: `npx @modelcontextprotocol/inspector node dist/index.js`.

## Runtime requirements

- Node.js >= 20 (ESM, top-level imports with side effects).
- `WHO_CLIENT_ID` / `WHO_CLIENT_SECRET` are required only for the 5 ICD-11 tools (OAuth2 client credentials). The server will still start without them; ICD-11 tool calls throw `AUTH_CONFIG_ERROR` at first use. LOINC, RxNorm, MeSH have no auth.
- **SNOMED is feature-flagged off by default.** `src/utils/feature-flags.ts` gates the SNOMED tools and the SNOMED branch of crosswalk behind `ENABLE_SNOMED_TOOLS=true`. The historical public IHTSDO Snowstorm endpoint (`browser.ihtsdotools.org/snowstorm/snomed-ct`) was retired and now returns HTTP 410, so operators must also set `SNOMED_BASE_URL` to a working self-hosted Snowstorm. Optional `SNOMED_LANGUAGE` is passed through as the `Accept-Language` header.
- **ATC** is served via NLM RxClass (`rxnav.nlm.nih.gov`), same host as RxNorm proper. The `RxNormClient` exposes `getATCByDrugName` / `getATCByCode` / `getATCMembers` that share the rxnorm rate limiter, retry, and cache. Note: `byId` only resolves ATC1-4 codes (1-5 chars); substance-level codes (7 chars) come back via `byDrugName` only — this is upstream behavior, surfaced in tool descriptions.
- **CID-10 has no API auth or rate limiting** — it's served from a bundled JSON dataset (DataSUS V2008). `src/data/cid10.json` is loaded at startup; `getCID10Client()` is a singleton over it. All search/lookup happens in-process. CI verifies the bundle's source-level `toolRegistry.register` count (currently 34: 27 prior + 3 ATC + 4 CID-10).
- `LOG_LEVEL` env var controls pino verbosity (default `info`).

## Architecture

### Single bundled entry point
`src/index.ts` is the only entry. It calls `createServer()` from `src/server.ts`, then `import`s every tool module purely for its side effects. Tool modules call `toolRegistry.register(tool, handler)` at top level, which is why `tree-shaking=false` is required in the esbuild config — otherwise the bundler would drop the "unused" tool imports and the registry would be empty at runtime.

### Tool registry pattern
`src/server.ts` defines a `ToolRegistry` singleton (`toolRegistry`) holding two maps: tool definitions (for `ListTools`) and handlers (for `CallTool`). Each `src/tools/*.ts` file:
1. Defines `Tool` objects whose `inputSchema` / `outputSchema` are produced by `buildInputSchema()` / `buildOutputSchema()` from `src/utils/zod-schema.ts` (Zod → JSON Schema via `zod-to-json-schema`, with `$schema` stripped and refs inlined). Tools also set `annotations: READ_ONLY_TOOL_ANNOTATIONS` (read-only, idempotent, open-world, non-destructive).
2. Defines async handler functions that validate args with Zod schemas from `src/types/index.ts`, call a client, and return `CallToolResult` — typically with both a human-readable `content` text *and* a `structuredContent` object matching the `outputSchema`.
3. Calls `toolRegistry.register(...)` at module load time for each tool.

Adding a new tool means: define the input/output schemas in `src/types/index.ts`, add definition + handler in the appropriate `src/tools/*.ts`, register at module bottom, and (if it's a brand-new file) `import './tools/newfile.js'` in `src/index.ts`. The meta-test at `src/index.test.ts` will fail if the new file isn't wired into the entry point — that's the cheap defense against a tool silently missing from `tools/list`.

### Error handling — `handleToolError`
Tool handlers wrap their body in `try { ... } catch (e) { return handleToolError(e); }` (`src/utils/zod-schema.ts`). It maps `ZodError` → validation-error result, `ApiError` → API-error result, and re-throws everything else so `server.ts`'s dispatcher logs and wraps it. For axios failures inside clients, `extractErrorMessage()` (`src/utils/extract-error-message.ts`) handles the production response shapes that the previous one-liner collapsed to "undefined" — including the OAuth `error_description` that the WHO token endpoint returns on 401/400.

### Bundled CID-10 dataset
`src/clients/cid10-client.ts` is the only client without HTTP — it loads `src/data/cid10.json` (DataSUS V2008, ~1.9 MB tabular header+rows shape) at startup and serves all CID-10 tools from memory. The dataset is frozen (DataSUS hasn't published a successor since 2008), so it's checked into git. `scripts/build-cid10-dataset.mjs` regenerates the JSON from the DataSUS CSV release on demand — only relevant if a new V20XX ever ships.

### Layered client architecture
Every external API has a dedicated client in `src/clients/` that composes three cross-cutting utilities from `src/utils/` in a fixed order:

```
rateLimiters.<api>.acquire()  →  withRetry(() => httpClient.request(...))  →  cache.set(...)
```

The clients are accessed via lazy singletons (`getWHOClient()`, `getNLMClient()`, etc.) so a missing env var only blows up when that specific terminology is actually called.

- **`utils/cache.ts`** — `node-cache` wrapper. Use `cache.getOrSet(prefix, key, factory, ttl)` with `CACHE_PREFIX.*` and `DEFAULT_TTL.*` constants (`STATIC` 24h, `LOOKUP` 1h, `SEARCH` 10min, `TOKEN` 50min). `useClones: false` — do not mutate cached objects.
- **`utils/rate-limiter.ts`** — Token bucket. Pre-configured limiters in `rateLimiters`: `who` (5/s), `nlm` (10/s, shared across LOINC + MeSH), `rxnorm` (20/s), `snomed` (10/s). Always `await rateLimiters.<api>.acquire()` before HTTP requests.
- **`utils/retry.ts`** — `withRetry()` with exponential backoff + 25% jitter. Retries on `[408, 429, 500, 502, 503, 504]` and network errors (`ECONNRESET`/`ECONNREFUSED`/`ETIMEDOUT`/`ENOTFOUND`/`socket hang up`).

### Logging — stderr only
`src/utils/logger.ts` configures pino to write to fd 2 (stderr). **Never log to stdout** — stdout is the MCP stdio transport. Use `createClientLogger('<api>')` and `createToolLogger('<tool>')` to get scoped child loggers. Pino runs with `sync: false`, so `logger.flush()` is called during graceful shutdown (`src/index.ts`) before `process.exit(0)`.

### WHO OAuth specifics
`who-client.ts` does the OAuth2 client_credentials dance against `icdaccessmanagement.who.int/connect/token` and caches the bearer token under `CACHE_PREFIX.TOKEN`. TTL is computed from the API's `expires_in` field as `max(60, expires_in - 60)` seconds — honors what the server actually returns instead of a hardcoded value. The release ID (default `'2024-01'`, overridable via `WHO_ICD11_RELEASE_ID`) and linearization (`mms`) are pinned constants in `WHO_CONFIG` — bump deliberately. Note: `lookup` by URI strips the leading `/icd` from the path before passing to axios (the baseURL already includes it); same with `getEntity`. Don't undo that.

### MeSH client fan-out
The NLM MeSH `/{id}.json` endpoint returns compact JSON-LD with no `@graph` wrapper — flat top-level fields (`label`, `treeNumber` URI(s), `preferredConcept` URI, `allowableQualifier` URI[s], `annotation`). To assemble a full descriptor, `mesh-client.ts` fans out: descriptor + each tree number + the preferred concept + each term URI on that concept + each qualifier URI, all fetched in parallel under the shared NLM rate limiter and cached separately (descriptor at `LOOKUP` TTL, sub-resources at `STATIC` TTL since they rarely change). `getDescriptor`/`getTreeNumbers`/`getAllowedQualifiers` share the same cached descriptor fetch — calling all three on one MeSH ID in sequence triggers exactly one descriptor HTTP. The "scope note" surfaced to tool consumers comes from the *preferred concept's* `scopeNote`, not the descriptor's `annotation` (which is an indexer note).

### Crosswalk caveat
`src/tools/crosswalk.ts` doesn't have authoritative mapping tables yet — `map_icd10_to_icd11` does honest text search (description explicitly says so), `map_loinc_to_snomed` returns guidance only, and `map_snomed_to_icd10` returns guidance only (gated behind `ENABLE_SNOMED_TOOLS=true`). Real mappings are planned in PROGRESS.md Phase 13. When adding a new crosswalk handler today, match the existing convention: rewrite the description honestly if the implementation isn't authoritative, return explanatory text rather than throwing when a mapping isn't available.

### Known upstream-degraded behavior
`/loinc_answers` at `clinicaltables.nlm.nih.gov` returns HTTP 404 in production (verified 2026-05-09). The client catches and returns `[]`, so `loinc_answers` reports "no answers available" for every input. Pinned in a contract test so it doesn't change without notice. Real fix is tracked as PROGRESS.md Phase 14.1 — likely uses `loinc_form_definitions` for form-type LOINCs.

### Testing layers

Three layers, all under `src/`:

- **Unit tests** (`src/utils/*.test.ts`, `src/types/schemas.test.ts`, `src/index.test.ts`, `src/clients/cid10-client.test.ts`) — pure-logic coverage of utils, Zod input/output validators, and the CID-10 in-memory client. The meta-test in `src/index.test.ts` asserts every `src/tools/*.ts` is imported by `src/index.ts` (cheap defense against forgetting the side-effect import).
- **Contract tests** (`src/clients/*.contract.test.ts`) — use `nock` (^14, devDep) to intercept axios calls, replaying captured live fixtures from `src/__fixtures__/<api>/`. Pin parser behavior against the actual upstream response shapes. WHO and SNOMED tests use inline mocks because their public hosts don't ship test creds. When adding a new HTTP client method, capture a live fixture and write a contract test pinning the parser.
- **Integration tests** (`src/integration/*.integration.test.ts`) — hit live APIs. Gated by `INTEGRATION_TESTS=1`; otherwise the `describe` blocks become `describe.skip`. WHO + SNOMED sub-suites skip cleanly when their creds/flags are absent. CI runs them daily on cron — production regressions surface close to when they happen.

Total: 243 unit + contract tests, 11 integration tests (skipped by default).

## Conventions worth knowing

- All tool handlers return `CallToolResult` with `content: [{ type: 'text', text: ... }]` for human/LLM display, plus `structuredContent` matching the `outputSchema` whenever the result is structured. Errors flow through `handleToolError` (sets `isError: true`); only unexpected errors propagate.
- Zod schemas in `src/types/index.ts` are the single source of truth — both runtime validation and the `Tool.inputSchema` / `Tool.outputSchema` JSON Schemas are derived from them. There is no hand-maintained JSON Schema to keep in sync.
- `src/server.ts` reads `SERVER_INFO.version` from `package.json` (`resolveJsonModule: true`) — bump the version in `package.json` only.

## Forward-looking work

`PROGRESS.md` is the implementation diary: Phases 0-10 ✅ complete (the work that built the current 28/34-tool surface), Phases 11-14 📋 planned (Distribution & Discovery, Content & Outreach, Coverage Expansion, Quality & Maintenance). Each planned phase has sub-tasks, requirements checklists, dependencies, and effort estimates. When picking up work, check there first — it captures rationale and triggers, not just task lists.

`outreach-templates.md` holds copy-paste-ready drafts for Phase 12 (post drafts, email templates, submission text). Tool counts and version numbers there are kept in sync with the current state, but verify before publishing.

`CHANGELOG.md` is consumer-facing release notes (Keep-a-Changelog format).
