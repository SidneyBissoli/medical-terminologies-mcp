# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build       # esbuild bundle: src/index.ts -> dist/index.js (ESM, node20)
npm start           # node dist/index.js (runs the MCP server over stdio)
npm run dev         # build + start
npm test            # vitest run (one-shot)
npm run test:watch  # vitest in watch mode
npm run typecheck   # tsc --noEmit (strict; not invoked by `npm run build`)
```

Run a single test: `npx vitest run src/utils/cache.test.ts` (or `-t '<name pattern>'` for a single case).

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
`who-client.ts` does the OAuth2 client_credentials dance against `icdaccessmanagement.who.int/connect/token` and caches the bearer token under `CACHE_PREFIX.TOKEN` for 50 min (tokens expire at 60). The release ID (`2024-01`) and linearization (`mms`) are pinned constants in `WHO_CONFIG` — bump them deliberately.

### Crosswalk caveat
`src/tools/crosswalk.ts` does *not* have authoritative mapping tables for everything (e.g., LOINC↔SNOMED). When a true mapping isn't freely available, the tool returns an explanatory text result rather than throwing — read the existing handlers before adding a new mapping to match this convention.

## Conventions worth knowing

- All tool handlers return `CallToolResult` with `content: [{ type: 'text', text: ... }]` for human/LLM display, plus `structuredContent` matching the `outputSchema` whenever the result is structured. Errors flow through `handleToolError` (sets `isError: true`); only unexpected errors propagate.
- Zod schemas in `src/types/index.ts` are the single source of truth — both runtime validation and the `Tool.inputSchema` / `Tool.outputSchema` JSON Schemas are derived from them. There is no hand-maintained JSON Schema to keep in sync.
- `src/server.ts` reads `SERVER_INFO.version` from `package.json` (`resolveJsonModule: true`) — bump the version in `package.json` only.
