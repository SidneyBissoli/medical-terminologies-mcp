# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build           # esbuild bundle: src/index.ts -> dist/index.js (Node, ESM, node20)
npm run build:worker-lib # esbuild bundle: src/worker-lib.ts -> dist/worker-lib.js (the Worker's view of the package)
npm run build:all       # both bundles
npm start               # node dist/index.js (runs the MCP server over stdio)
npm run dev             # build + start (stdio)
npm test                # vitest run (skips integration tests by default)
npm run test:watch      # vitest in watch mode
npm run typecheck       # tsc --noEmit (strict; not invoked by `npm run build`)

node scripts/smoke-mcp.mjs           # smoke against the hosted Worker (initialize/tools/list/calls)
node scripts/smoke-mcp.mjs --stdio   # same smoke over local STDIO (requires npm run build)
```

The Cloudflare Worker (`worker/`, not published to npm) is an instance of the
portfolio's Fase 0 hosting template (`mcp-br-commons/templates/cloudflare-worker`)
and has its own scripts, run from inside `worker/` (each first rebuilds
`dist/worker-lib.js` at the root):

```bash
cd worker && npm run dev        # wrangler dev — local HTTP transport on :8787
cd worker && npm run deploy     # wrangler deploy
cd worker && npm run typecheck  # tsc --noEmit
cd worker && npm test           # vitest — auth, rate limit, usage, status, surface
```

The Worker intentionally does **not** list `@modelcontextprotocol/server` or `zod`
in its own deps — they resolve from the parent package's `node_modules` so there is
a single SDK copy (avoids duplicate-instance type clashes with `registerAll`).
`worker/.npmrc` pins `legacy-peer-deps=true` so npm does not install a second copy
to satisfy the `agents` package's hard peer ranges.

Run a single test: `npx vitest run src/utils/cache.test.ts` (or `-t '<name pattern>'` for a single case).

The package is published to npm with `"bin": { "medical-terminologies-mcp": "dist/index.js" }`, so consumers can launch the stdio server via `npx medical-terminologies-mcp` without cloning. `prepublishOnly` runs `npm run build` automatically before `npm publish` so the bundle is fresh in every release.

Run integration tests against live APIs: `INTEGRATION_TESTS=1 npm test`. They live in `src/integration/` and skip by default. WHO and SNOMED integration tests skip cleanly when their respective creds/flags (`WHO_CLIENT_ID`/`WHO_CLIENT_SECRET`, `ENABLE_SNOMED_TOOLS`/`SNOMED_BASE_URL`) are absent. The daily cron CI workflow at `.github/workflows/integration.yml` runs them and surfaces upstream API drift close to when it happens.

The build is two `esbuild` invocations sharing the same source tree. The Node build (`dist/index.js`) targets `node20` and externalizes ALL npm dependencies (`--packages=external` — they resolve from runtime `node_modules` via the `dependencies` field), so the published bundle contains only project code plus the inlined JSON datasets. Externalizing is deliberate: consumers npm-install the deps anyway, and it keeps the published artifact auditable — supply chain scanners (e.g. Socket.dev) attribute each dependency's capabilities (pino's fs/env access, etc.) to that package instead of to this one. The worker-lib build (`dist/worker-lib.js`, from `src/worker-lib.ts`) targets `es2022`/`workerd` conditions, aliases bare Node imports to their `node:` namespaced equivalents, and inlines all app code + datasets — but keeps `@modelcontextprotocol/*` and `zod` EXTERNAL so the Worker, the `agents` package and this lib share the single SDK copy in the parent `node_modules`. Both builds use `tree-shaking=false` — see "Tool registration" below.

Both entry points import `package.json` directly (`resolveJsonModule: true`) so `SERVER_INFO.version` stays in sync with `package.json` — bump the version there only.

To exercise the stdio server interactively: `npx @modelcontextprotocol/inspector node dist/index.js`. To exercise the Worker locally: `cd worker && npm run dev` then `npx @modelcontextprotocol/inspector --transport streamable-http --server-url http://localhost:8787/mcp`.

## Runtime requirements

- Node.js >= 20 (ESM, top-level imports with side effects).
- `WHO_CLIENT_ID` / `WHO_CLIENT_SECRET` are required only for the 5 ICD-11 tools (OAuth2 client credentials). The server will still start without them; ICD-11 tool calls throw `AUTH_CONFIG_ERROR` at first use. LOINC, RxNorm, MeSH have no auth.
- **SNOMED is feature-flagged off by default.** `src/utils/feature-flags.ts` gates the SNOMED tools and the SNOMED branch of crosswalk behind `ENABLE_SNOMED_TOOLS=true`. The historical public IHTSDO Snowstorm endpoint (`browser.ihtsdotools.org/snowstorm/snomed-ct`) was retired and now returns HTTP 410, so operators must also set `SNOMED_BASE_URL` to a working self-hosted Snowstorm. Optional `SNOMED_LANGUAGE` is passed through as the `Accept-Language` header.
- **ATC** is served via NLM RxClass (`rxnav.nlm.nih.gov`), same host as RxNorm proper. The `RxNormClient` exposes `getATCByDrugName` / `getATCByCode` / `getATCMembers` that share the rxnorm rate limiter, retry, and cache. Note: `byId` only resolves ATC1-4 codes (1-5 chars); substance-level codes (7 chars) come back via `byDrugName` only — this is upstream behavior, surfaced in tool descriptions.
- **CID-10 has no API auth or rate limiting** — it's served from a bundled JSON dataset (DataSUS V2008). `src/data/cid10.json` is loaded at startup; `getCID10Client()` is a singleton over it. All search/lookup happens in-process. CI verifies the bundle's source-level `toolRegistry.register` count (currently 39: 27 prior + 3 ATC + 4 CID-10 + 1 validate_codes (13.2) + 2 versioning tools (13.6) + 2 Deep Research (1.10.0)).
- `LOG_LEVEL` env var controls pino verbosity (default `info`).

## Architecture

### Two entry points, one registration module (SDK v2)
Since the SDK v2 migration (v1.6.0) there are two entry points but a SINGLE registration module. `src/index.ts` is a thin stdio wrapper: it passes a `createServer` factory to the SDK's `serveStdio` (which serves both the modern and the 2025-era protocol openings). The Cloudflare Worker (`worker/`, Fase 0 template instance) serves the same surface over Streamable HTTP via `createMcpHandler` from `agents`, building a fresh `McpServer` per request from the same factory. The 1.x-era `--http` mode of the Node entry was removed — HTTP is the Worker's job (`cd worker && npm run dev` locally).

`src/register.ts` is the single place that (a) imports every tool/prompt/resource module for its side effects and (b) exports `registerAll(server, record?)` + `createServer()`, which project the module-level registries onto a `McpServer` via `registerTool`/`registerPrompt`/`registerResource`. The advertised JSON Schemas are the exact `buildInputSchema`/`buildOutputSchema` objects passed through the SDK's `fromJsonSchema` with a **permissive validator** — SDK-level validation is deliberately OFF so handlers keep validating with Zod and returning pedagogical `isError` results (1.x behavior). Do not "fix" this by handing the SDK the Zod schemas: the SDK's own JSON emitter would change the advertised wire schemas.

**SDK v2 hard rule:** any tool that declares `outputSchema` MUST return `structuredContent` on every non-error result — the SDK rejects the result otherwise, before any validator runs (this cannot be disabled). Error results (`isError: true`) are exempt.

The optional `record` hook (`ToolUsageRecorder`) receives `tool_call`/`tool_error` events per tool — the Worker feeds it into its `UsageTracker` Durable Object, stdio passes nothing. Independently, `recordInvocation` (the legacy StatsCounter path) fires inside the shared `handle` wrapper after every resolved dispatch.

When adding a new `src/tools/*.ts`, `src/prompts/*.ts`, or `src/resources/*.ts`, wire it into `src/register.ts` — the ONLY place with the side-effect import list. The meta-test in `src/index.test.ts` enforces this for all three dirs; both transports get the new module automatically.

### Three registries: tools, prompts, resources
`src/server-core.ts` defines three singleton registries (`toolRegistry`, `promptRegistry`, `resourceRegistry`), each holding parallel maps of definitions and handlers. Server `capabilities` declares all three: `{ tools: {}, prompts: {}, resources: {} }`.

**Tools** (`src/tools/*.ts`) — every external API surface (33 default + 6 SNOMED):
1. Defines `Tool` objects whose `inputSchema` / `outputSchema` are produced by `buildInputSchema()` / `buildOutputSchema()` from `src/utils/zod-schema.ts` (Zod → JSON Schema via `zod-to-json-schema`, with `$schema` stripped and refs inlined). Tools also set `annotations: READ_ONLY_TOOL_ANNOTATIONS` (read-only, idempotent, open-world, non-destructive).
2. Defines async handler functions that validate args with Zod schemas from `src/types/index.ts`, call a client, and return `CallToolResult` — typically with both a human-readable `content` text *and* a `structuredContent` object matching the `outputSchema`.
3. Calls `toolRegistry.register(...)` at module load time for each tool.

**Prompts** (`src/prompts/index.ts`) — orchestration templates the client renders as named user actions (3 today: `find-medical-code`, `drug-info`, `cid10-portuguese-lookup`). Each Prompt declares `name`, `description`, `arguments[]`. Handler returns `GetPromptResult` with a `messages[]` array — the prompt body is a plain-text user message that *suggests* tool calls but doesn't constrain the LLM. Lives in a single file because three prompts don't justify per-domain splitting yet; revisit if the file grows past ~300 lines.

**Resources** (`src/resources/*.ts`) — static or in-process reference content addressable by URI (4 today: `info://server`, `info://cid10/chapters`, `info://licenses` from `index.ts`; `info://stats` from `stats.ts`). The `info://` scheme is a self-contained namespace; URIs don't dereference over HTTP. The first three are built once at module-load time from server metadata / the bundled CID-10 dataset / a hard-coded markdown block, so `resources/read` is sub-millisecond. The fourth (`info://stats`) round-trips to the `StatsCounter` Durable Object on the Worker path (or returns a "stats unavailable on this transport" placeholder on stdio, since local installs have no shared counter by design).

**`search`/`fetch` (ChatGPT Deep Research contract, since 1.10.0)** — the ONLY tools without a terminology prefix (names fixed by OpenAI). Contract, envelope (JSON of the object in `content[0].text` + `structuredContent`), descriptions and the ranking index come from `@sbissoli/mcp-search` (portfolio package, `locale: "en"`); `src/tools/deep-research.ts` is the adapter: the corpus (bundled CID-10 + terminology versions in a module-level index built on first use; live fan-out to ICD-11/LOINC/RxNorm/MeSH per `search`, like `find_equivalent`; SNOMED out — no public page to cite) and the document renderer (`fetch` calls the terminology's real lookup handler via `toolRegistry.getHandler` and reuses its Markdown and provenance). Registration goes THROUGH `toolRegistry` — the factory is pointed at a capturing sink and the two entries become definition/handler pairs with the same JSON Schema builders and Zod-in-handler validation as every other tool — so the `handle` wrapper and every registry-derived gate cover them with no special case. The one deliberate exception: their text channel is the contract JSON, not Markdown + footer (`provenance-wiring.test.ts` and the smoke allowlist the pair by `DEEP_RESEARCH_TOOLS`). `url` is always the canonical public page (WHO ICD browsers, loinc.org, RxNav, MeSH Browser), never an API URL.

Adding a new tool/prompt/resource: define + register at the bottom of its file, and (if a brand-new file) `import './<dir>/newfile.js'` in `src/register.ts` — the single registration module both transports share. The meta-test in `src/index.test.ts` covers all three directories (`tools/`, `prompts/`, `resources/`) and fails if the new file isn't wired into `src/register.ts` — that's the cheap defense against silent missing-from-list bugs.

Tool/prompt/resource files and clients all import from `../server-core.js` (not `../server.js`) — importing from `server.js` pulls `node:http` into the Workers bundle and breaks the build.

### Provenance (portfolio contract v1.0, since v1.8.0)
Every successful tool response carries a provenance block in three channels: `structuredContent.provenance` (+ `attribution`), a `_meta` mirror under `com.sidneybissoli.medical/*`, and a text footer appended to the Markdown. `src/provenance.ts` is the adapter over `@sbissoli/mcp-provenance` (English/UTC/concise; never reshape the emitted block by hand — the package owns the canonical model and determinism). The source registry `MEDICAL_SOURCES` holds one preset per upstream with license/citation taken verbatim from the fase medical terms verification (`medical/docs/01`); handlers call `medicalProvenance(<SOURCE_KEY>, opts?)` and return via `provenancedResult({ text, structured, provenance })` on EVERY success path — `src/provenance-wiring.test.ts` (33 default) and `src/provenance-wiring-snomed.test.ts` (6 gated, env-gated dynamic import) are the release gates. Multi-source tools (`find_equivalent`, `validate_codes`) pass an ARRAY of blocks (one per source that answered; a source that errored gets no block); their schemas use `withProvenanceMulti`, single-source tools `withProvenance` — both wrap the base output schema at the Tool definition, so `src/types/index.ts` fixtures stay on the base shapes. Server-computed values (find_equivalent ranking, terminology_diff summary) set `derived: { note }`.

`retrieved_at` must be the REAL upstream extraction instant. Because the CLIENTS own the cache keys here (unlike ibge-br-mcp), the metadata flows out-of-band: `src/utils/fetch-meta.ts` is an AsyncLocalStorage collector opened per dispatch by the `handle` wrapper in `register.ts`; the cache records every data access (`CacheEntry.storedAt`, hits report the ORIGINAL fetch instant) and `medicalProvenance` aggregates per source cache prefix (oldest instant; `served_from_cache` true only if everything was a hit; the `token` prefix never reaches a block). Direct callers can use `cache.getOrSetWithMeta`. AsyncLocalStorage works on Workers under `nodejs_compat` (already enabled).

LOINC License §10 compliance lives in the LOINC path: `nlm-client` requests `EXTERNAL_COPYRIGHT_NOTICE` and the tools pass it through verbatim (`external_copyright_notice`); NOTICE.md + the README license section + `info://licenses` are the consolidated notice — keep the three in sync when license facts change.

### Evals (tool-selection)
`src/evals/` holds the `@sbissoli/mcp-evals` adoption: `catalog.ts` extracts the live catalog by running the real `registerAll` (with `registerTool` interposed to drop the `StandardSchemaWithJSON` shapes the extractor can't digest; the real advertised JSON Schemas are re-attached from `toolRegistry`), `fixtures/queries.ts` has 42 queries tagged by terminology cluster (en + pt-BR subset), and `fixtures.test.ts` validates everything offline inside `npm test`. The live run (`npx tsx src/evals/run.ts`, results in `evals/results/`) calls the Anthropic Messages API and **bills usage — never run or suggest it unless the user explicitly asks**. The 2026-08-09 round scored 100% top-1 (42/42) — tool names are settled; don't rename without new eval evidence.

### Error handling — `handleToolError`
Tool handlers wrap their body in `try { ... } catch (e) { return handleToolError(e); }` (`src/utils/zod-schema.ts`). It maps `ZodError` → validation-error result, `ApiError` → API-error result, and re-throws everything else so `server.ts`'s dispatcher logs and wraps it. For HTTP failures inside clients, `extractErrorMessage()` (`src/utils/extract-error-message.ts`) reads the `HttpError.data` body and handles the production response shapes that a naive one-liner collapses to "undefined" — including the OAuth `error_description` that the WHO token endpoint returns on 401/400.

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
- **`utils/http.ts`** — `HttpClient` over native `fetch` (no third-party HTTP stack; works identically on Node >= 18 undici and Workers). baseURL joining, query params, per-request header overrides, timeout via `AbortSignal.timeout`. Non-2xx responses and network failures both throw `HttpError`: `status` set means an HTTP error with the parsed body in `data`; `status` undefined means the request never completed (DNS/refused/timeout — always retryable). Body parsing mirrors axios's leniency: try `JSON.parse`, fall back to the raw string.
- **`utils/retry.ts`** — `withRetry()` with exponential backoff + 25% jitter. Retries on `[408, 429, 500, 502, 503, 504]` (via `HttpError.status`), on `HttpError` without status, and on network-error message patterns (`ECONNRESET`/`ECONNREFUSED`/`ETIMEDOUT`/`ENOTFOUND`/`socket hang up`).
- **`utils/env.ts`** — Cross-runtime env var access. Use `getEnv('KEY')` instead of `process.env.KEY` in clients. On Node it falls through to `process.env`; on Workers it reads from `globalThis.__MCP_ENV` (which the Worker populates from the fetch handler's `env` parameter — `worker/src/env-bridge.ts`). The workaround exists because Cloudflare's `nodejs_compat` polyfill bridges vars to `process.env` but was observed not bridging secrets reliably.

### Logging — runtime-aware destination
`src/utils/logger.ts` configures pino with a destination chosen by capability detection: if `pino.destination` is a function (Node), it writes to fd 2 (stderr) so stdout stays free for the MCP stdio transport; if it isn't (Cloudflare Workers, where the destination helper is stripped from the bundled pino), it uses a `console.log` shim that wrangler tail captures. **Never log to stdout on Node** — stdout is the MCP stdio transport. Use `createClientLogger('<api>')` and `createToolLogger('<tool>')` to get scoped child loggers. Pino runs with `sync: false`, so `logger.flush()` is called during graceful shutdown (`src/index.ts`) before `process.exit(0)`.

Capability detection was chosen over runtime detection (`process.versions.node`) because Cloudflare's `nodejs_compat` flag fakes `process.versions.node`; a runtime-style check returns true on Workers and then `pino.destination` throws at evaluation time.

### Per-tool `language` parameter
`snomed_search`, `snomed_concept`, `icd11_search`, `icd11_lookup`, `mesh_search`, and `mesh_descriptor` accept an optional `language` argument. The tool layer passes it to the corresponding client method; the client sets it as `Accept-Language` on that specific request (not on the shared `HttpClient` default headers — that would leak between concurrent callers on Workers). SNOMED's `SNOMED_LANGUAGE` env var still provides the default when no per-call override is passed. **Cache keys include the resolved language** — without this, the in-memory cache would let a prior English-language request serve a follow-up request asking for Portuguese, which is the same class of bug that the cross-tenant hosted scenarios this parameter exists to support are exposed to. The MeSH client's fan-out (descriptor → tree numbers → concept → terms → qualifiers) threads `language` through every sub-resource fetch so the assembled response is internally consistent — `label` in `pt` with `qualifiers` in `en` would be confusing.

### WHO OAuth specifics
`who-client.ts` does the OAuth2 client_credentials dance against `icdaccessmanagement.who.int/connect/token` and caches the bearer token under `CACHE_PREFIX.TOKEN`. TTL is computed from the API's `expires_in` field as `max(60, expires_in - 60)` seconds — honors what the server actually returns instead of a hardcoded value. The release ID (default `WHO_ICD11_DEFAULT_RELEASE` = `'2026-01'`, the single copy — `provenance.ts` and `tools/versioning.ts` import it; overridable via `WHO_ICD11_RELEASE_ID`) and linearization (`mms`) are pinned in `WHO_CONFIG` — bump deliberately. Note: `lookup` by URI strips the leading `/icd` from the path before building the request (the client baseURL already includes it); same with `getEntity`. Don't undo that.

### MeSH client fan-out
The NLM MeSH `/{id}.json` endpoint returns compact JSON-LD with no `@graph` wrapper — flat top-level fields (`label`, `treeNumber` URI(s), `preferredConcept` URI, `allowableQualifier` URI[s], `annotation`). To assemble a full descriptor, `mesh-client.ts` fans out: descriptor + each tree number + the preferred concept + each term URI on that concept + each qualifier URI, all fetched in parallel under the shared NLM rate limiter and cached separately (descriptor at `LOOKUP` TTL, sub-resources at `STATIC` TTL since they rarely change). `getDescriptor`/`getTreeNumbers`/`getAllowedQualifiers` share the same cached descriptor fetch — calling all three on one MeSH ID in sequence triggers exactly one descriptor HTTP. The "scope note" surfaced to tool consumers comes from the *preferred concept's* `scopeNote`, not the descriptor's `annotation` (which is an indexer note).

### Crosswalk caveat
`src/tools/crosswalk.ts` registers **five** tools: three `map_*` mappings, `validate_codes`, and `find_equivalent`. Of the mappings, one is authoritative (`map_icd10_to_icd11` — Phase 13.1, shipped 2026-05-11) and two are guidance-only. `map_icd10_to_icd11` consults the bundled WHO transition tables via `ICD10ToICD11MapClient` (`src/clients/icd10-icd11-map-client.ts`) and returns the primary ICD-11 code + chapter + Foundation/Linearization URIs plus any WHO-documented alternatives; it returns `null` (not a fuzzy fallback) when the code isn't in the WHO category table. `map_loinc_to_snomed` returns guidance only (UMLS/LOINC-SNOMED license required for the actual relationships), and `map_snomed_to_icd10` returns guidance only (gated behind `ENABLE_SNOMED_TOOLS=true` — it's the 6th SNOMED tool, registered inside the `if (SNOMED_TOOLS_ENABLED)` block at the bottom of the file; real refset 447562003 planned in Phase 13.7). `find_equivalent` is a live fan-out, not a static mapping: it searches the same term across ICD-11, SNOMED CT, LOINC, RxNorm, and MeSH (constrained by optional `target_terminologies` / `source_terminology` args, where source is subtracted from targets) and returns whatever each terminology's search surfaces — it stays registered regardless of the SNOMED flag. When adding a new crosswalk handler today, match the existing convention: if you have an authoritative table, bundle it like `icd10-to-icd11.json` and return structured mapping; if you don't, rewrite the description honestly and return explanatory text rather than throwing.

### Known upstream-degraded behavior
`/loinc_answers` at `clinicaltables.nlm.nih.gov` returns HTTP 404 in production (verified 2026-05-09). The client catches and returns `[]`, so `loinc_answers` reports "no answers available" for every input. Pinned in a contract test so it doesn't change without notice. Real fix is tracked as PROGRESS.md Phase 14.1 — likely uses `loinc_form_definitions` for form-type LOINCs.

### Testing layers

Three layers, all under `src/`:

- **Unit tests** (`src/utils/*.test.ts`, `src/types/schemas.test.ts`, `src/index.test.ts`, `src/register.test.ts`, `src/clients/cid10-client.test.ts`, `src/prompts/index.test.ts`, `src/resources/index.test.ts`) — pure-logic coverage of utils, Zod input/output validators, the CID-10 in-memory client, prompt registration + handler output shapes, and resource registration + handler output shapes. `src/register.test.ts` drives the real `createServer()` over the SDK's in-memory transport with the v2 `Client` and pins registry↔wire fidelity (schemas advertised verbatim, annotations, prompt-argument round-trip, dispatch with structuredContent, pedagogical Zod errors). The meta-test in `src/index.test.ts` asserts every `src/{tools,prompts,resources}/*.ts` is imported by `src/register.ts`. The Worker has its own vitest suite in `worker/tests/` (auth, rate limit, usage aggregation, status, surface + usage-hook instrumentation).
- **Contract tests** (`src/clients/*.contract.test.ts`) — use `nock` (^14, devDep, patches `globalThis.fetch`) to intercept the clients' native-fetch calls, replaying captured live fixtures from `src/__fixtures__/<api>/`. Pin parser behavior against the actual upstream response shapes. WHO and SNOMED tests use inline mocks because their public hosts don't ship test creds. When adding a new HTTP client method, capture a live fixture and write a contract test pinning the parser.
- **Output-contract tests** (`src/output-contract.test.ts` + `src/output-contract-snomed.test.ts`) — call EVERY tool with `fetch` mocked and validate the resulting `structuredContent` against the `outputSchema` the tool advertises, using the SDK's own `CfWorkerJsonSchemaValidator`. See the rule below for why nothing else catches this. The cases deliberately cover the paths that produce absence (source omits a field, empty response, optional argument absent) — the happy path passes even with a dishonest schema. **When you add a field to a response, add a case here.**
- **Integration tests** (`src/integration/*.integration.test.ts`) — hit live APIs. Gated by `INTEGRATION_TESTS=1`; otherwise the `describe` blocks become `describe.skip`. WHO + SNOMED sub-suites skip cleanly when their creds/flags are absent. CI runs them daily on cron — production regressions surface close to when they happen.

Total: 488 unit + contract tests, 11 integration tests (skipped by default).

**A field that can be absent must be honest in the `outputSchema`** — `.nullable()` when the handler returns `null`, `.optional()` when it returns `undefined`. This server's SDK-level validation is permissive ON PURPOSE (`register.ts`), so nothing catches a dishonest schema at runtime; the MCP spec still requires conformance and a client that validates (the Inspector validates) rejects the ENTIRE response. Two things keep this honest today and both matter: handlers annotate their payload with the Zod-inferred type (`const structured: XOutput = {...}`), so `tsc` catches a `null` in a non-nullable field, and `src/output-contract.test.ts` catches what the type system can't — a field left `undefined` still type-checks but vanishes from the wire JSON, which reads as a missing required property on the client. Verified clean across all 37 tools on 2026-08-11; the sibling `bcb-br-mcp` shipped nine such violations before its gate existed.

When adding a tool with an `outputSchema`, add a fixture to `src/types/schemas.test.ts` exercising the typical-result shape *and* one edge case (empty list, all-nullable-fields populated/missing, etc.). Pattern: `<Schema>OutputSchema.safeParse({...}).success` should be `true` for well-formed shapes and `false` when a required field is missing. CONTRIBUTING.md codifies this as a PR-gate expectation.

## Conventions worth knowing

- All tool handlers return `CallToolResult` with `content: [{ type: 'text', text: ... }]` for human/LLM display, plus `structuredContent` matching the `outputSchema` whenever the result is structured. Errors flow through `handleToolError` (sets `isError: true`); only unexpected errors propagate.
- Zod schemas in `src/types/index.ts` are the single source of truth — both runtime validation and the `Tool.inputSchema` / `Tool.outputSchema` JSON Schemas are derived from them. There is no hand-maintained JSON Schema to keep in sync.
- `src/server-core.ts` reads `SERVER_INFO.version` from `package.json` (`resolveJsonModule: true`) — bump the version in `package.json` only.
- TypeScript strict mode is the linter. There is no ESLint, no Prettier, no Biome. `tsconfig.json` enables `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, etc. — match surrounding formatting in the file you're editing; don't introduce a formatter.
- Commits use Conventional Commits prefixes — `feat:` / `fix:` / `refactor:` / `docs:` / `test:` / `chore:` / `perf:`. The body explains *why*, not *what* (the diff already shows the what). If a commit addresses a `PROGRESS.md` item, reference it in the body so future readers can map commit → context.

## Cloudflare Workers deployment

The hosted endpoint at `https://medical.sidneybissoli.com` (custom domain mapped to the Worker; the legacy `medical-terminologies-mcp.sidneybissoli.workers.dev` hostname stays enabled as a fallback) is the Worker in `worker/` (instance of the portfolio's Fase 0 hosting template), deployed by `.github/workflows/deploy-worker.yml` on every push to `main` that touches worker-relevant paths (root build of `dist/worker-lib.js` first, then `wrangler deploy` from `worker/`). Configuration lives in `worker/wrangler.jsonc`:

- `compatibility_date = 2026-08-07`, `compatibility_flags = ["nodejs_compat"]` — enough to run the bundled pino/Map-cache code without further polyfills; HTTP uses the Workers-native `fetch`.
- Stateless `createMcpHandler` (from `agents`) — a fresh `McpServer` per request from the shared `buildServer` factory; Host validation via `allowedHostnames` (custom domain + workers.dev + localhost).
- Endpoints: `POST /mcp` (JSON-RPC), `GET /` (landing), `GET /health` (liveness JSON with tool_count), `GET /status` (version + deploy metadata), `GET /metrics` (UsageTracker aggregates), `GET /stats` + `GET /stats/badge` (legacy StatsCounter, preserved verbatim), `/.well-known/mcp/server-card.json`, `/.well-known/glama.json`. Optional Bearer auth (`API_KEY` secret) and per-IP token-bucket rate limit guard the MCP route.

Required GitHub secrets for the deploy workflow: `CLOUDFLARE_API_TOKEN` (Account API token with Workers Scripts: Edit) and `CLOUDFLARE_ACCOUNT_ID`. Per-server runtime secrets (WHO_CLIENT_ID, WHO_CLIENT_SECRET, optional SNOMED_*) are set on the Cloudflare side via `npx wrangler secret put` or the dashboard — they're never in GitHub.

### Durable Objects in use

Two DOs since the Fase 0 retrofit (both singleton-by-name, `idFromName('global')`):

- `StatsCounter` (`src/durable-objects/stats-counter.ts`, bound as `STATS`) — the LEGACY public counter behind `/stats`, `/stats/badge` and `info://stats`, counting since 2026-05-13. Its storage is preserved by keeping the same worker name + class_name (migration v1); never rename or drop it. The `handle` wrapper in `src/register.ts` calls `recordInvocation(toolName)` after every resolved dispatch — abstracted via `src/utils/stats.ts` so the same call is a no-op on stdio and a DO fetch on Workers. IMPORTANT: the DO stub is resolved per call (`worker/src/stats-legacy.ts`) — caching a stub across requests throws "Cannot perform I/O on behalf of a different request" under compatibility dates ≥ 2026.
- `UsageTracker` (`worker/src/usage.ts`, bound as `USAGE`, migration v2) — the Fase 0 template's per-tool/per-day aggregates behind `GET /metrics`, fed by the `record` hook of `registerAll`. Born zeroed at the retrofit; the StatsCounter history is the long-run series.

The fire-and-forget pattern: `recordInvocation` queues the DO RPC and bridges it through `globalThis.__MCP_WAIT_UNTIL` (set per request to `ctx.waitUntil`) so the isolate stays alive long enough to flush after the user's response is sent. Latency-neutral to callers. Increment failures are swallowed by the recorder — a broken counter must never break the user's tool response.

When Phase 11.9 Stage 2 lands (Workers KV cache + DO rate limiter), the same DO infrastructure pattern applies — adding a DO class to `worker/wrangler.jsonc`'s migrations and exporting it from `worker/src/index.ts`.

### Workers-specific gotchas to remember

- **`process.versions.node` is a lie under `nodejs_compat`**. Capability-detect APIs instead of runtime-detect (e.g. logger.ts checks `typeof pino.destination === 'function'`).
- **`process.env` polyfill bridges vars but not secrets reliably**. `worker/src/env-bridge.ts` stashes Worker bindings on `globalThis.__MCP_ENV` and `src/utils/env.ts`'s `getEnv()` reads from there first. Use `getEnv('KEY')` instead of `process.env.KEY` in any code that runs on both targets.
- **Bare-string Node imports break the Workers build**. The `build:worker` script aliases `events`/`http`/`buffer`/etc. to their `node:` namespaced equivalents and externals `node:*` so they resolve to the runtime polyfill rather than getting bundled.
- **Tool / client files import `../server-core.js`, NOT `../server.js`**. The latter pulls `node:http` and breaks the Workers bundle.
- **The Cloudflare dashboard doesn't trim secret names**. A trailing/leading whitespace in a secret name silently binds it under the wrong key. If a secret looks correctly set but reads as undefined, suspect whitespace before re-running every other diagnostic.

### Where to put a new dependency

- Pure JS, browser-safe → just `npm install`; both bundles pick it up.
- Uses Node built-ins via `import 'fs'` (bare) → won't bundle for Workers without aliasing. Add the alias to `build:worker` in `package.json`.
- CJS that does `require('events')` or similar dynamic requires → won't work on Workers at all. Replace with an ESM equivalent, or fork the read-side logic. (We hit this with `node-cache` and replaced its 100-line surface with a Map+TTL implementation in `cache.ts`.)
- Stateful, per-process (`node-cache`, in-memory rate limiter) → works on Node, becomes per-isolate on Workers. Acceptable for moderate traffic; PROGRESS.md Phase 11.9 Stage 2 swaps these for Workers KV + Durable Objects when traffic justifies.

## Baselines de superfície

`baselines/` guarda dumps normalizados de `tools/list` + resources + prompts
(`node scripts/dump-surface.mjs --stdio | --url <endpoint>`), prática
transplantada do bcb-br-mcp. Na captura inicial (01/09/2026, v1.9.1) stdio e
produção saíram byte-idênticos — o worker reutiliza o `registerAll` de
`dist/worker-lib.js`, então a única deriva possível é de deploy. O baseline é
capturado com SNOMED OFF (33 tools, o default de produção). Depois de mudança
que possa mexer na superfície: `npm run build && node scripts/dump-surface.mjs
--stdio` e diff contra o baseline vigente; toda diferença precisa ser
deliberada e listada no CHANGELOG. Ver `baselines/README.md`.

## CI gates

`.github/workflows/ci.yml` runs on every PR and gates merge on two jobs:

1. `check` (Node 20 + 22): `npm run typecheck` clean; `npm test` passes (unit + contract; integration is skipped here); a source-level `toolRegistry.register` call-site count check on the bundle (currently 39) — removing or adding tools requires updating that count in CI alongside the code change.
2. `worker`: root install + `build:worker-lib`, then `worker/` install, typecheck and vitest suite.

`.github/workflows/integration.yml` runs the live-API integration suite on a daily cron (separate from PR gates) — that's how upstream API drift surfaces.

## Release flow

Releases ship to two registries: **npm** (`medical-terminologies-mcp`) and the **MCP Registry** (`io.github.SidneyBissoli/medical-terminologies-mcp`). Driven by `.github/workflows/publish.yml`, which has two trigger paths:

1. **`workflow_dispatch`** (UI / `gh workflow run publish.yml -f version=1.x.y`) — bumps `package.json` via `npm version --no-git-tag-version`, publishes to npm, then creates the matching GitHub release at the end. This is the path the maintainer uses for normal releases.
2. **`release.created`** (`gh release create vX.Y.Z`) — publishes whatever version is already in `package.json`. Use only if a release was cut manually and the publish step needs to be re-run independently.

Job order: `build` (bundle + tool-count smoke check) → `publish` (npm with `--provenance`) → `publish-registry` (mcp-publisher via GitHub OIDC) → `create-release` (only on `workflow_dispatch`).

### Authentication

- **npm**: `secrets.NPM_TOKEN` (classic automation token). OIDC trusted-publisher is the modern path but is gated on the maintainer's npm 2FA enrollment — until that's resolved, stay on the token.
- **MCP Registry**: GitHub OIDC (no secret). `mcp-publisher login github-oidc` exchanges the workflow's OIDC token for a registry JWT scoped to `io.github.SidneyBissoli/*`. This is why the workflow requests `id-token: write` on the `publish-registry` job.

### Things that bite

- **`prepublishOnly` runs `npm run build`** — never publish from a dirty `dist/` and never bypass with `--ignore-scripts`. The npm-published artifact is `dist/` only (`files: ["dist"]` in `package.json`), so a stale bundle silently ships old code.
- **`server.json` version must match `package.json`** at publish time. The workflow re-writes `server.json` from `package.json` in the `publish-registry` job for exactly this reason; manual local publishes via `mcp-publisher publish` need the same sync done by hand.
- **npm index lag**: the MCP Registry validates that the npm package exists at the declared version before accepting the manifest. The workflow polls `npm view ...@VERSION` up to 10× / 100s. If the wait step times out, npm publish succeeded and you just need to re-run the `publish-registry` job (or run `mcp-publisher publish` locally) — don't bump the version again.
- **Registry publish does not gate npm publish.** If `publish-registry` fails after `publish` succeeded, npm is at the new version. Don't roll back npm; fix the registry job and re-run it.
- **`mcp-publisher` is fetched as `latest` deliberately** — pinning a version has triggered "invalid audience" failures when the registry rotates its OIDC audience claim.

### Local-only fallback

If CI is broken and a release is time-sensitive, the manual path is: `npm version X.Y.Z` → `git push --follow-tags` → `npm publish --access public` (uses your local `~/.npmrc` token; no provenance attestation, since that requires the OIDC environment of GitHub Actions). Skip `mcp-publisher` until CI is restored, then re-run the registry job — **do not** expect to fix it later by republishing the same version. A published version is IMMUTABLE in the MCP Registry: `mcp-publisher publish` on a version already there fails with `400 invalid version: cannot publish duplicate version` (measured 2026-08-29 against `bcb-br-mcp@1.9.3` while adding an `icons` field). Corrected metadata — icon, title, description, websiteUrl — only ever reaches the registry through a NEW version, so a manifest fix costs a release.

## Forward-looking work

Phase status, sub-task triggers, and effort estimates live in `PROGRESS.md` — check there before picking up work; it captures rationale and triggers, not just task lists. Outreach copy in `outreach-templates.md` (`.html` is the rendered version). PR checklist in `CONTRIBUTING.md` (typecheck → tests → build → tool-count gate, plus the fixture-pinning convention for new HTTP client methods). Consumer-facing release notes in `CHANGELOG.md` (Keep-a-Changelog).

Dataset regeneration scripts live only in `scripts/`: `build-cid10-dataset.mjs` rebuilds `src/data/cid10.json` from the DataSUS CSV release; `build-icd10-to-icd11-dataset.mjs` rebuilds `src/data/icd10-to-icd11.json` from the WHO mapping zip. Run on demand when upstream publishes a new release.
