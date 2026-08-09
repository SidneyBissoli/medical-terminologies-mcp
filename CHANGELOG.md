# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.7.0] - 2026-08-09

Usability release: ranked unified search, human display names, and server
instructions. All structured-output changes are additive — existing fields
keep their names and shapes.

### Added

- **`find_equivalent` is now a ranked unified search.** Every candidate
  carries `match_score` (lexical similarity to the search term, 0–1) and
  `rank` (one global position across all searched terminologies), computed
  server-side — the upstreams don't expose comparable relevance scores.
  Candidates from different terminologies whose titles are lexically
  identical are clustered in a new `groups` array (conservative: exact
  normalized-title equality only). A new `ranking` object self-describes the
  method, and a new `limit` parameter (1–10, default 5) caps candidates per
  terminology. Items within each terminology now come back ordered by rank
  (best first) instead of upstream order.
- **Human display names (`title`) on all 37 tools** — English throughout,
  Portuguese for the natively Brazilian `cid10_*` tools. Clients that render
  tool lists can now show "Map ICD-10 to ICD-11" instead of
  `map_icd10_to_icd11`. A test gate keeps every tool titled.
- **Server `instructions` on the MCP handshake** (both stdio and the hosted
  Worker): routing map across the seven terminologies, when to use
  `find_equivalent` vs. a dedicated search, where official Portuguese
  content lives, and the honest caveats (guidance-only crosswalks, gated
  SNOMED, retrieval-not-CDS).

### Changed

- **Official pt-BR is now discoverable**: the `language` parameter
  description and the `icd11_search`/`icd11_lookup`/`mesh_search`/
  `mesh_descriptor`/`snomed_search`/`snomed_concept` tool descriptions now
  say explicitly that `language: "pt"` returns the source's official
  Portuguese where it exists (never machine translation), and the README
  gained an "Official Portuguese (pt-BR) content" section.

## [1.6.0] - 2026-08-09

Foundation release: MCP SDK v2 on both transports and the hosted Worker
rebuilt on the maintainer's Fase 0 hosting template. The MCP surface is
untouched — `tools/list`, `prompts/list` and `resources/list` are
byte-identical to 1.5.7 in both modes (31 default / 37 with
`ENABLE_SNOMED_TOOLS`), verified by normalized dumps.

### Changed

- **Migrated from `@modelcontextprotocol/sdk` 1.x to `@modelcontextprotocol/server` 2.0**
  (stdio via `serveStdio`; hosted HTTP via `createMcpHandler`). The new
  `src/register.ts` projects the existing tool/prompt/resource registries onto
  a `McpServer`; the advertised JSON Schemas are passed through verbatim
  (`fromJsonSchema` + permissive validator), so input validation stays in the
  handlers (Zod) and invalid arguments keep returning friendly `isError`
  results instead of protocol errors.
- **Hosted Worker rebuilt on the Fase 0 template** (`worker/`): per-IP rate
  limiting, optional Bearer auth, landing page, `GET /status` (version +
  deploy metadata), `GET /metrics` (new per-tool/per-day usage aggregates,
  UsageTracker Durable Object), MCP server card at
  `/.well-known/mcp/server-card.json`. Same endpoint
  (`https://medical.sidneybissoli.com/mcp`), same worker, additive migration.
- The public `/stats` counter (and `/stats/badge`) is preserved verbatim on
  the original StatsCounter Durable Object — history since 2026-05-13 intact.

### Fixed

- `icd11_postcoordination` now returns `structuredContent` on the
  "no postcoordination info" path (SDK v2 requires structured content on
  every non-error result of a tool that declares an `outputSchema`).

### Removed

- **The `--http` mode of the Node entry point** (and the `Dockerfile` that
  used it). HTTP is the hosted Worker's job; for a local HTTP endpoint run
  `cd worker && npm run dev` (wrangler dev on :8787). The stdio transport —
  what Claude Desktop, IDE clients and `npx medical-terminologies-mcp` use —
  is unchanged.

## [1.5.7] - 2026-06-20

Dependency refresh. Consolidates four Dependabot PRs into one tested
release; no change to tool behavior, the public API, or the emitted
JSON Schema contract.

### Changed

- **Bumped `zod` 3 → 4** (runtime) and dev tooling: `typescript` 5 → 6,
  `@types/node` 20 → 25, `esbuild` → 0.28.1, `vitest` → 4.1.9.
- **Migrated JSON Schema generation to zod 4's native `z.toJSONSchema`.**
  `zod-to-json-schema@3` is built against zod 3's internals and silently
  emits invalid schemas under zod 4, so tool `inputSchema`/`outputSchema`
  now use the native generator (`target: 'draft-07'`, `reused: 'inline'`,
  and the `io: 'input'`/`'output'` projections that match each helper's
  purpose). Same draft-07 shapes as before — pinned by the existing schema
  fixture tests — and the direct `zod-to-json-schema` dependency is dropped
  (still present transitively via the MCP SDK).

## [1.5.6] - 2026-06-20

### Changed

- Re-publish so the sharpened registry `description` introduced for 1.5.5
  actually reaches the MCP Registry. The 1.5.5 publish job built from the
  commit immediately before the description edit, so the registry kept the
  old text. No code or package changes versus 1.5.5.

## [1.5.5] - 2026-06-20

Discovery tuning.

### Changed

- **Sharpened the registry `description`** to lead with plain-language value
  ("Diagnoses, drugs & lab codes: …") before the terminology acronyms, so
  non-expert searches match and the listing ranks better in Smithery search
  and the Toolbox's semantic discovery. All 7 terminology names are retained
  (highest-value keywords); within the registry's 100-char limit. No code or
  API changes.

## [1.5.4] - 2026-06-20

Endpoint move. The hosted server is now reachable at a neutral, rename-proof
custom domain, matching the `<name>.sidneybissoli.com/mcp` convention used
across the maintainer's MCP servers (Phase 15.4).

### Changed

- **Canonical hosted endpoint is now `https://medical.sidneybissoli.com/mcp`.**
  A Cloudflare Workers custom domain mapped to the same Worker. The legacy
  `medical-terminologies-mcp.sidneybissoli.workers.dev` hostname stays enabled
  as a fallback (`workers_dev = true` in `wrangler.toml`), so existing clients
  keep working with no interruption. `server.json`'s `remotes[]`, the README
  hosted-endpoint section + tool-calls badge, `SECURITY.md`, `CLAUDE.md`, and
  the runtime `info://server` / `info://stats` resources now reference the
  custom domain. The npm package name is unchanged.

## [1.5.3] - 2026-06-11

Production incident fix. On 2026-06-10 the hosted Cloudflare Workers
endpoint logged ~227k errors against ~228k requests in 24 hours (99.6%
error rate). Root cause: `GET /mcp` — the Streamable HTTP
server-initiated SSE stream — reached the SDK transport, which returned
a silent, never-closing SSE response. Because this deployment is
stateless with a per-request transport, nothing could ever write to
that stream; the Workers runtime canceled each request as hung
("would never generate a response") and counted it as an error, while
MCP clients (observed: Claude Code) sat in 1 req/s SSE reconnect
loops. POST requests (the actual JSON-RPC traffic) were unaffected
throughout.

### Fixed

- **`GET`/`HEAD` on `/mcp` now returns `405 Method Not Allowed`**
  (with an `Allow: POST, DELETE, OPTIONS` header and a JSON-RPC error
  body) on both entrypoints — the Cloudflare Worker (`src/worker.ts`)
  and the Node Streamable HTTP server (`src/server.ts`). The MCP
  Streamable HTTP spec requires exactly this from servers that do not
  offer a server-initiated SSE stream, and a 405 tells well-behaved
  clients to stop retrying. On Node the same bug leaked one silently
  open connection per `GET`. Regression tests pin the behavior in
  `src/worker.test.ts` and `src/server.http.test.ts`.

### Added

- **CODE_OF_CONDUCT.md** (Contributor Covenant 2.1) and **SECURITY.md**
  (private vulnerability reporting via GitHub Security Advisories) —
  completes the GitHub community-standards checklist that registry
  scanners (Snyk, Socket.dev, OpenSSF) score repositories against.
- **.github/FUNDING.yml** pointing at the maintainer's GitHub Sponsors
  profile — enables the repo Sponsor button and the "Funding" signal
  those same scanners check.

## [1.5.2] - 2026-06-10

Supply-chain hardening release. No tool surface or API changes — the
work is in the dependency tree and the published artifact: axios is
gone (native `fetch` everywhere), and the npm bundle no longer inlines
its dependencies. Production dependency tree shrinks from 119 to ~100
packages.

### Changed

- **Migrated all HTTP clients from axios to native `fetch`** — a new
  ~150-line `HttpClient` wrapper (`src/utils/http.ts`) over the `fetch`
  built into Node >= 20 and Cloudflare Workers replaces axios across the
  WHO, NLM/LOINC, RxNorm, SNOMED and MeSH clients. Removes axios and its
  ~15-package transitive tree from `dependencies` (including
  `follow-redirects` and `form-data`, both with recurring CVE history)
  — the only remaining runtime deps are the MCP SDK, pino, zod and
  zod-to-json-schema. Behavior is unchanged: same retry/backoff
  semantics (network failures and timeouts remain retryable), same
  error-body extraction shapes, same per-request `Accept-Language`
  handling. Contract tests keep using nock, which intercepts native
  fetch since v14.

- **npm bundle no longer inlines dependencies** — the Node build now uses
  esbuild's `--packages=external`, so `dist/index.js` contains only
  project code plus the bundled CID-10 / ICD-10→ICD-11 datasets
  (8.6 MB → 7.5 MB). axios, pino, zod, zod-to-json-schema and the MCP
  SDK resolve from `node_modules` at runtime, exactly as the SDK already
  did. No install-flow change for consumers (the deps were always in
  `dependencies`); the published artifact is now auditable source-shaped
  code, and supply chain scanners attribute each dependency's
  capabilities (network, fs, env access) to that dependency instead of
  to this package. The obsolete `createRequire` banner shim was removed
  along with the last bundled CJS code. The Cloudflare Workers build is
  unchanged — it still inlines everything, as the Workers runtime has no
  `node_modules`.

## [1.5.1] - 2026-06-09

Documentation and discovery-metadata patch. No runtime or API changes —
`dist/` is functionally identical to 1.5.0. Released to refresh the npm
package page and re-publish the MCP Registry manifest.

### Changed

- **README** — added a CodeGuilds discovery badge alongside the existing
  LobeHub and Glama badges. `npx`/npm remains the canonical install path.
- **CLAUDE.md** — documented all five tools registered in
  `src/tools/crosswalk.ts` (the `map_*` handlers plus `validate_codes`
  and `find_equivalent`), and clarified that `map_snomed_to_icd10` is the
  6th SNOMED-gated tool.

## [1.5.0] - 2026-05-13

Adds a public per-tool invocation counter to the hosted Cloudflare
Workers endpoint, surfaced via an HTTP route, an MCP Resource, and
a README badge. Minor bump because the new `info://stats` resource
expands the MCP surface; the change is otherwise additive and
backward-compatible (no breaking changes).

### Added

- **StatsCounter Durable Object** (`src/durable-objects/stats-counter.ts`)
  — single named instance ("global"), persistent counter aggregating
  per-tool invocation counts across all isolates. Survives cold
  starts that an in-memory counter wouldn't. Bound as `STATS` in
  `wrangler.toml` with a v1 migration declaring it as a new
  sqlite-backed class.
- **Cross-runtime stats recorder abstraction** (`src/utils/stats.ts`)
  — abstract `StatsRecorder` interface; default is a Noop used on
  stdio (local installs have no shared counter, by design); Worker
  entry swaps in a DurableObject-backed recorder on first request.
  The dispatcher in `src/server-core.ts` calls `recordInvocation(name)`
  after every successful tool dispatch — fire-and-forget,
  latency-neutral via `ctx.waitUntil` bridged through
  `globalThis.__MCP_WAIT_UNTIL`.
- **`GET /stats`** — full JSON payload (total_invocations, by_tool,
  top_tool, since, as_of, scope). Cached 60s.
- **`GET /stats/badge`** — shields.io endpoint format for the README
  badge. Color tiers: grey (zero) / yellow (<100) / blue (<1000) /
  green (≥1000). Cached 5min.
- **`info://stats` MCP Resource** — same JSON exposed via the MCP
  protocol so Smithery / MCP Inspector / LobeHub can render it in
  listing cards without leaving the marketplace. Returns a "stats
  unavailable on this transport" placeholder on stdio. Resource
  count grows from 3 to 4.
- **README badge** — `tool calls` counter linked to `/stats`. Closes
  PROGRESS.md Phase 11.12.

### Internal

- 15 new tests (7 DO unit tests with Map-backed mock storage;
  5 for the recorder abstraction including the waitUntil bridge;
  3 for the info://stats resource). Total: 324 → 339.

## [1.4.2] - 2026-05-12

Closes the 5th and final axis of the Smithery quality-score rubric
by giving every default tool a real `outputSchema` + `structuredContent`
return path. No new or removed tools (still 31 default / 37 with
SNOMED); the change is purely additive — clients reading only the
existing `content` text continue working.

### Changed

- **All 37 default tools now expose `outputSchema` and return
  `structuredContent`.** The remaining 3 tools in
  `src/tools/crosswalk.ts` — `map_icd10_to_icd11`,
  `map_snomed_to_icd10`, `map_loinc_to_snomed` — gained output
  schemas in `src/types/index.ts`. `map_icd10_to_icd11` now returns
  the full WHO transition-table entry (source ICD-10 row, primary
  ICD-11 mapping, alternative ICD-11 candidates, release metadata)
  as structured data instead of discarding it as markdown — agents
  can consume the mapping without text parsing. The two
  guidance-only tools (`map_snomed_to_icd10`, `map_loinc_to_snomed`)
  return a structured envelope (`status`, `guidance`, authoritative
  sources list) alongside the existing markdown narrative. Closes
  PROGRESS.md Phase 14.6.

### Internal

- 11 new fixtures in `src/types/schemas.test.ts` covering the three
  new output schemas (typical paths + edge cases + one negative
  case each). Total tests: 313 → 324.

## [1.4.1] - 2026-05-12

Metadata-only release tuning the `server.json` surface for the Smithery
quality-score rubric. No code changes, no behavior changes, no new or
removed tools (still 31 default / 37 with SNOMED). Bundle hashes for
`dist/index.js` and `dist/worker.js` are unchanged modulo the embedded
version string.

### Changed

- **`server.json` enriched** — added `title` (`"Medical Terminologies
  MCP"`), `websiteUrl` (pointing at the canonical Medium walkthrough),
  and `icons[]` with dark + light 1024×1024 PNG variants hosted via
  `raw.githubusercontent.com`. Expanded `description` so it lists all
  seven terminologies (the prior copy stopped at MeSH) and mentions
  the authoritative WHO ICD-10→ICD-11 mapping plus the hosted endpoint.
- **Description synced across three files** — `package.json` and
  `SERVER_INFO` in `src/server-core.ts` now match `server.json`. The
  previous copies were missing ATC and CID-10 from the terminologies
  list — drift inherited from 1.0.x.
- **`server.json` `packages[1].version` realigned to `1.4.1`** — the
  streamable-http transport entry had been frozen at `1.2.1` (the
  release where the transport was added) and silently skipped by the
  release tooling since. Both `packages[]` entries now declare the
  current package version.

### Notes

- A 3-of-37 `outputSchema` gap remains in `src/tools/crosswalk.ts`
  (`map_icd10_to_icd11`, `map_snomed_to_icd10`, `map_loinc_to_snomed`).
  Closing it requires new Zod schemas and handler refactors to return
  `structuredContent`, scoped as PROGRESS.md Phase 14.6 and
  deliberately deferred from this metadata-only release.

## [1.4.0] - 2026-05-11

Data-integrity release. Bundles authoritative WHO ICD-10 → ICD-11
transition tables, adds a cross-terminology batch validator, ships
versioning + cross-revision diff tools, and surfaces a per-tool
`language` parameter on the SNOMED and MeSH tools. Tool count grows
from 28 default / 34 with SNOMED (in 1.3.0) to 31 default / 37 with
SNOMED. No breaking changes.

### Changed

- **`map_icd10_to_icd11` now returns an authoritative WHO mapping**
  instead of a text-search heuristic. Bundles the WHO ICD-10 → ICD-11
  transition tables (release 2025-01) as `src/data/icd10-to-icd11.json`
  (5.4 MB raw / 0.95 MB gzipped). 11,243 ICD-10 categories covered,
  including 1,461 with multiple WHO-documented ICD-11 candidates. Tool
  description rewritten to claim authoritativeness; returns null
  (not a fuzzy fallback) when the code isn't in the WHO category table.
  Closes PROGRESS.md Phase 13.1.

### Added

- **`terminology_versions` and `terminology_diff`** — two new MCP tools
  for pipeline maintainers. `terminology_versions` lists name, current
  version, release date, publisher, source URL, changelog URL, update
  cadence, and bundled flag for all 8 terminologies (filterable);
  ICD-10 → ICD-11 reads live from the bundled client, the rest is
  static metadata maintained alongside each release. `terminology_diff`
  is intentionally guidance-only for terminologies without bundled
  historical snapshots (points at the publisher's changelog and the
  update cadence), but surfaces a real cross-revision summary for
  `terminology=icd10`: 1:1 mappings vs splits vs avg alternatives,
  computed from the bundled WHO transition tables via a new
  `ICD10ToICD11MapClient.getStats()` method. Closes PROGRESS.md Phase
  13.6.
- **`validate_codes` cross-terminology batch validator** — new MCP
  tool that accepts up to 50 `{ code, terminology }` pairs and returns
  per-item `{ valid, active, title, replaced_by, source, error }`.
  Designed for retrospective analysis of legacy databases. Covers all
  8 supported terminologies; codes validated in parallel through
  their respective clients (rate limiters serialize within each
  bucket). `replaced_by` is populated today only for ICD-10 codes
  (via the bundled WHO transition tables); `active` carries a real
  boolean for SNOMED and LOINC, null elsewhere. Closes PROGRESS.md
  Phase 13.2.
- `scripts/build-icd10-to-icd11-dataset.mjs` regenerates the bundled
  WHO transition mapping JSON from the WHO `mapping.zip` release. Run
  on each new WHO annual release.
- `src/clients/icd10-icd11-map-client.ts` — in-memory singleton client
  mirroring the CID-10 pattern. Public surface: `lookup(code)`,
  `getVersion()`, `getReleaseDate()`, `getSourceUrl()`, `size()`. Input
  normalization handles dotted ("A07.8"), undotted ("A078"), and
  case-insensitive inputs.
- Per-tool `language` parameter on `snomed_search`, `snomed_concept`,
  `mesh_search`, and `mesh_descriptor` (`icd11_search` and
  `icd11_lookup` already had it). Propagated as the `Accept-Language`
  header on every upstream request. Useful for multi-tenant hosted
  scenarios where the operator isn't the end user — the per-tool
  override layers on top of the `SNOMED_LANGUAGE` env default rather
  than replacing it. Closes PROGRESS.md Phase 11.4.
- Cache keys for SNOMED and MeSH clients now include the resolved
  language so concurrent requests in different locales don't
  cross-contaminate.

## [1.3.0] - 2026-05-11

Adds **MCP Prompts and Resources** to the server's surface, satisfying
the LobeHub validator's outstanding "lists Prompts / lists Resources"
checks. No breaking changes; existing tools and clients are
unaffected.

### Added

- **Prompts** (`prompts/list`, `prompts/get`): three orchestration
  templates that compose existing tools into domain-typical workflows.
  - `find-medical-code` — parallel search across all six default
    terminologies for a clinical concept; honors a `language` hint
    (`pt-BR` prioritizes CID-10).
  - `drug-info` — sequenced RxNorm + ATC lookup compiling normalized
    name, ingredients, therapeutic classes, and WHO ATC code.
  - `cid10-portuguese-lookup` — Brazilian Portuguese ICD-10 lookup
    with chapter context; output formatted in Portuguese.
- **Resources** (`resources/list`, `resources/read`): three
  reference resources served from in-process state.
  - `info://server` — version, tool count, supported terminologies,
    SNOMED feature-flag state, hosted endpoint URL.
  - `info://cid10/chapters` — all 22 CID-10 chapters from the
    bundled DataSUS V2008 dataset.
  - `info://licenses` — per-terminology license disclaimers (ICD-11,
    LOINC, RxNorm, MeSH, ATC, CID-10, SNOMED CT) with the
    lookup-layer caveat.
- **LobeHub badge + Glama badge** on the README, pointing at the
  respective listings.

### Changed

- Server `capabilities` now declares `tools`, `prompts`, and
  `resources` (was tools only). Clients querying capabilities will
  observe the wider surface.
- Meta-test in `src/index.test.ts` generalized to enforce
  side-effect-import coverage for `src/tools/`, `src/prompts/`, and
  `src/resources/` — closing the silent-registration gap for all
  three registries.

## [1.2.1] - 2026-05-10

Maintenance release — no changes to the published package contents
versus 1.2.0. Republished to propagate an updated `server.json` to the
MCP Registry: the new `remotes[]` entry advertises the public
Cloudflare Workers endpoint at
`https://medical-terminologies-mcp.sidneybissoli.workers.dev/mcp`, so
Registry consumers (Glama, mcpservers.org, awesome-mcp-servers, etc.)
see the hosted instance alongside the npm package install paths.

### Changed

- `server.json`: added `remotes[]` with the Workers URL as a
  Streamable HTTP transport, alongside the existing `packages[]`
  entries (npm + stdio, npm + self-hosted streamable-http).

## [1.2.0] - 2026-05-10

Adds **Streamable HTTP transport** alongside the existing stdio transport.
This unblocks hosted-deployment targets (Cloudflare Workers, Smithery,
Docker, LobeHub) that expect HTTP endpoints rather than spawning a child
process. Stdio remains the default — Claude Desktop, IDE integrations,
and `npx`-installed clients continue to work unchanged.

### Added

- `--http` flag (or `MCP_HTTP=true`) boots the server on Streamable HTTP
  via `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk` in
  stateless mode. `--port N` (or `PORT`) defaults to `3000`; `--host H`
  (or `HOST`) defaults to `127.0.0.1` (containers should pass
  `--host 0.0.0.0`).
- Endpoints: `POST /mcp` for JSON-RPC, `GET /health` for liveness
  (returns `{ status, name, version, tool_count }`), CORS preflight on
  `OPTIONS *`. CORS is permissive by design so browser clients (the MCP
  Inspector web UI, hosted playgrounds) can connect directly.
- `server.json` now declares a second package entry with
  `transport: { type: "streamable-http" }` so MCP Registry consumers
  see both install paths.
- `src/server.http.test.ts` — 4 contract tests covering health probe,
  CORS preflight, JSON-RPC initialize → tools/list round-trip, and
  unknown-route 404.
- README "HTTP transport (hosted / shared deployments)" section with
  flag table, endpoint reference, and a curl + Inspector smoke test.

### Changed

- `src/index.ts` shutdown handler unified into a single `installShutdown`
  helper that races a close function against a 5s timeout — same shape
  for stdio and HTTP, so SIGINT/SIGTERM behavior is consistent across
  transports.

## [1.1.1] - 2026-05-10

Maintenance release — no changes to the published package contents
versus 1.1.0. Republished to validate the npm publish pipeline after
switching to a Bypass-2FA granular access token (the OIDC trusted-
publisher path was unreachable due to a 2FA enrollment gap).

## [1.1.0] - 2026-05-10

This release bundles three threads of work: (1) resolution of an external
P0/P1 audit (sharper schema validation, honest tool framing, OAuth TTL
fix, structured-output adoption); (2) two new terminologies — **ATC** and
**CID-10** — adding 7 tools; and (3) a contract + integration test suite
that surfaced and fixed three silent production regressions (MeSH JSON-LD
shape change, WHO lookup URI bug, `loinc_answers` upstream 404 pinned).

Tool count goes from 21 default / 27 with SNOMED → **28 default / 34 with
SNOMED**. Test count: 243 unit + contract across 13 files, plus 11
live-API integration tests gated by `INTEGRATION_TESTS=1` and run on a
daily cron.

The minor bump (vs. 1.0.2) is justified by the new tool surface and the
SNOMED-tools-off-by-default behavior change (technically breaking for
anyone relying on the historical public Snowstorm endpoint, which is now
upstream HTTP 410 Gone — see Behavior changes below).

### Added

- **Contract tests with `nock` + captured live fixtures** for the 5
  HTTP clients (MeSH, NLM/LOINC, RxNorm/ATC, WHO, SNOMED). 57 new
  tests across `src/clients/*.contract.test.ts`. Fixtures captured
  from the real APIs live in `src/__fixtures__/<api>/`. These pin
  the parsers to current upstream shapes and would have caught the
  MeSH JSON-LD regression that was silently shipping empty data.
- **Integration tests against live APIs** at
  `src/integration/live-apis.integration.test.ts`. Skipped by default;
  enabled with `INTEGRATION_TESTS=1`. Daily cron CI workflow at
  `.github/workflows/integration.yml` runs them and surfaces upstream
  drift close to when it happens. WHO and SNOMED tests skip cleanly
  when their respective creds / flags are absent.
- **ATC (Anatomical Therapeutic Chemical) terminology** via NLM RxClass:
  `atc_classify` (drug name → ATC codes), `atc_lookup` (ATC code at
  level 1-4 → name + level type), `atc_members` (ATC class → member
  drugs). The WHOCC distributes the official ATC base under a paid
  subscription, but RxClass envelopes the same code/name pairs free —
  reuses the existing rxnorm rate limiter, retry, and cache. Substance-
  level codes (7 chars, e.g., `A10BA02`) are surfaced via `atc_classify`
  since RxClass `byId` only exposes ATC1-4.
- **CID-10 (Brazilian translation of ICD-10, DataSUS V2008)** via
  bundled dataset: `cid10_search` (Portuguese text search, diacritic-
  insensitive), `cid10_lookup` (code → official Portuguese name),
  `cid10_chapters` (list 22 chapters), `cid10_chapter` (chapter detail
  with constituent groups). Dataset is frozen — DataSUS has not updated
  V2008 since 2008 — so it ships as `src/data/cid10.json` (~1.9 MB,
  tabular header+rows shape) bundled into `dist/index.js`. No HTTP
  calls; pure in-memory. `scripts/build-cid10-dataset.mjs` regenerates
  the JSON from the DataSUS CSV release on demand.
- Strict Zod input schemas (LOINC `^\d{1,5}-\d$`, SCTID `^\d+$`, MeSH ID
  `^D\d+$`, RxCUI `^\d+$`, ICD-11 lookup code-or-uri refine) now actually
  execute. Each tool's MCP `inputSchema` is derived from the Zod schema
  via `buildInputSchema`, eliminating the previous Zod/JSON-Schema
  duplication.
- `outputSchema` and `structuredContent` on 24 of 27 tools (all except the 3
  guidance-only `map_*` crosswalk tools). Clients that read `structuredContent`
  (MCP spec since 2024-11-05) now get typed objects alongside the markdown
  fallback. Output schemas live in `src/types/index.ts` as Zod and are
  derived to JSON Schema via `zod-to-json-schema`.
- `annotations` (`readOnlyHint`, `idempotentHint`, `openWorldHint`,
  `destructiveHint: false`) declared on every tool so MCP clients can skip
  confirmation prompts and LLMs can call them more freely.
- `WHO_ICD11_RELEASE_ID` env var to override the WHO ICD-11 release at
  startup (was hardcoded to `2024-01`; WHO publishes a new release roughly
  yearly).
- `SNOMED_LANGUAGE` env var to set the `Accept-Language` header for SNOMED
  responses (was hardcoded to `en`; Snowstorm honors localized terms via
  this header).
- Vitest test suite (128 tests across 6 files) covering utility modules
  (`cache`, `rate-limiter`, `retry`, `zod-schema`, `extract-error-message`)
  and Zod input/output schemas with table-driven fixtures.
- CI workflow (`.github/workflows/ci.yml`) running typecheck, tests, and
  build on `pull_request` and pushes to `main`, matrix on Node 20 and 22.
- Dependabot config (`.github/dependabot.yml`) for npm and github-actions
  dependencies, with minor/patch bumps grouped to reduce PR noise.
- `extractErrorMessage(error)` helper handling all common API error body
  shapes (`{message}`, `{error.message}`, `{error_description}`,
  string/HTML bodies with truncation), used by all 5 clients.
- MeSH descriptor parser now populates `MeSHConcept.terms` by resolving
  `meshv:term` references against `meshv:Term` entries in the same JSON-LD
  graph (no extra HTTP cost).
- `mesh_qualifiers` tool now returns populated qualifier labels via
  parallel lookups (rate-limit-bounded, 24h cached).

### Changed

- All `process.stderr.write` writes now route through pino. `LOG_LEVEL` now
  effectively silences routine startup info / retry warnings; previously
  those were unsuppressible.
- MeSH descriptor methods (`getDescriptor`, `getTreeNumbers`,
  `getAllowedQualifiers`) now share a single cached raw-JSON fetch under
  `mesh:raw:<id>`. Cold lookup of all three drops from 3 HTTP requests to 1.
- Graceful SIGINT/SIGTERM handlers now close the MCP transport (with a 5s
  timeout) and flush pino's async destination before exit. Previously
  `process.exit(0)` was called directly, cutting in-flight requests and
  potentially losing buffered logs.
- `getLOINCDetails` now requests up to 10 candidates from Clinical Tables
  instead of 1 before locating the exact-code match. Even with the search
  scoped to `sf=LOINC_NUM`, the API ranks by relevance and could outrank
  the exact code (especially for codes that are prefixes of others, e.g.
  `2-1`), causing `loinc_details` to return null for valid LOINC numbers.
- `find_equivalent`'s `source_terminology` parameter is now consumed as
  documented (excludes that terminology from the search). Was an orphan
  parameter declared in the schema but never read.
- `map_icd10_to_icd11` description and output rewritten in descriptive
  voice to make clear it performs text-similarity search of the ICD-11
  catalog, not authoritative mapping. The `map_loinc_to_snomed` tool got
  the same treatment. The `map_snomed_to_icd10` tool is now gated behind
  the SNOMED toggle (see Removed/Behavior change below).

### Fixed

- **MeSH client rewrite** for the new compact JSON-LD response shape.
  NLM stopped returning `@graph`-wrapped descriptors at some point
  before 2026-05-09; the old parser silently returned empty
  treeNumbers/concepts/qualifiers. The new fan-out architecture
  fetches the descriptor + preferred concept + each term + each
  qualifier as separate cached resources, in parallel under the
  shared rate limiter. `mesh_descriptor`, `mesh_tree`, and
  `mesh_qualifiers` tools now return populated data again.
- WHO `lookup` by URI no longer doubles the `/icd` prefix in the
  request path. The axios baseURL already includes `/icd`, but the
  URI parser was passing the full pathname (including its own
  `/icd`) through, producing `https://id.who.int/icd/icd/...` which
  404s. Matched the correct stripping that `getEntity` already used.
- WHO OAuth token cache TTL now honors the API's real `expires_in` minus
  60s margin (was hardcoded to 50 minutes; would have served stale tokens
  if WHO ever shortened the lifetime).
- Tool registration `version` field now reads from `package.json` at build
  time; previously hardcoded to `1.0.0` in `src/server.ts` and
  `src/clients/snomed-client.ts`'s User-Agent, drifting from
  `package.json` (which was at 1.0.2).
- Hierarchy and chapter fetches in the WHO client now run in parallel via
  `Promise.allSettled` (was sequential `for`-await; rate limiter already
  permitted 5 concurrent requests).
- `extractErrorMessage` replaces the old
  `error.response?.data?.message || error.message` pattern in all 5
  clients, which collapsed to "API error: undefined" on string/HTML
  bodies and OAuth-style errors.

### Removed

- Empty stale `logs.txt` (4 months unmodified, no code path wrote to it).
- `.mcpregistry_registry_token` is no longer tracked. The token lifetime
  was 5 minutes and had already expired by the time the original commit
  landed; rotation was therefore unnecessary, but the file is now
  gitignored via the broader `.mcpregistry_*_token` glob.

### Security

- Re-encoded `README.md` from UTF-16 LE to UTF-8 so the npmjs.com package
  page renders correctly. (Categorized here under "package presentation
  and trust" — the audit lists it as DX/distribution, but a broken README
  on the install page is a real adoption risk.)
- Pinned `@modelcontextprotocol/sdk` from `latest` to `^1.25.2`. Building
  with `latest` left the project exposed to silent breaking changes
  between SDK minors.

### Behavior changes worth calling out

- **SNOMED tools off by default.** `snomed_search`, `snomed_concept`,
  `snomed_hierarchy`, `snomed_descriptions`, `snomed_ecl`, and the
  `map_snomed_to_icd10` crosswalk tool are gated behind
  `ENABLE_SNOMED_TOOLS=true`. The historical default endpoint
  (`browser.ihtsdotools.org`) was retired and now returns HTTP 410 Gone;
  registering tools that always fail would have surfaced 6 broken tools
  to every install. Operators with an IHTSDO license and a self-hosted
  Snowstorm instance enable them via the env var (with `SNOMED_BASE_URL`
  pointing at their instance). See the README's "SNOMED CT setup
  (advanced)" section.

## [1.0.2] - 2026-01-19

### Added

- Structured logging via pino, written to stderr only (preserves the
  MCP stdio protocol on stdout).
- `mcpName` field in `package.json` for MCP Registry compatibility.

### Fixed

- URL path duplication in client requests.

## [1.0.0] - 2026-01-19

Initial public release.

### Added

- 27 MCP tools across five medical terminologies: ICD-11 (5),
  LOINC (4), RxNorm (5), MeSH (4), SNOMED CT (5), plus 4 crosswalk tools.
- Token-bucket rate limiters per upstream API (WHO 5/s, NLM 10/s,
  RxNorm 20/s, SNOMED 10/s).
- In-memory cache with per-data-class TTLs (token, search, lookup,
  static).
- Exponential-backoff retry with jitter, retryable HTTP status codes
  configurable.
- WHO ICD-11 OAuth2 client_credentials flow with token caching.
