# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build         # esbuild bundle: src/index.ts -> dist/index.js (Node, ESM, node20)
npm run build:worker  # esbuild bundle: src/worker.ts -> dist/worker.js (Cloudflare Workers, ESM, es2022)
npm run build:all     # both bundles
npm start             # node dist/index.js (runs the MCP server over stdio)
npm run dev           # build + start (stdio)
npm run dev:worker    # build:worker + wrangler dev (HTTP locally on :8787)
npm test              # vitest run (skips integration tests by default)
npm run test:watch    # vitest in watch mode
npm run typecheck     # tsc --noEmit (strict; not invoked by `npm run build`)
```

Run a single test: `npx vitest run src/utils/cache.test.ts` (or `-t '<name pattern>'` for a single case).

The package is published to npm with `"bin": { "medical-terminologies-mcp": "dist/index.js" }`, so consumers can launch the stdio server via `npx medical-terminologies-mcp` without cloning. `prepublishOnly` runs `npm run build` automatically before `npm publish` so the bundle is fresh in every release.

Run integration tests against live APIs: `INTEGRATION_TESTS=1 npm test`. They live in `src/integration/` and skip by default. WHO and SNOMED integration tests skip cleanly when their respective creds/flags (`WHO_CLIENT_ID`/`WHO_CLIENT_SECRET`, `ENABLE_SNOMED_TOOLS`/`SNOMED_BASE_URL`) are absent. The daily cron CI workflow at `.github/workflows/integration.yml` runs them and surfaces upstream API drift close to when it happens.

The build is two `esbuild` invocations sharing the same source tree. The Node build (`dist/index.js`) targets `node20`, keeps `@modelcontextprotocol/sdk` external (resolved via runtime `node_modules`), and injects a `createRequire` shim so the ESM bundle can still `require()` CJS deps. The Workers build (`dist/worker.js`) targets `es2022`/`workerd` conditions, aliases bare Node imports to their `node:` namespaced equivalents, and inlines everything including the SDK (~558 KB gzipped). Both builds use `tree-shaking=false` — see "Tool registration" below.

Both entry points import `package.json` directly (`resolveJsonModule: true`) so `SERVER_INFO.version` stays in sync with `package.json` — bump the version there only.

To exercise the stdio server interactively: `npx @modelcontextprotocol/inspector node dist/index.js`. To exercise the Workers build locally: `npm run dev:worker` then `npx @modelcontextprotocol/inspector --transport streamable-http --server-url http://localhost:8787/mcp`.

## Runtime requirements

- Node.js >= 20 (ESM, top-level imports with side effects).
- `WHO_CLIENT_ID` / `WHO_CLIENT_SECRET` are required only for the 5 ICD-11 tools (OAuth2 client credentials). The server will still start without them; ICD-11 tool calls throw `AUTH_CONFIG_ERROR` at first use. LOINC, RxNorm, MeSH have no auth.
- **SNOMED is feature-flagged off by default.** `src/utils/feature-flags.ts` gates the SNOMED tools and the SNOMED branch of crosswalk behind `ENABLE_SNOMED_TOOLS=true`. The historical public IHTSDO Snowstorm endpoint (`browser.ihtsdotools.org/snowstorm/snomed-ct`) was retired and now returns HTTP 410, so operators must also set `SNOMED_BASE_URL` to a working self-hosted Snowstorm. Optional `SNOMED_LANGUAGE` is passed through as the `Accept-Language` header.
- **ATC** is served via NLM RxClass (`rxnav.nlm.nih.gov`), same host as RxNorm proper. The `RxNormClient` exposes `getATCByDrugName` / `getATCByCode` / `getATCMembers` that share the rxnorm rate limiter, retry, and cache. Note: `byId` only resolves ATC1-4 codes (1-5 chars); substance-level codes (7 chars) come back via `byDrugName` only — this is upstream behavior, surfaced in tool descriptions.
- **CID-10 has no API auth or rate limiting** — it's served from a bundled JSON dataset (DataSUS V2008). `src/data/cid10.json` is loaded at startup; `getCID10Client()` is a singleton over it. All search/lookup happens in-process. CI verifies the bundle's source-level `toolRegistry.register` count (currently 37: 27 prior + 3 ATC + 4 CID-10 + 1 validate_codes (13.2) + 2 versioning tools (13.6)).
- `LOG_LEVEL` env var controls pino verbosity (default `info`).

## Architecture

### Two entry points, shared core
There are two bundle entries: `src/index.ts` (Node — stdio + Node `http` server when `--http` is passed) and `src/worker.ts` (Cloudflare Workers — `WebStandardStreamableHTTPServerTransport` against the web-standard `Request`/`Response`). Both import every tool module purely for its side effects, just like a single-entry setup would — and `tree-shaking=false` is set in both esbuild invocations so the bundler doesn't drop the "unused" tool imports and leave the registry empty at runtime.

The shared core lives in `src/server-core.ts`: `createServer`, `toolRegistry`, `SERVER_INFO`, `ToolHandler`. The Node entry adds stdio + Node-`http` transports in `src/server.ts` (which re-exports the core for callers' convenience). The Workers entry talks to the SDK's `WebStandardStreamableHTTPServerTransport` directly — never importing `src/server.ts`, since that would drag in `node:http` and `@hono/node-server` (the SDK's Node wrapper) which don't exist in the Workers runtime.

When adding a new `src/tools/*.ts`, `src/prompts/*.ts`, or `src/resources/*.ts`, wire it into BOTH entry points — `src/index.ts` AND `src/worker.ts`. The meta-test in `src/index.test.ts` enforces the Node side for all three dirs; the Workers side is on you.

### Three registries: tools, prompts, resources
`src/server-core.ts` defines three singleton registries (`toolRegistry`, `promptRegistry`, `resourceRegistry`), each holding parallel maps of definitions and handlers. Server `capabilities` declares all three: `{ tools: {}, prompts: {}, resources: {} }`.

**Tools** (`src/tools/*.ts`) — every external API surface (31 default + 6 SNOMED):
1. Defines `Tool` objects whose `inputSchema` / `outputSchema` are produced by `buildInputSchema()` / `buildOutputSchema()` from `src/utils/zod-schema.ts` (Zod → JSON Schema via `zod-to-json-schema`, with `$schema` stripped and refs inlined). Tools also set `annotations: READ_ONLY_TOOL_ANNOTATIONS` (read-only, idempotent, open-world, non-destructive).
2. Defines async handler functions that validate args with Zod schemas from `src/types/index.ts`, call a client, and return `CallToolResult` — typically with both a human-readable `content` text *and* a `structuredContent` object matching the `outputSchema`.
3. Calls `toolRegistry.register(...)` at module load time for each tool.

**Prompts** (`src/prompts/index.ts`) — orchestration templates the client renders as named user actions (3 today: `find-medical-code`, `drug-info`, `cid10-portuguese-lookup`). Each Prompt declares `name`, `description`, `arguments[]`. Handler returns `GetPromptResult` with a `messages[]` array — the prompt body is a plain-text user message that *suggests* tool calls but doesn't constrain the LLM. Lives in a single file because three prompts don't justify per-domain splitting yet; revisit if the file grows past ~300 lines.

**Resources** (`src/resources/index.ts`) — static or in-process reference content addressable by URI (3 today: `info://server`, `info://cid10/chapters`, `info://licenses`). The `info://` scheme is a self-contained namespace; URIs don't dereference over HTTP. Content is built once at module-load time from server metadata / the bundled CID-10 dataset / a hard-coded markdown block, so `resources/read` is sub-millisecond.

Adding a new tool/prompt/resource: define + register at the bottom of its file, and (if a brand-new file) `import './<dir>/newfile.js'` in BOTH `src/index.ts` AND `src/worker.ts`. The meta-test in `src/index.test.ts` covers all three directories (`tools/`, `prompts/`, `resources/`) and fails if the new file isn't wired into `src/index.ts` — that's the cheap defense against silent missing-from-list bugs. The Workers side has no equivalent meta-test yet; remembering to wire it is on you.

Tool/prompt/resource files and clients all import from `../server-core.js` (not `../server.js`) — importing from `server.js` pulls `node:http` into the Workers bundle and breaks the build.

### Error handling — `handleToolError`
Tool handlers wrap their body in `try { ... } catch (e) { return handleToolError(e); }` (`src/utils/zod-schema.ts`). It maps `ZodError` → validation-error result, `ApiError` → API-error result, and re-throws everything else so `server.ts`'s dispatcher logs and wraps it. For axios failures inside clients, `extractErrorMessage()` (`src/utils/extract-error-message.ts`) handles the production response shapes that the previous one-liner collapsed to "undefined" — including the OAuth `error_description` that the WHO token endpoint returns on 401/400.

### Bundled datasets (CID-10 + ICD-10 → ICD-11)
Two clients ship without HTTP — they load their data from `src/data/*.json` at startup and serve queries from memory.

- **`src/clients/cid10-client.ts`** — loads `src/data/cid10.json` (DataSUS V2008, ~1.9 MB tabular header+rows shape). Frozen since 2008; `scripts/build-cid10-dataset.mjs` regenerates the JSON from the DataSUS CSV release on demand — only relevant if a new V20XX ever ships.
- **`src/clients/icd10-icd11-map-client.ts`** — loads `src/data/icd10-to-icd11.json` (WHO transition tables, release 2025-01, ~5.4 MB raw / 0.95 MB gzipped). 11,243 ICD-10 category entries; 1,461 have WHO-documented alternatives beyond the primary 1:1. `scripts/build-icd10-to-icd11-dataset.mjs` regenerates the JSON from the WHO mapping.zip release; run when WHO publishes a new annual release.

Both datasets are checked into git deliberately — the Workers bundle inlines them, and the compressed size still leaves the worker.js well within Cloudflare's 3 MB-free / 10 MB-paid script limit.

### Layered client architecture
Every external API has a dedicated client in `src/clients/` that composes three cross-cutting utilities from `src/utils/` in a fixed order:

```
rateLimiters.<api>.acquire()  →  withRetry(() => httpClient.request(...))  →  cache.set(...)
```

The clients are accessed via lazy singletons (`getWHOClient()`, `getNLMClient()`, etc.) so a missing env var only blows up when that specific terminology is actually called.

- **`utils/cache.ts`** — `Map` + lazy-TTL implementation (used to wrap `node-cache`; that dep was removed in 1.2.0 because its CJS `require('events')` doesn't bundle for Cloudflare Workers). Use `cache.getOrSet(prefix, key, factory, ttl)` with `CACHE_PREFIX.*` and `DEFAULT_TTL.*` constants (`STATIC` 24h, `LOOKUP` 1h, `SEARCH` 10min, `TOKEN` 50min). Lazy expiration: stale entries linger until next access. Stage 2 of Phase 11.9 swaps this for a Workers KV cache for cross-isolate sharing.
- **`utils/rate-limiter.ts`** — Token bucket. Pre-configured limiters in `rateLimiters`: `who` (5/s), `nlm` (10/s, shared across LOINC + MeSH), `rxnorm` (20/s), `snomed` (10/s). Always `await rateLimiters.<api>.acquire()` before HTTP requests. On Workers this is per-isolate (NOT global) — under sustained traffic Stage 2 of Phase 11.9 moves rate limiting into a Durable Object so quotas are honored across isolates.
- **`utils/retry.ts`** — `withRetry()` with exponential backoff + 25% jitter. Retries on `[408, 429, 500, 502, 503, 504]` and network errors (`ECONNRESET`/`ECONNREFUSED`/`ETIMEDOUT`/`ENOTFOUND`/`socket hang up`).
- **`utils/env.ts`** — Cross-runtime env var access. Use `getEnv('KEY')` instead of `process.env.KEY` in clients. On Node it falls through to `process.env`; on Workers it reads from `globalThis.__MCP_ENV` (which `src/worker.ts` populates from the fetch handler's `env` parameter on first request). The workaround exists because Cloudflare's `nodejs_compat` polyfill bridges vars to `process.env` but was observed not bridging secrets reliably.

### Logging — runtime-aware destination
`src/utils/logger.ts` configures pino with a destination chosen by capability detection: if `pino.destination` is a function (Node), it writes to fd 2 (stderr) so stdout stays free for the MCP stdio transport; if it isn't (Cloudflare Workers, where the destination helper is stripped from the bundled pino), it uses a `console.log` shim that wrangler tail captures. **Never log to stdout on Node** — stdout is the MCP stdio transport. Use `createClientLogger('<api>')` and `createToolLogger('<tool>')` to get scoped child loggers. Pino runs with `sync: false`, so `logger.flush()` is called during graceful shutdown (`src/index.ts`) before `process.exit(0)`.

Capability detection was chosen over runtime detection (`process.versions.node`) because Cloudflare's `nodejs_compat` flag fakes `process.versions.node`; a runtime-style check returns true on Workers and then `pino.destination` throws at evaluation time.

### Per-tool `language` parameter
`snomed_search`, `snomed_concept`, `icd11_search`, `icd11_lookup`, `mesh_search`, and `mesh_descriptor` accept an optional `language` argument. The tool layer passes it to the corresponding client method; the client sets it as `Accept-Language` on that specific request (not on the axios instance default — that would leak between concurrent callers on Workers). SNOMED's `SNOMED_LANGUAGE` env var still provides the default when no per-call override is passed. **Cache keys include the resolved language** — without this, the in-memory cache would let a prior English-language request serve a follow-up request asking for Portuguese, which is the same class of bug that the cross-tenant hosted scenarios this parameter exists to support are exposed to. The MeSH client's fan-out (descriptor → tree numbers → concept → terms → qualifiers) threads `language` through every sub-resource fetch so the assembled response is internally consistent — `label` in `pt` with `qualifiers` in `en` would be confusing.

### WHO OAuth specifics
`who-client.ts` does the OAuth2 client_credentials dance against `icdaccessmanagement.who.int/connect/token` and caches the bearer token under `CACHE_PREFIX.TOKEN`. TTL is computed from the API's `expires_in` field as `max(60, expires_in - 60)` seconds — honors what the server actually returns instead of a hardcoded value. The release ID (default `'2024-01'`, overridable via `WHO_ICD11_RELEASE_ID`) and linearization (`mms`) are pinned constants in `WHO_CONFIG` — bump deliberately. Note: `lookup` by URI strips the leading `/icd` from the path before passing to axios (the baseURL already includes it); same with `getEntity`. Don't undo that.

### MeSH client fan-out
The NLM MeSH `/{id}.json` endpoint returns compact JSON-LD with no `@graph` wrapper — flat top-level fields (`label`, `treeNumber` URI(s), `preferredConcept` URI, `allowableQualifier` URI[s], `annotation`). To assemble a full descriptor, `mesh-client.ts` fans out: descriptor + each tree number + the preferred concept + each term URI on that concept + each qualifier URI, all fetched in parallel under the shared NLM rate limiter and cached separately (descriptor at `LOOKUP` TTL, sub-resources at `STATIC` TTL since they rarely change). `getDescriptor`/`getTreeNumbers`/`getAllowedQualifiers` share the same cached descriptor fetch — calling all three on one MeSH ID in sequence triggers exactly one descriptor HTTP. The "scope note" surfaced to tool consumers comes from the *preferred concept's* `scopeNote`, not the descriptor's `annotation` (which is an indexer note).

### Crosswalk caveat
`src/tools/crosswalk.ts` has one authoritative mapping (`map_icd10_to_icd11` — Phase 13.1, shipped 2026-05-11) plus two guidance-only handlers. `map_icd10_to_icd11` consults the bundled WHO transition tables via `ICD10ToICD11MapClient` (`src/clients/icd10-icd11-map-client.ts`) and returns the primary ICD-11 code + chapter + Foundation/Linearization URIs plus any WHO-documented alternatives; it returns `null` (not a fuzzy fallback) when the code isn't in the WHO category table. `map_loinc_to_snomed` returns guidance only (UMLS/LOINC-SNOMED license required for the actual relationships), and `map_snomed_to_icd10` returns guidance only (gated behind `ENABLE_SNOMED_TOOLS=true`; real refset 447562003 planned in Phase 13.7). When adding a new crosswalk handler today, match the existing convention: if you have an authoritative table, bundle it like `icd10-to-icd11.json` and return structured mapping; if you don't, rewrite the description honestly and return explanatory text rather than throwing.

### Known upstream-degraded behavior
`/loinc_answers` at `clinicaltables.nlm.nih.gov` returns HTTP 404 in production (verified 2026-05-09). The client catches and returns `[]`, so `loinc_answers` reports "no answers available" for every input. Pinned in a contract test so it doesn't change without notice. Real fix is tracked as PROGRESS.md Phase 14.1 — likely uses `loinc_form_definitions` for form-type LOINCs.

### Testing layers

Three layers, all under `src/`:

- **Unit tests** (`src/utils/*.test.ts`, `src/types/schemas.test.ts`, `src/index.test.ts`, `src/clients/cid10-client.test.ts`, `src/server.http.test.ts`, `src/prompts/index.test.ts`, `src/resources/index.test.ts`) — pure-logic coverage of utils, Zod input/output validators, the CID-10 in-memory client, the Node-HTTP transport (4 contract tests covering /health, CORS preflight, initialize→tools/list, and 404 routing), prompt registration + handler output shapes, and resource registration + handler output shapes. The meta-test in `src/index.test.ts` asserts every `src/{tools,prompts,resources}/*.ts` is imported by `src/index.ts` (cheap defense against forgetting the side-effect import for any of the three registries; only the Node entry is covered, not `src/worker.ts`).
- **Contract tests** (`src/clients/*.contract.test.ts`) — use `nock` (^14, devDep) to intercept axios calls, replaying captured live fixtures from `src/__fixtures__/<api>/`. Pin parser behavior against the actual upstream response shapes. WHO and SNOMED tests use inline mocks because their public hosts don't ship test creds. When adding a new HTTP client method, capture a live fixture and write a contract test pinning the parser.
- **Integration tests** (`src/integration/*.integration.test.ts`) — hit live APIs. Gated by `INTEGRATION_TESTS=1`; otherwise the `describe` blocks become `describe.skip`. WHO + SNOMED sub-suites skip cleanly when their creds/flags are absent. CI runs them daily on cron — production regressions surface close to when they happen.

Total: 313 unit + contract tests, 11 integration tests (skipped by default).

When adding a tool with an `outputSchema`, add a fixture to `src/types/schemas.test.ts` exercising the typical-result shape *and* one edge case (empty list, all-nullable-fields populated/missing, etc.). Pattern: `<Schema>OutputSchema.safeParse({...}).success` should be `true` for well-formed shapes and `false` when a required field is missing. CONTRIBUTING.md codifies this as a PR-gate expectation.

## Conventions worth knowing

- All tool handlers return `CallToolResult` with `content: [{ type: 'text', text: ... }]` for human/LLM display, plus `structuredContent` matching the `outputSchema` whenever the result is structured. Errors flow through `handleToolError` (sets `isError: true`); only unexpected errors propagate.
- Zod schemas in `src/types/index.ts` are the single source of truth — both runtime validation and the `Tool.inputSchema` / `Tool.outputSchema` JSON Schemas are derived from them. There is no hand-maintained JSON Schema to keep in sync.
- `src/server-core.ts` reads `SERVER_INFO.version` from `package.json` (`resolveJsonModule: true`) — bump the version in `package.json` only.
- TypeScript strict mode is the linter. There is no ESLint, no Prettier, no Biome. `tsconfig.json` enables `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, etc. — match surrounding formatting in the file you're editing; don't introduce a formatter.
- Commits use Conventional Commits prefixes — `feat:` / `fix:` / `refactor:` / `docs:` / `test:` / `chore:` / `perf:`. The body explains *why*, not *what* (the diff already shows the what). If a commit addresses a `PROGRESS.md` item, reference it in the body so future readers can map commit → context.

## Cloudflare Workers deployment

The hosted endpoint at `https://medical-terminologies-mcp.sidneybissoli.workers.dev` is built from `src/worker.ts` and deployed by `.github/workflows/deploy-worker.yml` on every push to `main` that touches worker-relevant paths. Configuration lives in `wrangler.toml`:

- `compatibility_date = 2025-12-01`, `compatibility_flags = ["nodejs_compat"]` — enough to run the bundled axios/pino/Map-cache code without further polyfills.
- Stateless mode (`sessionIdGenerator: undefined`) — every request is independent, no session storage.
- Endpoints: `POST /mcp` (JSON-RPC), `GET /health` (liveness), `OPTIONS` preflight. Permissive CORS.

Required GitHub secrets for the deploy workflow: `CLOUDFLARE_API_TOKEN` (Account API token with Workers Scripts: Edit) and `CLOUDFLARE_ACCOUNT_ID`. Per-server runtime secrets (WHO_CLIENT_ID, WHO_CLIENT_SECRET, optional SNOMED_*) are set on the Cloudflare side via `npx wrangler secret put` or the dashboard — they're never in GitHub.

### Workers-specific gotchas to remember

- **`process.versions.node` is a lie under `nodejs_compat`**. Capability-detect APIs instead of runtime-detect (e.g. logger.ts checks `typeof pino.destination === 'function'`).
- **`process.env` polyfill bridges vars but not secrets reliably**. `src/worker.ts` stashes Worker bindings on `globalThis.__MCP_ENV` and `src/utils/env.ts`'s `getEnv()` reads from there first. Use `getEnv('KEY')` instead of `process.env.KEY` in any code that runs on both targets.
- **Bare-string Node imports break the Workers build**. The `build:worker` script aliases `events`/`http`/`buffer`/etc. to their `node:` namespaced equivalents and externals `node:*` so they resolve to the runtime polyfill rather than getting bundled.
- **Tool / client files import `../server-core.js`, NOT `../server.js`**. The latter pulls `node:http` and breaks the Workers bundle.
- **The Cloudflare dashboard doesn't trim secret names**. A trailing/leading whitespace in a secret name silently binds it under the wrong key. If a secret looks correctly set but reads as undefined, suspect whitespace before re-running every other diagnostic.

### Where to put a new dependency

- Pure JS, browser-safe → just `npm install`; both bundles pick it up.
- Uses Node built-ins via `import 'fs'` (bare) → won't bundle for Workers without aliasing. Add the alias to `build:worker` in `package.json`.
- CJS that does `require('events')` or similar dynamic requires → won't work on Workers at all. Replace with an ESM equivalent, or fork the read-side logic. (We hit this with `node-cache` and replaced its 100-line surface with a Map+TTL implementation in `cache.ts`.)
- Stateful, per-process (`node-cache`, in-memory rate limiter) → works on Node, becomes per-isolate on Workers. Acceptable for moderate traffic; PROGRESS.md Phase 11.9 Stage 2 swaps these for Workers KV + Durable Objects when traffic justifies.

## CI gates

`.github/workflows/ci.yml` runs on every PR and gates merge on three checks:

1. `npm run typecheck` clean.
2. `npm test` passes (unit + contract; integration is skipped here).
3. A source-level `toolRegistry.register` call-site count check (currently 37). Removing or adding tools requires updating that count in CI alongside the code change.

`.github/workflows/integration.yml` runs the live-API integration suite on a daily cron (separate from PR gates) — that's how upstream API drift surfaces.

## Forward-looking work

`PROGRESS.md` is the implementation diary and current source of truth for what's shipped vs. planned:

- Phases 0-10 ✅ complete (the work that built the original 28-tool surface).
- Phase 11 🔄 in progress (Distribution & Discovery — npm + Cloudflare Workers shipped; further directory submissions ongoing).
- Phase 12 🔄 in progress (Content & Outreach — 12.1 long-form post published on Medium + Dev.to 2026-05-11; remaining channels drafted).
- Phase 13 🔄 in progress (Coverage Expansion — 13.1 authoritative ICD-10→ICD-11 mapping, 13.2 `validate_codes`, and 13.6 `terminology_versions` / `terminology_diff` all shipped, bringing the surface to 31 default + 6 SNOMED-gated = **37 tools**; 13.7 SNOMED→ICD-10 real refset 447562003 still planned).
- Phase 14 📋 ongoing (Quality & Maintenance — e.g. the `loinc_answers` upstream-404 fix).

Each phase has sub-tasks, requirements checklists, dependencies, and effort estimates. When picking up work, check `PROGRESS.md` first — it captures rationale and triggers, not just task lists.

`outreach-templates.md` holds copy-paste-ready drafts for Phase 12 (post drafts, email templates, submission text). `outreach-templates.html` is the rendered version. Tool counts and version numbers there are kept in sync with the current state, but verify before publishing.

`CONTRIBUTING.md` has the PR checklist that complements the architectural notes here: typecheck-clean → tests-pass → build-succeeds → tool-count gate, plus the fixture-pinning convention for new HTTP client methods (capture into `src/__fixtures__/<api>/`, pin parser with a `nock`-backed contract test).

`CHANGELOG.md` is consumer-facing release notes (Keep-a-Changelog format).
