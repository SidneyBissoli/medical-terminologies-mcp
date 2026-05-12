# Medical Terminologies MCP - Progress Tracker

## Overview

This document is the implementation diary of the Medical Terminologies MCP
Server: phase-by-phase scope, tool coverage, requirements checklist, and
build status. Consumer-facing release notes live in [CHANGELOG.md](./CHANGELOG.md).

The original Phases 0–7 (covering the initial 27 tools) shipped in early
2026. Phase 8 absorbed an external audit and the resulting hardening
sweep. Phase 9 expanded coverage with ATC + CID-10. Phase 10 added
contract + integration tests, surfacing three silent production
regressions that were fixed in the same commit.

Phases 11–14 are planned: distribution & discovery (hosted-deployment
unblocks + multi-channel listing), content & outreach (turning
technical readiness into adoption), coverage expansion (real crosswalks
+ new terminologies for international + Brazilian operational
audiences), and ongoing quality & maintenance.

The audit's full findings list and patterns to leave alone live in
`## Audit Reference` near the bottom — useful for future contributors
to understand why specific code patterns exist. Outreach copy
(post drafts, email templates, submission text) lives separately in
[outreach-templates.md](./outreach-templates.md).

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
| 11 | Distribution & Discovery | 🔄 In progress | +3 prompts, +3 resources (1.3.0) |
| 12 | Content & Outreach | 📋 Planned | - |
| 13 | Coverage Expansion | 📋 Planned | +9–11 tools |
| 14 | Quality & Maintenance | 📋 Ongoing | - |

**Tools today:** 31 default / 37 with SNOMED enabled
**Prompts today:** 3 (`find-medical-code`, `drug-info`, `cid10-portuguese-lookup`) — added 1.3.0
**Resources today:** 3 (`info://server`, `info://cid10/chapters`, `info://licenses`) — added 1.3.0
**Per-tool `language` parameter** on `snomed_search`, `snomed_concept`, `icd11_search`, `icd11_lookup`, `mesh_search`, `mesh_descriptor` — propagates as `Accept-Language` upstream (added 11.4)
**Tools projected after Phase 13:** ~38–40 default / ~44–46 with SNOMED
**Tests today:** 313 across 20 files (+ 11 integration tests gated by `INTEGRATION_TESTS=1`)

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
| loinc_answers | Form answers list | ⚠️ Upstream 404 (see Phase 14.1) |
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
| map_icd10_to_icd11 | Authoritative WHO ICD-10 → ICD-11 mapping (transition tables, release 2025-01) | ✅ — Phase 13.1 landed 2026-05-11; tool now returns authoritative mapping, not text search |
| map_snomed_to_icd10 | SNOMED → ICD-10 guidance | ⚠️ — real refset planned in Phase 13.7 |
| map_loinc_to_snomed | LOINC → SNOMED guidance | ✅ |
| find_equivalent | Cross-terminology search | ✅ |

### Completed Requirements

- [x] ICD-10 to ICD-11 mapping via WHO API search (description rewritten in Phase 8 to be honest about being text search, not authoritative mapping)
- [x] SNOMED to ICD-10 mapping guidance (real refset 447562003 planned in Phase 13.7)
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
P0/P1/P2/P3 priorities. Most resolved in this phase; coverage gaps
went to Phase 9; contract+integration tests went to Phase 10. Source:
`improvements.md` (folded into this file).

### Resolved findings

| Pri | Finding | Resolution |
|-----|---------|------------|
| P0 | README.md in UTF-16 LE (would render as garbage on npm) | Rewritten in UTF-8 |
| P0 | `.mcpregistry_registry_token` not in `.gitignore` | Glob `.mcpregistry_*_token` added; file removed from disk |
| P0 | `SERVER_INFO.version` hardcoded to `'1.0.0'` (drifted from package.json `1.0.2`) | Reads from package.json via `resolveJsonModule` |
| P0 | Public IHTSDO Snowstorm endpoint 410 Gone — 6 SNOMED-dependent tools silently broken | Tools gated behind `ENABLE_SNOMED_TOOLS=true`; `SNOMED_BASE_URL` env override for self-host |
| P1 | Strict Zod regex schemas (LOINC, SCTID, MeSH ID, RxCUI) defined in `types/` but never imported by tools — local loose copies used instead | Schemas centralized; tools call `buildInputSchema(...)` directly |
| P1 | `@modelcontextprotocol/sdk` pinned as `"latest"` — non-deterministic builds | Pinned to `^1.25.2` |
| P1 | `getParents`/`getChildren`/`icd11_chapters` did N+1 sequential fetches | Promise.allSettled — parallelism limited by rate limiter |
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

- [x] All P0/P1 findings resolved or routed to a planned phase with rationale
- [x] All P2 findings resolved
- [x] All P3 findings except Streamable HTTP and `map_snomed_to_icd10` refset resolved (planned in Phase 11.2 and Phase 13.7)
- [x] Audit findings table preserved (this section)

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
| 1 | MeSH `/D{id}.json` parser silently empty after NLM JSON-LD shape change (`@graph` → flat compact JSON-LD) | ✅ Fixed: rewrote `MeSHClient` with per-resource fan-out |
| 2 | WHO `lookup` by URI doubled `/icd` in path → 404 | ✅ Fixed: path stripping aligned with `getEntity` |
| 3 | NLM `/loinc_answers` endpoint 404 in production | ⚠️ Pinned current behavior in contract test; real fix planned in Phase 14.1 |

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

## Phase 11: Distribution & Discovery 🔄 In progress

### Scope

Hosted-deployment unblocks plus multi-channel listing. Without these,
the project's adoption is bounded by "user installs locally via npm" —
a real ceiling at ~500 dl/month based on the sister project
`bcb-br-mcp` data point. Streamable HTTP transport is the technical
prerequisite for ~3 of the 4 hosted distribution channels (Smithery,
Cloudflare Workers, LobeHub) and is the highest-leverage adoption work
in the entire backlog.

This phase also fixes the visible "front door" of the project — npm
page, README — which today is text-only despite the server producing
rich tabular outputs.

### Sub-tasks

| # | Sub-task | Effort | Status | Depends on |
|---|----------|--------|--------|------------|
| 11.1 | Sync `server.json` with `package.json` 1.1.0 + new env vars | ~30 min | ✅ shipped | none |
| 11.2 | Streamable HTTP transport (`--http --port` flag); `StreamableHTTPServerTransport` from SDK; `transport: { type: "streamable-http" }` alternative in `server.json` | ~3-4 h | ✅ shipped 1.2.0 | none |
| 11.3 | README polish — 3 real output samples + audience matrix | ~2-3 h | ✅ shipped | none |
| 11.4 | Per-tool `language` parameter on SNOMED/ICD-11/MeSH search & lookup tools | ~2 h (came in ~2h) | ✅ shipped 2026-05-11 — `language` now accepted on `snomed_search`, `snomed_concept`, `mesh_search`, `mesh_descriptor` (ICD-11 already had it). Per-call override propagated as `Accept-Language` header on every upstream request; cache keys include the resolved language to avoid cross-tenant contamination. 6 new contract tests pin the propagation. | 11.2 reduces ROI gap; not strict dep |
| 11.5 | Submit to Glama.ai | ~20 min | ✅ shipped 2026-05-11 — listed at https://glama.ai/mcp/servers/SidneyBissoli/medical-terminologies-mcp, returns in search results for "medical terminologies", and is categorized under Biology & Medicine / Health & Wellness / Research & Data. Glama scores: License A / Quality A / Maintenance C. The `glama.json` with `maintainers` field (commit d430850) was sufficient to establish ownership and unlock search visibility — the Dockerfile follow-up turned out to be unnecessary (kept the draft in [docs/glama-dockerfile.md](./docs/glama-dockerfile.md) as a reference in case Glama's safety/quality grading later requires it). | 11.1 + 11.3 |
| 11.6 | Submit to mcpservers.org | ~20-30 min | ✅ auto-indexed 2026-05-11 — listed at https://mcpservers.org/servers/sidneybissoli/medical-terminologies-mcp without form submission. mcpservers.org appears to auto-discover from the MCP Registry (the page shows "27 tools" — stale data from the v1.0.x Registry entry — confirming Registry scraping rather than form intake). The A.3 form-prep work in [outreach-templates.md](./outreach-templates.md) was unnecessary; leaving the draft in for future reference. Category is not visibly displayed on the listing page | 11.1 + 11.3 |
| 11.7 | PR to `awesome-mcp-servers` (punkpeye + wong2 lists) | ~30 min | 🔄 PR opened 2026-05-11 — [punkpeye/awesome-mcp-servers#6208](https://github.com/punkpeye/awesome-mcp-servers/pull/6208) (in the `🤖🤖🤖` agent-PR fast-track queue per their CONTRIBUTING.md). Will flip to ✅ shipped + bump directory count once merged. **Scope reduced to punkpeye only**: wong2's repo is PR-restricted (0 open / 0 closed PRs ever, "Pull request creation is restricted" banner). Success criterion "merged in at least one" satisfied by punkpeye | 11.1 + 11.3 |
| 11.8 | Submit to Smithery.ai via URL submission flow (point at the live Workers endpoint from 11.9). Smithery deprecated `runtime: container` between this roadmap's authoring and 2026-05-10, so the original `smithery.yaml` approach is dead — URL submission is the only remaining path | ~30 min | ✅ shipped — live at https://smithery.ai/servers/@sidneybissoli/medical-terminologies | 11.9 |
| 11.9 Stage 1 | **Production Cloudflare Workers deployment** (the actual hosted endpoint). Port `node:http` server to a fetch handler using `WebStandardStreamableHTTPServerTransport` from the SDK; `wrangler.toml`; GitHub Actions deploy on push to main. Per-isolate cache + rate-limiter reused as-is (Stage 2 swaps in KV + DO). | ~6-12 h (came in ~5h) | ✅ shipped — live at https://medical-terminologies-mcp.sidneybissoli.workers.dev | 11.2 |
| 11.9 Stage 2 | Replace per-isolate `node-cache` with Workers KV; replace per-isolate token-bucket with a Durable Object. Required when traffic saturates per-isolate budgets — not blocking Smithery submission. | ~4-6 h | 📋 deferred — trigger: WHO/NLM rate-limit warnings in logs OR cache hit rate < 50% | 11.9 Stage 1 |
| 11.10 | LobeHub MCP validator pass | ~3h (came in ~3h) | 🔄 code shipped 2026-05-11 in v1.3.0 — listing page exists at https://lobehub.com/mcp/sidneybissoli-medical-terminologies-mcp; LobeHub auto-discovered via MCP Registry. Implemented the two missing validator gates (MCP Prompts + Resources surfaces) plus the README badge. Will flip to ✅ when LobeHub's scanner re-runs and the badge URL flips from HTTP 500 ("unvalidated") to "validated". Originally scoped at ~30min — actual scope grew because LobeHub validation requires server feature additions, not just a manifest submission | 11.2 |
| 11.11 | **Smithery quality-score polish (post-listing)** — after 11.8 established the listing, Smithery's quality rubric scored it 63/orange and kept it `unlisted` in search. The rubric flags 5 axes: display name (`title` field), description (`server.json` has a hard 100-char cap that npm and `SERVER_INFO` don't), homepage (`websiteUrl`), icon (`icons[]` array, ≤1MB per file, HTTPS-served), and per-tool `outputSchema` coverage. Closed 4 of 5 in v1.4.1 (`chore(metadata): polish server.json…` + `chore(release): 1.4.1`): added `title` (`"Medical Terminologies MCP"`), `websiteUrl` (Medium walkthrough), `icons[]` (Gemini-generated PNGs, resized to 512×512 after Smithery rejected the 1024×1024 1.3MB originals), and synced/expanded description across `server.json` / `package.json` / `SERVER_INFO`. Also fixed long-standing drift: `server.json` `packages[1].version` was frozen at `1.2.1` since the streamable-http transport was added — the publish workflow's `jq` step only auto-syncs `packages[0]`. The 5th axis (`outputSchema` on 3 crosswalk tools) is tracked as Phase 14.6 and deferred. Surfaced two CONTRIBUTING.md gaps closed in passing: release procedure now documents the 100-char registry validation cap and the `mcp-publisher` local-recovery path when registry publish fails post-`npm publish`. | ~3h | ✅ shipped 2026-05-12 with v1.4.1 — listing flipped from `unlisted` to `listed` at https://smithery.ai/servers/@sidneybissoli/medical-terminologies | 11.8 |

### Planned Tools

None — Phase 11 is transport, packaging, and metadata, not new tools.
Per-tool `language` parameter (11.4) is a schema addition to existing
tools, not a new tool.

### Planned Requirements

- [x] `server.json` reflects 1.2.0 with all env vars documented (and remotes[] entry for hosted endpoint)
- [x] `--http --port N` boots Streamable HTTP transport; default remains stdio
- [x] MCP Inspector connects via `--transport streamable-http`
- [x] README has at least 3 real output samples + an audience matrix
- [x] `language` accepted as optional input on `snomed_search`, `snomed_concept`, `icd11_search`, `icd11_lookup`, `mesh_search`, `mesh_descriptor` (and propagated to upstream Accept-Language) — shipped 2026-05-11 in feat commit 3bc96b2
- [x] Listed on Glama.ai with public search visibility and license/quality/maintenance scores (License A / Quality A / Maintenance C as of 2026-05-11; ownership established via `glama.json` maintainers field — Dockerfile-based "Author verified" badge turned out to be unnecessary)
- [x] Listed on mcpservers.org (https://mcpservers.org/servers/sidneybissoli/medical-terminologies-mcp — auto-indexed via Registry; explicit category not displayed on listing page, so "Healthcare category" qualifier is partially fulfilled)
- [ ] PR merged in at least one `awesome-mcp-servers` list
- [x] Cloudflare Workers production deployment live (Stage 1: fetch handler, per-isolate cache + rate-limiter). End-to-end validated 2026-05-10 against the public URL — `/health`, `tools/list` returning 28 tools, and ICD-11 `icd11_search` returning results from WHO API after secrets were set.
- [ ] Stage 2: Workers KV cache + Durable Object rate limiter — trigger-gated
- [x] Smithery.ai listing live via URL submission, pointing at the Workers endpoint
- [ ] LobeHub plugin manifest accepted
- [x] CHANGELOG entry for 1.2.0 (HTTP transport ship)
- [x] Contract test for HTTP transport boot (`src/server.http.test.ts` — 4 tests)
- [x] Contract test for per-tool language acceptance — shipped 2026-05-11 (6 new tests in `src/clients/snomed-client.contract.test.ts` and `src/clients/mesh-client.contract.test.ts` pinning per-call override + cache-key-includes-language)

### Triggers and Cross-references

- **No external dependencies** — all sub-tasks are project-led.
- **Recommended ordering:** 11.1 first (everything else points at the
  Registry page; submitting Glama with an outdated Registry hurts
  credibility); 11.2 + 11.3 + 11.4 in parallel; 11.5–11.10 after.
- **Cross-reference:** when 11.2 + 11.4 ship, the SNOMED `Accept-Language`
  env override gets a per-tool complement, useful for hosted multi-tenant
  scenarios where the operator isn't the end user.
- **Strategy pivot recorded 2026-05-10:** original 11.8 plan was a
  `smithery.yaml` with `runtime: container` (Smithery would build the
  Dockerfile and host the container). That mode was deprecated by
  Smithery between this roadmap's authoring and 2026-05-10 — only URL
  submission (you self-host, Smithery proxies) and MCPB stdio bundles
  remain. We picked Cloudflare Workers as the hosted target (11.9
  promoted from "template/guide" to actual production deploy) under the
  working hypothesis that the project may reach 100k–3M req/mo across
  globally-distributed public-health researchers. At that scale,
  Workers' edge distribution and Paid-plan-flat pricing ($5/mo for 10M
  req) dominates Fly.io's per-VM scaling and Render's sleep-on-free-tier
  UX cost. Originally-shipped `smithery.yaml` (commit `2b5dc9e`) is
  removed in the same branch that adds the Workers deployment.

- **11.10 scope expansion recorded 2026-05-11:** original spec was a
  ~30-minute "LobeHub plugin manifest" — the assumption was a single
  metadata file submission similar to 11.5/11.6. Investigation
  uncovered that LobeHub's MCP marketplace auto-discovers from the MCP
  Registry (already done, page exists at
  https://lobehub.com/mcp/sidneybissoli-medical-terminologies-mcp) but
  the "validated" badge is gated on a server-side validator that
  checks for Tools, Prompts, AND Resources surfaces. The default
  surface in v1.2.x was tools-only. Closing the gap took three
  feat commits: MCP Prompts (3 templates), MCP Resources (3 reference
  resources), then release plumbing (badge + version bump). Shipped
  in v1.3.0 (released 2026-05-11). Effort actual: ~3h vs ~30min
  estimated — scope grew, not effort overrun.

- **Stage 1 / Stage 2 split for 11.9 recorded 2026-05-10:** PR #9 shipped
  the worker as a fetch handler with per-isolate state (Map-based cache,
  in-memory token bucket). Correct for the current traffic profile and
  unblocks the Smithery URL submission. Stage 2 (Workers KV cache +
  Durable Object rate limiter) is gated on traffic — only worth shipping
  when per-isolate state starts to bite (WHO/NLM 429s, or observable
  cache miss rate > 50%).

- **Worker shake-down learnings (2026-05-10), captured here so the next
  hosted-runtime job doesn't repeat them:**
  - `nodejs_compat` fakes `process.versions.node`, so `typeof
    process.versions.node === 'string'` returns true on Workers and a
    runtime check that branches Node-vs-other fails. Capability-detect
    instead (`typeof pino.destination === 'function'`).
  - `node-cache` is CJS and uses `require('events')`, which esbuild
    turns into a `__require()` shim that throws on Workers. Replaced
    with a Map+TTL implementation in the same `cache.ts` file; same
    public API, dep removed.
  - Workers' `process.env` polyfill bridges vars but appears not to
    bridge secrets reliably — observed against the live deploy with
    WHO_CLIENT_ID set in dashboard but undefined at runtime. Stash
    bindings on `globalThis.__MCP_ENV` in the fetch handler and read
    via a shared `src/utils/env.ts` helper that falls back to
    `process.env` for the Node path.
  - Cloudflare dashboard does NOT trim whitespace from secret names —
    a leading space in the secret name (` WHO_CLIENT_SECRET`) silently
    binds it under the wrong key. A `/debug/env` endpoint that masks
    values but reveals key names is the fastest diagnosis.

### Status

- Effort spent so far: ~25h (11.1 + 11.2 + 11.3 + 11.4 + 11.5 + 11.6 + 11.7 + 11.8 + 11.9 Stage 1 + 11.10 + 11.11)
- Effort remaining: 0h on the project-led path; Glama Dockerfile upload
  remains as a non-blocking option (the listing is already
  search-visible without it — see 11.5 row)
- Stage 2 of 11.9 (~4-6h) deferred until trigger fires
- **Directory listings: 3 of 4 — Phase 12 success criterion MET**
  (Smithery + Glama + mcpservers.org all live; punkpeye PR #6208 open,
  would push count to 4/4 on merge; wong2 is PR-restricted and N/A)
- LobeHub validator: code shipped in 1.3.0; awaiting scanner re-run to
  flip badge from "unvalidated" to "validated"
- Smithery quality grade: was 63/orange/unlisted pre-1.4.1; flipped to
  listed after 4-of-5 axes closed; final axis (outputSchema) tracked
  as Phase 14.6
- Build: 🔄 In progress — hosted endpoint live, **10 of 11 sub-tasks
  shipped** (11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9
  Stage 1, 11.10, 11.11). Only 11.9 Stage 2 remains, trigger-gated by
  traffic. Phase 11 is effectively complete for the current scope.

---

## Phase 12: Content & Outreach 📋 Planned

### Scope

Convert technical readiness (Phases 8–11) into adoption via content +
community engagement. Templates and copy-paste drafts live in
[outreach-templates.md](./outreach-templates.md); this phase tracks
which channels were engaged and the measurement framework.

The audience framing matters here: this server isn't for
practicing clinicians (they use specialized tools — UpToDate AI,
OpenEvidence, EHR-integrated assistants). The actual audience is
researchers, biomedical bibliographers, public-health analysts,
clinical informatics devs, and educators. Outreach copy should
target those audiences directly without cosplay as a clinical tool.

### Sub-tasks

| # | Sub-task | Effort | Notes |
|---|----------|--------|-------|
| 12.1 | Long-form post (Medium + Dev.to crosspost): three concrete clinical/research use cases | ~3-4 h | ✅ published 2026-05-11. Medium: https://medium.com/@sbissoli76/seven-medical-terminologies-one-mcp-server-a-practical-walkthrough-for-clinical-and-research-use-a6c46de9c83b · Dev.to: https://dev.to/sidneybissoli/seven-medical-terminologies-one-mcp-server-a-practical-walkthrough-for-clinical-and-research-use-5gia. Medium is the canonical URL — cross-references in subsequent channels (LinkedIn, Reddit, Mastodon, HN) should link here |
| 12.2 | LinkedIn post (personal feed) + crosspost to AMIA / Healthcare Informatics groups | ~1 h | Draft in outreach-templates.md |
| 12.3 | Reddit posts: r/medicalcoding, r/medicine (cautious framing — strict self-promo rules), r/healthIT | ~1-2 h | Drafts + risk notes in outreach-templates.md |
| 12.4 | Mastodon + Bluesky variants (3 angles: clinical / research / dev) | ~30 min | Drafts in outreach-templates.md |
| 12.5 | Show HN | ~30 min post + 2-3 h responding to comments | Tuesday/Wednesday morning EST. Draft in outreach-templates.md |
| 12.6 | chat.fhir.org responsive engagement (HL7 Zulip) — only when context fits, not proactive | ~15 min/day for 2 weeks | NOT a proactive post |
| 12.7 | Early-adopter outreach emails — Clinical Informatics fellows, MCP-server authors, health-tech bloggers (≤10 emails over 3 weeks; mandatory specific opener) | ~2-3 h total | Template in outreach-templates.md |
| 12.8 | Discord MCP communities (Anthropic + community Discords) | ~1 h | Announce + monitor |
| 12.9 | ResearchGate project entry (low priority) | ~30 min | Optional — academic adjacent SEO |
| 12.10 | Anthropic MCP Catalog submission (low success probability) | ~20 min | Catalog prioritizes commercial productivity tools, not data APIs |
| 12.11 | Baseline metrics captured before outreach + 60-day measurement | ~30 min capture + ~1 h review | ✅ baseline captured 2026-05-11 in [metrics-baseline.txt](./metrics-baseline.txt); 60-day review target 2026-07-10 |

### Baseline metrics to capture before starting

| Metric | Source |
|--------|--------|
| npm downloads/month | https://npm-stat.com/charts.html?package=medical-terminologies-mcp |
| GitHub stars | repo header |
| GitHub clones (traffic) | https://github.com/SidneyBissoli/medical-terminologies-mcp/graphs/traffic |
| Glama.ai listing | check (expect: not listed) |
| Smithery.ai listing | check (expect: not listed pre-11.8) |
| mcpservers.org listing | check |
| awesome-mcp-servers | grep both lists |
| Open issues + PRs | repo |
| Forks | repo |

### Success criteria (60-day review)

Outreach is successful if **at least 2 of 5** of these happen:

- npm downloads cross from current ~160/month baseline to ≥400/month sustained
- GitHub stars +30 over baseline
- ≥2 external issues or PRs from outside the immediate circle
- 1 third-party mention (blog, newsletter, video, other repo)
- Listed in ≥3 of 4 directories (Glama, Smithery, mcpservers.org, awesome-mcp-servers)

If zero of five trigger, the gap is product, not outreach. Likely
candidates: HTTP transport (if 11.2 not done), or real demand smaller
than estimated.

### Anti-metrics (don't measure success by these)

- LinkedIn likes on personal post (vanity metric)
- Mastodon boosts (amplification ≠ usage)
- Hours spent on outreach (if 30 h yields 2× downloads, hourly return is ~$0)
- Positive comments without click-through

### Planned Requirements

- [ ] All 11 channels engaged or explicitly skipped with rationale recorded
- [x] `metrics-baseline.txt` captured before any outreach starts (snapshot 2026-05-11; pkg 1.2.1; 1/4 directories listed; npm 456/30d; GH 3★/1 fork)
- [ ] 60-day review against the success criteria above (target 2026-07-10)
- [ ] Honest framing throughout: research / public-health / dev / educator audiences, not clinical-care substitution

### Triggers and Cross-references

- **Hard prerequisite:** Phase 11.1 (server.json sync) — outreach pointing
  at an outdated registry hurts credibility.
- **Recommended sequencing:** 11.1 + 11.3 → 12.1 (long post) → 12.2-12.5
  in parallel → 12.6-12.10 ongoing → 12.11 review at day 60.

### Status

- Effort: ~10–15 h spread over 4–6 weeks
- Build: N/A (no code)
- Templates: see [outreach-templates.md](./outreach-templates.md)

---

## Phase 13: Coverage Expansion 📋 Planned

### Scope

Real crosswalks (replacing text-search heuristics) plus new terminology
coverage that benefits all audiences — international users get real
ICD-10↔ICD-11 mapping and validation; Brazilian operational audiences
get TUSS / SIGTAP / CID-O which they need day-to-day; everyone gets
versioning + diff for pipeline maintenance.

This phase deliberately does **not** rebrand the project as
Brazilian — Brazilian content is a subset of international scope, not a
turning point. Same audiences, broader coverage.

### Sub-tasks

| # | Sub-task | Effort | Notes |
|---|----------|--------|-------|
| 13.1 | Real `map_icd10_to_icd11` via WHO transition tables (open download from icd.who.int/browse11/Downloads/Download); bundle as JSON via build script (same pattern as CID-10) | ~6-8 h (came in ~3h) | ✅ shipped 2026-05-11 in feat commit 33f2d0f — 2025-01 release bundled as `src/data/icd10-to-icd11.json` (5.4 MB raw / 0.95 MB gzipped), 11,243 category entries (1,461 with WHO-documented alternatives), in-memory client `ICD10ToICD11MapClient` mirrors the CID-10 pattern. Tool description rewritten to claim authoritativeness; returns null (not a fuzzy fallback) when the code isn't in the WHO category table |
| 13.2 | `validate_codes` cross-terminology validator: accepts mixed list, returns per-item `{ code, valid, active, replaced_by, source }` | ~3-4 h (came in ~2h) | ✅ shipped 2026-05-11 in feat commit a1b3b76 — accepts up to 50 `{code, terminology}` pairs per call, validated in parallel through their respective clients. Covers all 8 terminologies (icd11, icd10, snomed, loinc, rxnorm, mesh, atc, cid10). `replaced_by` populated today only for ICD-10 → ICD-11 via the bundled WHO transition tables; `active` boolean only meaningful for SNOMED (real flag) and LOINC (STATUS field). CI tool-count gate bumped 34 → 35 |
| 13.3 | CID-O (oncology) tools — dataset already in DataSUS CID10CSV.zip (`CID-O-CATEGORIAS.CSV`, `CID-O-GRUPOS.CSV`); add `cid_o_search`, `cid_o_lookup` | ~3-5 h | Audit excluded as "niche"; reversed because RHC/RCBP/INCA use it operationally |
| 13.4 | TUSS (Terminologia Unificada da Saúde Suplementar — ANS/private health) tools: `tuss_search`, `tuss_lookup`, `tuss_chapters`. Bundled static dataset (~5k items, public ANS source) | ~5-6 h | Brazilian supplementary-health analysts |
| 13.5 | SIGTAP (Sistema de Gerenciamento da Tabela de Procedimentos do SUS) tools: `sigtap_search`, `sigtap_lookup`, `sigtap_by_chapter`. Bundled with monthly refresh script (DataSUS publishes monthly) | ~6-7 h | Brazilian SUS operational analysts; larger dataset (~10k procedures with values) |
| 13.6 | Versioning + diff tools: `terminology_versions` (current versions per terminology + release dates), `terminology_diff` (codes added/retired between versions) | ~4-5 h (came in ~3h) | ✅ shipped 2026-05-11 in feat commit ae956f3 — `terminology_versions` returns metadata for all 8 terminologies (ICD-10 → ICD-11 version reads live from bundled client; rest are static); `terminology_diff` is guidance-only for terminologies without historical snapshots, but surfaces a real cross-revision summary for terminology=icd10 (1:1 vs split mappings vs avg alternatives) computed from the bundled WHO transition tables via the new `ICD10ToICD11MapClient.getStats()` method. CI tool-count gate 35 → 37 |
| 13.7 | Real `map_snomed_to_icd10` via Snowstorm refset 447562003 — full structure (`mapTarget`, `mapGroup`, `mapPriority`, `mapRule`, `mapAdvice`, `mapCategoryId`); contract test with fixture JSON | ~5-6 h | External dependency: needs (a) IHTSDO public host returning OR (b) FHIR pivot OR (c) hosted SNOMED scenario from Phase 11 |
| 13.8 | `map_cid10_to_cid11` BR variant via CBCD transition table when published | ~3-4 h | External dependency: CBCD publishing the BR ICD-11 transition table |

### Planned Tools

| Tool | Description | Source |
|------|-------------|--------|
| (refactor) `map_icd10_to_icd11` | Real WHO transition table lookup, no longer text search | 13.1 |
| validate_codes | Cross-terminology code validator | 13.2 |
| cid_o_search | CID-O text search | 13.3 |
| cid_o_lookup | CID-O code → details | 13.3 |
| tuss_search | TUSS text search | 13.4 |
| tuss_lookup | TUSS code → details | 13.4 |
| tuss_chapters | TUSS chapter navigation | 13.4 |
| sigtap_search | SIGTAP text search | 13.5 |
| sigtap_lookup | SIGTAP code → details (with values) | 13.5 |
| sigtap_by_chapter | SIGTAP chapter navigation | 13.5 |
| terminology_versions | Per-terminology version + release date | 13.6 |
| terminology_diff | Diff between two versions of a terminology | 13.6 |
| (refactor) `map_snomed_to_icd10` | Real refset 447562003 lookup | 13.7 |
| map_cid10_to_cid11 | CID-10 → CID-11 via CBCD BR transition table | 13.8 |

**Total new + refactored:** ~12 tools; net new: 11 (two refactor existing).
**Tool count after Phase 13:** ~38–40 default / ~44–46 with SNOMED.

### Planned Requirements

- [ ] WHO ICD-10 → ICD-11 transition tables bundled (build script + `src/data/icd10-to-icd11.json`)
- [ ] CID-O dataset extracted from existing DataSUS zip (no new download)
- [ ] TUSS dataset bundled with provenance documented
- [ ] SIGTAP dataset bundled + monthly refresh build script
- [ ] Versioning metadata maintained per terminology
- [ ] Contract tests for every new tool (same coverage discipline as Phases 8–10)
- [ ] Schema tests for input/output validators
- [ ] Live integration tests for the upstream-dependent tools (skipped when upstream unavailable)
- [ ] Tool count assertion in `.github/workflows/ci.yml` updated
- [ ] CHANGELOG entry per release that ships a sub-task
- [ ] README "Available Tools" section refreshed

### Triggers and Cross-references

- **13.1, 13.2, 13.3, 13.4, 13.5, 13.6:** project-led, no external blockers.
- **13.7 — `map_snomed_to_icd10` real refset (formerly an active deferral):**
  needs at least one of:
  - (a) IHTSDO or equivalent stands up a new public host with the
    Complex Map refset accessible.
  - (b) `SNOMEDClient` pivots to a FHIR terminology server (Ontoserver,
    NHS Terminology Server, etc.) — multi-tenant-friendly and open for
    some operations. Non-trivial transport change.
  - (c) Streamable HTTP transport (Phase 11.2) ships with hosted SNOMED
    licensing — operator stops being end user, becomes host.
  - (d) An operator opens an issue confirming they have Snowstorm
    running and need this mapping. Cheapest trigger to detect.
- **13.8 — `map_cid10_to_cid11` BR variant:** depends on CBCD publishing
  the official Brazilian ICD-11 transition table (work in progress at
  CBCD/USP).
- **Naïve impl warning for 13.7:** the refset is the **ICD-10 Complex Map**
  by design — not 1:1. Concepts have multiple `ReferenceSetMember`
  entries with `mapGroup`, `mapPriority`, `mapRule` (ECL-like, requires
  context evaluation), `mapAdvice` (semi-structured strings), and
  `mapCategoryId` for fallback. Implementation must surface the full
  structure literally; a `members[0].mapTarget` shortcut reproduces
  exactly the class of bug Phase 8 fixed in `map_icd10_to_icd11`.

### Status

- Effort: ~30–40 h total (split: ~25–30 h project-led, rest external-dependency-gated)
- Build: 📋 Planned

---

## Phase 14: Quality & Maintenance 📋 Ongoing

### Scope

Smaller open items + ongoing maintenance via the integration cron
established in Phase 10. This phase has no firm end date — it absorbs
upstream-drift triage and small fixes as they surface.

### Sub-tasks

| # | Sub-task | Effort | Trigger |
|---|----------|--------|---------|
| 14.1 | `loinc_answers` real fix — investigate canonical replacement (likely `loinc_form_definitions` for forms; unclear for single-observation answer lists). NLM `/loinc_answers` has been HTTP 404 in production since at least 2026-05-09 | ~3-4 h | Any user requests `loinc_answers` data |
| 14.2 | Doc consolidation sweep after Phases 11–13 ship — verify cross-refs still resolve, deprecated bullet points removed | ~1-2 h | After Phase 13 lands |
| 14.3 | Annual: WHO ICD-11 release bump when WHO publishes new release (default `WHO_ICD11_RELEASE_ID` advanced from `2024-01`) | ~30 min | WHO publication (yearly cycle) |
| 14.4 | Continuous: triage upstream-drift failures from daily integration cron (`.github/workflows/integration.yml`) | Variable | Cron failure notification |
| 14.5 | Annual: refresh `src/data/cid10.json` if DataSUS ever publishes a successor to V2008 (frozen since 2008) | ~30 min | DataSUS publishes V20XX |
| 14.6 | Close `outputSchema` gap on the 3 remaining crosswalk tools — surfaced during Smithery quality-score audit 2026-05-12. `map_icd10_to_icd11` is the hot fix: the handler already computes structured data (`entry.icd10`, `entry.primary`, `entry.alternatives`) and discards it as markdown — needs `MapICD10ToICD11OutputSchema` in `src/types/index.ts` + `structuredContent` return path + fixture in `src/types/schemas.test.ts`. `map_snomed_to_icd10` and `map_loinc_to_snomed` are guidance-only; an envelope schema (`{ status: 'guidance-only', preferred_term?, guidance: string }` style) is enough. Deferred from the 2026-05-12 Smithery polish branch so the metadata-only PR stays focused | ~70 min total | Triggered by the Smithery quality-score audit; remediates the only remaining of the 5 axes (naming/description/homepage/icon already fixed in the metadata polish) |

### Planned Requirements

- [ ] `loinc_answers` populates from `loinc_form_definitions` for form-type LOINCs (single observations may remain empty if no canonical replacement exists)
- [ ] Annual release-ID bump procedure documented in CONTRIBUTING.md
- [ ] Cron failures triaged within 1 week of notification
- [ ] All 37 default tools expose `outputSchema` + `structuredContent` (currently 34/37 — gap is 3 tools in `crosswalk.ts`)

### Triggers

- **14.1:** lazy — only when a user surfaces the gap, since current
  ~160 dl/month suggests low impact.
- **14.2:** post-Phase-13 cleanup, single sweep.
- **14.3, 14.5:** upstream-driven, predictable cadence.
- **14.4:** event-driven from CI notifications.
- **14.6:** open follow-up from the 2026-05-12 Smithery polish work;
  worth shipping before the next outreach push since output schemas
  are visible on Smithery's listing UI.

### Status

- Effort: ~5–8 h initial (mostly 14.1) + ongoing variable
- Build: 📋 Ongoing

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
