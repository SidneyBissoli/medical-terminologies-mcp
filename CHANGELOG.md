# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

## [1.1.0] - 2026-05-08

This release is a P0/P1 sweep against an external audit; behavior is
mostly preserved with sharper validation and honest tool framing. The
minor bump is justified primarily by the SNOMED-tools-off-by-default
change above (which is technically breaking for existing users but
necessary because the default backend was already broken upstream).

### Added

- Strict Zod input schemas (LOINC `^\d{1,5}-\d$`, SCTID `^\d+$`, MeSH ID
  `^D\d+$`, RxCUI `^\d+$`, ICD-11 lookup code-or-uri refine) now actually
  execute. Each tool's MCP `inputSchema` is derived from the Zod schema
  via `buildInputSchema`, eliminating the previous Zod/JSON-Schema
  duplication.

### Changed

- `map_icd10_to_icd11` description and output now describe the tool
  honestly as a text-similarity search of the ICD-11 catalog, not an
  authoritative ICD-10 → ICD-11 mapping. Match-score column removed from
  the output table.
- Pinned `@modelcontextprotocol/sdk` to `^1.25.2` (was `latest`).

### Fixed

- `SERVER_INFO.version` now sourced from `package.json` at build time
  (was hardcoded to `1.0.0`).
- WHO OAuth cache now uses real `expires_in` (was 50-minute hardcoded
  TTL).
- WHO `getParents` / `getChildren` and the `icd11_chapters` handler now
  run in parallel (`Promise.allSettled`); were sequential, making cold
  hierarchy reads slow.
- README re-encoded from UTF-16 LE to UTF-8 for npmjs.com rendering.
- `.mcpregistry_registry_token` untracked; broader glob added to
  `.gitignore`.

### Security

- Pinned the MCP SDK to a narrow range, removing exposure to silent
  breaking changes via `npm ci`.

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
