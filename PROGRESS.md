# Medical Terminologies MCP - Progress Tracker

## Overview

This document is the implementation diary of the Medical Terminologies MCP
Server: phase-by-phase scope, tool coverage, requirements checklist, and
build status. Consumer-facing release notes live in [CHANGELOG.md](./CHANGELOG.md).

The original Phases 0–7 (covering the initial 27 tools) shipped in early
2026. Phase 8 absorbed an external audit conducted on 2026-05-07/08 and
the resulting hardening sweep. Phase 9 expanded coverage with ATC + CID-10
(7 new tools, totalling 34 with SNOMED enabled). Phase 10 added contract +
integration tests, which surfaced three silent production regressions
that were fixed in the same commit.

The audit's full findings list and the rationale behind active deferrals
live in `## Audit Reference` near the bottom — useful for future
contributors to understand why something is or isn't done.

## Phase Summary

| Phase | Description | Status | Tools |
|-------|-------------|--------|-------|
| 0 | Setup inicial | ✅ Complete | - |
| 1 | ICD-11 (WHO) | ✅ Complete | 5 tools |
| 2 | LOINC | ✅ Complete | 4 tools |
| 3 | RxNorm | ✅ Complete | 5 tools |
| 4 | MeSH | ✅ Complete | 4 tools |
| 5 | SNOMED CT | ✅ Complete | 5 tools (gated) |
| 6 | Crosswalk | ✅ Complete | 4 tools |
| 7 | Documentation & Publish | ✅ Complete | - |
| 8 | Audit-driven hardening (2026-05-07 → 2026-05-09) | ✅ Complete | - |
| 9 | ATC + CID-10 expansion (2026-05-09) | ✅ Complete | +7 tools |
| 10 | Contract + integration testing (2026-05-09) | ✅ Complete | - |

**Total Tools:** 28 default / 34 with SNOMED enabled
**Total Tests:** 243 across 13 files (+ 11 integration tests gated by `INTEGRATION_TESTS=1`)

---

## Active Deferrals

Three items are intentionally not done. The rationale is preserved here so
future contributors don't re-discover and re-decide. Each deferral has
explicit re-evaluation triggers.

### [P3] Streamable HTTP transport (deferred 2026-05-08)

**State:** `src/server.ts` instantiates only `StdioServerTransport`. No
`--http` flag, no `StreamableHTTPServerTransport`, no hosted deploy.

**Why deferred:** ~3-4 h of work that's orthogonal to internal-quality
items. It's a *prerequisite* for hosted distribution channels (Smithery,
Cloudflare Workers, LobeHub) but the implementation alone doesn't move
adoption — that depends on the subsequent product decision to *apply* the
multi-channel distribution.

**Note on classification:** originally P3 ("limited adoption: install
locally"). Subsequent empirical evidence suggests this was too low — the
sister project `bcb-br-mcp` has ~501 dl/month with multi-channel
distribution (npm + Smithery + Cloudflare Worker + LobeHub) versus this
project's ~160 dl/month via npm-only. The ~3× gap likely reflects the
distribution channel more than technical quality, and Streamable HTTP is
a hard prerequisite for the channels driving that growth. **Don't read
this deferral as "trivial, leave for later"** — it's probably the
highest-leverage adoption item in the entire backlog.

**Re-evaluate when:**

- (a) **Decision to apply the `bcb-br-mcp` multi-channel strategy.** Most
  likely trigger temporally — when "let's publish on Smithery" comes up,
  the HTTP transport needs to be ready.
- (b) Explicit user demand for shared deployment (multiple agents or
  multiple machines hitting one instance).
- (c) Downloads cross 500/month sustained — npm-only is saturating.

**Cross-reference:** when this lands, re-evaluate the SNOMED
`Accept-Language` env override. Multi-tenant deployment may need
per-tool `language` parameters propagated from end-users, complementing
the env var.

### [P1] `map_snomed_to_icd10` real refset 447562003 (deferred 2026-05-09)

**State:** the tool is gated behind `ENABLE_SNOMED_TOOLS=true`. Even
when enabled, `src/tools/crosswalk.ts:157-214` calls `client.getConcept(sctid)`
and returns guidance text — it does **not** consult the refset.

**Why deferred:** the intersection of operators that (a) hold an IHTSDO
license, (b) run self-hosted Snowstorm, (c) use MCP servers, and (d)
chose this one is essentially zero today. Brazilian users in particular
can't access SNOMED operationally — Brazil is not an IHTSDO member country.

Additionally, refset 447562003 is the **ICD-10 Complex Map** by design —
not a 1:1 lookup. Each SNOMED concept can have multiple
`ReferenceSetMember` entries with `mapGroup`, `mapPriority`, `mapRule`
(ECL-like, requires context evaluation), `mapAdvice` (semi-structured
strings), and `mapCategoryId` for fallback. A naïve `members[0].mapTarget`
implementation reproduces the same class of bug the audit flagged in
`map_icd10_to_icd11`: appears to work, but lies in non-trivial cases.
Honest implementation (~5-6 h) optimizes for a user that probably
doesn't exist today.

**Re-evaluate when (any of):**

- (a) IHTSDO or equivalent stands up a new public host with the Complex
  Map refset accessible.
- (b) `SNOMEDClient` pivots to a FHIR terminology server (Ontoserver,
  NHS TS, etc.) — multi-tenant-friendly and open for some operations.
- (c) Streamable HTTP transport ships with hosted SNOMED licensing
  (cross-references the deferral above) — operator stops being the end
  user; becomes the host.
- (d) An operator opens an issue confirming they have Snowstorm running
  and need this mapping. Cheapest trigger to detect.

**Scope when attacked:** new `getICD10MapTargets(sctid)` method on
`SNOMEDClient` returning the full structure (all groups, all rules,
advice, category). Don't collapse to "first target". Handler renders
the structure literally so the LLM/operator interprets. Contract test
with fixture JSON (no live Snowstorm to integration-test against).

### [P1] NLM `/loinc_answers` endpoint replacement (discovered 2026-05-09)

**State:** the upstream `/loinc_answers` endpoint at
`clinicaltables.nlm.nih.gov` returns HTTP 404 in production (verified
during Phase 10 fixture capture). The client's catch-all returns `[]`,
so `loinc_answers` reports "no answers available" for every input —
silently degraded.

**Why deferred from Phase 10:** the Phase 10 work locked the current
404 → `[]` behavior in a contract test (so it doesn't change without
notice), but a real replacement requires investigating the new
canonical source. For form-type LOINCs (PHQ-9, etc.), the answers are
in the `/loinc_form_definitions` response. For single-observation
LOINCs with discrete answer lists, the new source is unclear and may
require crawling the LOINC release files directly.

**Re-evaluate when:** any user asks for `loinc_answers` data. The
absence of complaints across ~160 dl/month suggests low impact, but
the bug is real and worth fixing when next someone reaches for it.

---

## Phase 0: Setup Inicial ✅

### Completed Items

- [x] package.json with dependencies
- [x] tsconfig.json (ES2022 + strict)
- [x] Directory structure
- [x] src/utils/cache.ts - Generic cache with TTL
- [x] src/utils/retry.ts - Exponential backoff retry
- [x] src/utils/rate-limiter.ts - Token bucket rate limiter
- [x] src/types/index.ts - Base types and Zod schemas
- [x] src/server.ts - Server configuration and tool registry
- [x] src/index.ts - Entry point
- [x] PROGRESS.md - This file

### Build Status

- Build: ✅ Success (esbuild, 4.0kb)
- TypeScript: ✅ No errors (tsc --noEmit)

---

## Phase 1: ICD-11 (WHO) ✅

### Implemented Tools

| Tool | Description | Status |
|------|-------------|--------|
| icd11_search | Text search in ICD-11 MMS | ✅ |
| icd11_lookup | Entity details by code/URI | ✅ |
| icd11_hierarchy | Parents and children | ✅ |
| icd11_chapters | List ICD-11 chapters | ✅ |
| icd11_postcoordination | Composite code info | ✅ |

### Completed Requirements

- [x] WHO OAuth2 client implementation (src/clients/who-client.ts)
- [x] Token caching (50 min TTL — superseded by `expires_in`-aware TTL in Phase 8)
- [x] Rate limiting (5 req/s)

### Build Status

- Build: ✅ Success (esbuild, 604.2kb)
- TypeScript: ✅ No errors

---

## Phase 2: LOINC ✅

### Implemented Tools

| Tool | Description | Status |
|------|-------------|--------|
| loinc_search | Search by term or code | ✅ |
| loinc_details | Full code details | ✅ |
| loinc_answers | Form answers list | ⚠️ Upstream 404 (see deferrals) |
| loinc_panels | Related panels | ✅ |

### Completed Requirements

- [x] NLM Clinical Tables API client (src/clients/nlm-client.ts)
- [x] Rate limiting (10 req/s)
- [x] Response caching

### Build Status

- Build: ✅ Success (esbuild, 624.0kb)
- TypeScript: ✅ No errors

---

## Phase 3: RxNorm ✅

### Implemented Tools

| Tool | Description | Status |
|------|-------------|--------|
| rxnorm_search | Search drugs by name | ✅ |
| rxnorm_concept | Details by RxCUI | ✅ |
| rxnorm_ingredients | Active ingredients | ✅ |
| rxnorm_classes | Therapeutic classes | ✅ |
| rxnorm_ndc | NDC mapping | ✅ |

### Completed Requirements

- [x] RxNorm REST API client (src/clients/rxnorm-client.ts)
- [x] Rate limiting (20 req/s)
- [x] Response caching
- [x] Approximate matching for fuzzy search

### Build Status

- Build: ✅ Success
- TypeScript: ✅ No errors

---

## Phase 4: MeSH ✅

### Implemented Tools

| Tool | Description | Status |
|------|-------------|--------|
| mesh_search | Search descriptors by term | ✅ |
| mesh_descriptor | Details by MeSH ID | ✅ |
| mesh_tree | Tree hierarchy location | ✅ |
| mesh_qualifiers | Allowed qualifiers | ✅ |

### Completed Requirements

- [x] MeSH Linked Data API client (src/clients/mesh-client.ts)
- [x] Rate limiting (10 req/s, shared with NLM)
- [x] Response caching
- [x] JSON-LD parsing for descriptor details (rewritten in Phase 10 — see below)

### Build Status

- Build: ✅ Success (esbuild, 668.7kb)
- TypeScript: ✅ No errors

---

## Phase 5: SNOMED CT ✅

### Implemented Tools

| Tool | Description | Status |
|------|-------------|--------|
| snomed_search | Search concepts by term | ✅ |
| snomed_concept | Details by SCTID | ✅ |
| snomed_hierarchy | Parents/children (IS-A) | ✅ |
| snomed_descriptions | FSN, PT, synonyms | ✅ |
| snomed_ecl | ECL queries | ✅ |

### Completed Requirements

- [x] SNOMED CT Snowstorm API client (src/clients/snomed-client.ts)
- [x] Rate limiting (10 req/s)
- [x] Response caching
- [x] IHTSDO license disclaimer on all outputs
- [x] Feature-flag gate (`ENABLE_SNOMED_TOOLS`) added in Phase 8 after the public Snowstorm host went 410 Gone

### Build Status

- Build: ✅ Success (esbuild, 693.4kb)
- TypeScript: ✅ No errors

---

## Phase 6: Crosswalk ✅

### Implemented Tools

| Tool | Description | Status |
|------|-------------|--------|
| map_icd10_to_icd11 | Text search ICD-11 using ICD-10 code (not authoritative) | ✅ |
| map_snomed_to_icd10 | SNOMED → ICD-10 guidance | ⚠️ Real refset deferred |
| map_loinc_to_snomed | LOINC → SNOMED guidance | ✅ |
| find_equivalent | Cross-terminology search | ✅ |

### Completed Requirements

- [x] ICD-10 to ICD-11 mapping via WHO API search (description rewritten in Phase 8 to be honest about being text search, not authoritative mapping)
- [x] SNOMED to ICD-10 mapping guidance (real refset 447562003 deferred — see Active Deferrals)
- [x] LOINC to SNOMED mapping guidance (rewritten in Phase 8 to be explicit about not performing the mapping)
- [x] Cross-terminology text search across all 5 systems
- [x] Graceful handling when mappings unavailable
- [x] `find_equivalent.source_terminology` parameter actually consumed (Phase 8 fix)

### Build Status

- Build: ✅ Success (esbuild, 710.0kb)
- TypeScript: ✅ No errors

---

## Phase 7: Documentation & Publish ✅

### Completed

- [x] README.md with full documentation
- [x] server.json for MCP Registry
- [x] LICENSE (MIT)
- [x] package.json with full metadata
- [x] .github/workflows/publish.yml
- [x] `npm publish --provenance` (Phase 8 addition)

---

## Phase 8: Audit-driven hardening ✅

### Scope

External audit conducted 2026-05-07/08 produced ~30 findings across
P0/P1/P2/P3 priorities. Most resolved in this phase; coverage gaps and
real-mapping deferrals tracked in Phases 9 and Active Deferrals
respectively. Source: `improvements.md` (now folded into this file).

### Resolved findings

| Pri | Finding | Resolution |
|-----|---------|------------|
| P0 | README.md in UTF-16 LE (would render as garbage on npm) | Rewritten in UTF-8 |
| P0 | `.mcpregistry_registry_token` not in `.gitignore` | Glob `.mcpregistry_*_token` added; file removed from disk |
| P0 | `SERVER_INFO.version` hardcoded to `'1.0.0'` (drifted from package.json `1.0.2`) | Reads from package.json via `resolveJsonModule` |
| P0 | Public IHTSDO Snowstorm endpoint 410 Gone — 6 SNOMED-dependent tools silently broken | Tools gated behind `ENABLE_SNOMED_TOOLS=true`; `SNOMED_BASE_URL` env override for self-host |
| P1 | Strict Zod regex schemas (LOINC, SCTID, MeSH ID, RxCUI) defined in `types/` but never imported by tools — local loose copies used instead | Schemas centralized; tools call `buildInputSchema(...)` directly |
| P1 | `@modelcontextprotocol/sdk` pinned as `"latest"` — non-deterministic builds | Pinned to `^1.25.2` |
| P1 | `getParents`/`getChildren`/`icd11_chapters` did N+1 sequential fetches | Promise.allSettled — paralelism limited by rate limiter |
| P1 | OAuth token cache used fixed 50 min TTL, ignored `expires_in` from response | TTL = `max(60, expires_in - 60)` honors API value |
| P1 | `inputSchema` JSON in snake_case, Zod in camelCase — manual mapping in every handler | snake_case throughout via `zod-to-json-schema` |
| P1 | No `annotations` (read-only/idempotent/open-world hints) | `READ_ONLY_TOOL_ANNOTATIONS` on every tool |
| P1 | No `outputSchema` — every result is unstructured text | `outputSchema` + `structuredContent` on 24/27 tools |
| P1 | `getLOINCDetails` with `maxList: 1` could miss exact-match LOINC behind ranked siblings | Bumped to `maxList: 10` + exact-match findIndex |
| P1 | `find_equivalent.sourceTerminology` declared but unused | Now subtracts source from search targets |
| P1 | `map_icd10_to_icd11` was textual search dressed as authoritative mapping | Description rewritten to surface the search semantics honestly; same for `map_loinc_to_snomed` |
| P1 | No tests of any kind | Vitest suite (116 tests across 5 files: cache, retry, rate-limiter, zod-schema, schemas); contract+integration tests added in Phase 10 |
| P1 | CI ran only on publish; no PR gate | New `.github/workflows/ci.yml` runs typecheck + tests + build on PR/push, matrix Node 20+22 |
| P2 | MeSH client fetched the descriptor URL three times (`getDescriptor`/`getTreeNumbers`/`getAllowedQualifiers`) | Shared `fetchDescriptorRaw` cache |
| P2 | `MeSHQualifier.label` and `MeSHConcept.terms` always empty (broken contract) | Lookups parallelized via shared rate limiter, labels populated |
| P2 | Mixed `pino` + raw `process.stderr.write` logging | All routed through pino |
| P2 | Shutdown didn't close transport or flush logs | Graceful SIGINT/SIGTERM with 5s timeout + `logger.flush()` |
| P2 | All 5 clients used `error.response?.data?.message \|\| error.message` — collapsed to "undefined" on HTML/non-JSON errors | `extractErrorMessage` helper covers JSON + OAuth + plain string + HTML preview |
| P2 | ICD-11 `releaseId` hardcoded to `'2024-01'` | `WHO_ICD11_RELEASE_ID` env override |
| P2 | `logs.txt` (0 bytes) untracked yet not gitignored | Removed; `.gitignore` updated for the class of files |
| P3 | No `CHANGELOG.md` (release notes lived in `PROGRESS.md`) | CHANGELOG.md created in Keep-a-Changelog format |
| P3 | No `CONTRIBUTING.md`, no Dependabot, no issue/PR templates | All added |
| P3 | SNOMED `Accept-Language: en` hardcoded | `SNOMED_LANGUAGE` env override |
| P3 | `npm publish` lacked `--provenance` flag (no SLSA attestation) | `--provenance` enabled |

### Completed Requirements

- [x] All P0/P1 findings resolved or explicitly deferred with rationale
- [x] All P2 findings resolved
- [x] All P3 findings except Streamable HTTP and `map_snomed_to_icd10` refset resolved
- [x] Audit findings table preserved (this section)
- [x] Active deferrals documented with re-evaluation triggers

### Build Status (after Phase 8)

- Build: ✅ Success (esbuild)
- TypeScript: ✅ No errors (npm run typecheck)
- Tests: ✅ 116 passing (Vitest)
- CI: ✅ Green on Node 20 + 22

---

## Phase 9: ATC + CID-10 expansion ✅

### Scope

Closes the audit's P3 *Lacunas de cobertura de terminologias* finding.
Adds two terminologies (ATC + CID-10) for a total of 7 new tools.
Tool count goes from 21 default / 27 with SNOMED → **28 default / 34 with SNOMED**.

### Implemented Tools

| Tool | Description | Status |
|------|-------------|--------|
| atc_classify | Drug name → ATC classification(s) | ✅ |
| atc_lookup | ATC code (level 1-4) → name + level type | ✅ |
| atc_members | ATC class → member drugs (with substance-level codes) | ✅ |
| cid10_search | Diacritic-insensitive Portuguese text search | ✅ |
| cid10_lookup | Code → official Portuguese name | ✅ |
| cid10_chapters | List the 22 CID-10 chapters | ✅ |
| cid10_chapter | Chapter detail with constituent groups | ✅ |

### Completed Requirements

- [x] ATC client methods on `RxNormClient` (NLM RxClass envelope; reuses rate limiter, retry, cache)
- [x] ATC limitation surfaced in tool descriptions: `byId` only resolves levels 1–4 (5-char codes); level-5 substance codes (7 chars) come via `byDrugName` only
- [x] `CID10Client` in-memory (`src/clients/cid10-client.ts`) — no HTTP, no rate limiter, no cache
- [x] Bundled DataSUS V2008 dataset (`src/data/cid10.json`, ~1.94 MB tabular header+rows)
- [x] `scripts/build-cid10-dataset.mjs` reproducible builder (downloads CSV zip, transcodes ISO-8859-1, parses, emits JSON)
- [x] Zod input + output schemas for all 7 new tools (snake_case throughout)
- [x] Diacritic-insensitive search (`infeccoes` matches `infecções`)
- [x] Both dotted (`A00.1`) and undotted (`A001`) code forms accepted
- [x] CI tool count assertion updated from 27 to 34 (`.github/workflows/ci.yml`)

### Build Status (after Phase 9)

- Build: ✅ Success (esbuild, 2.9 MB — increase due to bundled CID-10 JSON)
- TypeScript: ✅ No errors
- Tests: ✅ 186 passing
- CI: ✅ Green

---

## Phase 10: Contract + integration testing ✅

### Scope

Closes the audit's P1 contract+integration tests deferral. Three silent
production regressions discovered during fixture capture motivated
in-scope code fixes. The pattern in all three: API drifted, client
gracefully returned empty data, no one noticed.

### Implemented Tests

| Component | File | Tests |
|-----------|------|-------|
| MeSH | `src/clients/mesh-client.contract.test.ts` | 9 |
| NLM/LOINC | `src/clients/nlm-client.contract.test.ts` | 12 |
| RxNorm + ATC | `src/clients/rxnorm-client.contract.test.ts` | 20 |
| WHO ICD-11 | `src/clients/who-client.contract.test.ts` | 9 |
| SNOMED CT | `src/clients/snomed-client.contract.test.ts` | 7 |
| Live integration | `src/integration/live-apis.integration.test.ts` | 11 (gated by `INTEGRATION_TESTS=1`) |

### Production regressions discovered

| # | Bug | Status |
|---|-----|--------|
| 1 | MeSH `/D{id}.json` parser silently empty after NLM JSON-LD shape change (`@graph` → flat compact JSON-LD) | ✅ Fixed: rewrote `MeSHClient` with per-resource fan-out (descriptor + concept + terms + qualifiers as separate parallel fetches) |
| 2 | WHO `lookup` by URI doubled `/icd` in path → 404 | ✅ Fixed: path stripping aligned with `getEntity` |
| 3 | NLM `/loinc_answers` endpoint 404 in production | ⚠️ Pinned current behavior in contract test; real fix tracked as deferral above |

### Completed Requirements

- [x] `nock` ^14 added as dev dep; axios interception verified
- [x] Live fixtures captured for NLM/RxNorm/MeSH (~140 KB total in `src/__fixtures__/`)
- [x] WHO + SNOMED inline-mocked (no public test creds; SNOMED public host dead)
- [x] Integration tests gated by `INTEGRATION_TESTS=1` env var
- [x] WHO + SNOMED tests skip cleanly when their respective creds/flags are absent
- [x] Daily cron CI workflow `.github/workflows/integration.yml`
- [x] Default CI run skips integration tests (no surprise upstream failures gating PRs)
- [x] MeSH client end-to-end smoke test against live API verifies rewrite

### Build Status (after Phase 10)

- Build: ✅ Success (esbuild, 3.0 MB)
- TypeScript: ✅ No errors
- Tests: ✅ 243 passing across 13 files (+ 11 integration, gated)
- CI: ✅ Green on Node 20 + 22

---

## Audit Reference

Historical context preserved from the 2026-05-07/08 audit. Useful for
contributors to understand why specific code patterns exist.

### Files inspected during audit

Inspected in full:

- `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`
- `README.md`, `PROGRESS.md`, `server.json`, `LICENSE`
- `.github/workflows/publish.yml`
- `src/index.ts`, `src/server.ts`, `src/types/index.ts`
- `src/utils/cache.ts`, `src/utils/logger.ts`, `src/utils/rate-limiter.ts`, `src/utils/retry.ts`
- `src/tools/*.ts` (icd11, loinc, rxnorm, mesh, snomed, crosswalk)
- `src/clients/*.ts` (who, nlm, rxnorm, snomed, mesh)
- `node_modules/@modelcontextprotocol/sdk/package.json` (to confirm installed SDK version)

Inspected via metadata only:

- `logs.txt` (0 bytes)
- `.mcpregistry_github_token`, `.mcpregistry_registry_token`

Repo searches: `*test*` → no results (motivated Phase 8 testing); `*lint*` → no results; `CHANGELOG*` → no results (motivated Phase 8 CHANGELOG.md).

### What NOT to change

These are deliberately well-built — don't alter them inadvertently during
refactors:

- **`src/utils/rate-limiter.ts`** — token bucket with fractional refill,
  async queue, non-blocking `tryAcquire`. Per-API limits (5/10/20 req/s)
  are conservative against what the public APIs typically tolerate. The
  *absence* of jitter is correct here — rate limiting is deterministic.
- **`src/utils/retry.ts`** — `withRetry` does it all: exponential
  backoff, `maxDelay` cap, ±25% jitter, configurable retryable status
  codes, network-error detection by message (ECONNRESET/ETIMEDOUT/etc),
  optional `onRetry` callback. Throws `lastError` after exhaustion.
- **`src/utils/cache.ts`** — distinct TTLs per data class (STATIC/LOOKUP/SEARCH/TOKEN);
  `getOrSet` is the idiomatic pattern. `useClones: false` is conscious
  perf choice — caches store post-parse immutable objects.
- **`tsconfig.json`** — strict + `noUnusedLocals` + `noUnusedParameters` +
  `noImplicitReturns` + `noFallthroughCasesInSwitch`. **Don't relax any of these.**
- **SNOMED disclaimer on every output** (`SNOMED_TOOL_DISCLAIMER`) — correct
  posture given the IHTSDO license. Maintain.
- **WHO OAuth client_credentials flow with token caching + 401-triggered
  invalidation** — code shape is right; only TTL parameters needed
  tuning (Phase 8 fix).
- **Lazy singletons for clients** (`getWHOClient()`, `getNLMClient()`, etc.) —
  good for shared cache state and avoiding repeated construction in
  handlers. Keep.
- **stderr-only logging** (`src/utils/logger.ts`) — critical for not
  corrupting MCP stdio transport. The intent is documented in code.
  Don't switch to stdout.

---

## Changelog

Versioned release notes live in [CHANGELOG.md](./CHANGELOG.md) in the
standard Keep-a-Changelog format. PROGRESS.md is preserved as the
phase-by-phase implementation diary; CHANGELOG.md is the consumer-facing
release log.
