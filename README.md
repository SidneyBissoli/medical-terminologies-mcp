# Medical Terminologies MCP Server

[![npm version](https://img.shields.io/npm/v/medical-terminologies-mcp.svg)](https://www.npmjs.com/package/medical-terminologies-mcp)
[![npm downloads](https://img.shields.io/npm/dm/medical-terminologies-mcp.svg)](https://www.npmjs.com/package/medical-terminologies-mcp)
[![node](https://img.shields.io/node/v/medical-terminologies-mcp)](https://www.npmjs.com/package/medical-terminologies-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-blue)](https://registry.modelcontextprotocol.io)
[![LobeHub](https://lobehub.com/badge/mcp/sidneybissoli-medical-terminologies-mcp)](https://lobehub.com/mcp/sidneybissoli-medical-terminologies-mcp)
[![smithery badge](https://smithery.ai/badge/sidneybissoli/medical-terminologies-mcp)](https://smithery.ai/servers/sidneybissoli/medical-terminologies-mcp)
[![Glama MCP server](https://glama.ai/mcp/servers/SidneyBissoli/medical-terminologies-mcp/badges/score.svg)](https://glama.ai/mcp/servers/SidneyBissoli/medical-terminologies-mcp)
[![Available on CodeGuilds](https://img.shields.io/badge/Available_on-CodeGuilds-6366f1)](https://codeguilds.dev/packages/medical-terminologies-mcp)
[![GitHub stars](https://img.shields.io/github/stars/SidneyBissoli/medical-terminologies-mcp?style=flat&logo=github)](https://github.com/SidneyBissoli/medical-terminologies-mcp)
[![GitHub Sponsors](https://img.shields.io/github/sponsors/SidneyBissoli?logo=githubsponsors&label=Sponsor&color=db61a2)](https://github.com/sponsors/SidneyBissoli)
[![tool calls](https://img.shields.io/endpoint?url=https%3A%2F%2Fmedical.sidneybissoli.com%2Fstats%2Fbadge)](https://medical.sidneybissoli.com/stats)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue.svg)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A Model Context Protocol (MCP) server providing unified access to major global medical terminologies:

- **ICD-11** - International Classification of Diseases (WHO)
- **SNOMED CT** - Systematized Nomenclature of Medicine *(opt-in; requires self-hosted Snowstorm)*
- **LOINC** - Logical Observation Identifiers Names and Codes
- **RxNorm** - Normalized names for clinical drugs (NIH)
- **MeSH** - Medical Subject Headings (NLM)
- **ATC** - Anatomical Therapeutic Chemical classification (WHO Collaborating Centre, served via NLM RxClass)
- **CID-10** - Brazilian Portuguese translation of ICD-10 (DataSUS V2008, bundled)

🇧🇷 [Leia em Português](README.pt-BR.md)

## See it in action

Ask your assistant:

- *"What's the ICD-11 code for type 2 diabetes?"* → `icd11_search`
- *"Map ICD-10 code E11 to ICD-11."* → `map_icd10_to_icd11`
- *"What does LOINC 2339-0 measure?"* → `loinc_details`
- *"Qual o código CID-10 para infarto agudo do miocárdio?"* → `cid10_search`

The answers come from authoritative sources (WHO, NLM, NIH, DataSUS) — real codes and mappings, not guesses from training data.

## Features

- 33 default tools (39 with SNOMED enabled): 31 terminology tools plus `search`/`fetch` for ChatGPT Deep Research
- 3 MCP **Prompts** that orchestrate tool calls into named workflows (`find-medical-code`, `drug-info`, `cid10-portuguese-lookup`) — clients render these as one-click user actions
- 4 MCP **Resources** for in-process reference content (`info://server`, `info://cid10/chapters`, `info://licenses`, `info://stats`) — sub-millisecond reads (except `info://stats` which round-trips to the StatsCounter Durable Object on the hosted endpoint)
- Multi-terminology support in a single server
- Cross-terminology mapping and search
- **Provenance on every response** (since v1.8.0): each successful tool result carries a machine-readable provenance block — source, canonical URL, data vintage, real extraction instant (cache hits keep the original fetch instant), ready-to-use citation, and license — in `structuredContent.provenance` + `attribution`, mirrored in `_meta` under `com.sidneybissoli.medical/*`, with a compact text footer for text-only clients. Multi-source responses (`find_equivalent`, `validate_codes`) carry one block per source; server-computed ranking fields are flagged as derived
- Built-in caching for improved performance
- Rate limiting to respect API limits
- Detailed responses with rich formatting
- Two transports: **stdio** (default; for Claude Desktop, IDE clients) and **Streamable HTTP** (the hosted Cloudflare Worker at `https://medical.sidneybissoli.com/mcp`, or your own instance of `worker/`)

📖 **Article (in Portuguese):** [CID-10, CID-11 e o que muda para quem trabalha com dados do SUS](docs/artigo-cid10-e-cid11-no-sus.pt-BR.md) — the V2008 structure in numbers, what the WHO transition tables are and are not, and the licences that differ between sources. Also published on the site, in Portuguese and English: [sidneybissoli.com](https://sidneybissoli.com/en/blog/posts/cid10-cid11-sus/).

## Who is this for?

This server is **not** a clinical-care decision tool — practicing clinicians have specialized assistants (UpToDate AI, OpenEvidence, EHR-integrated tools) for that. The actual audience is researchers, public-health analysts, clinical informatics developers, and educators who need programmatic access to authoritative terminology data.

| If you're a... | Start with | Why |
|----------------|------------|-----|
| **Biomedical researcher / bibliographer** | `mesh_search`, `mesh_descriptor`, `mesh_tree` | MeSH is PubMed's indexing vocabulary; tree numbers let you traverse the controlled hierarchy programmatically |
| **Public-health analyst (Brazil / SUS)** | `cid10_search`, `cid10_chapters`, `atc_classify` | CID-10 V2008 is the Brazilian operational standard; ATC pairs cleanly with DataSUS prescription data |
| **Public-health analyst (international)** | `icd11_search`, `icd11_lookup`, `icd11_chapters` | WHO ICD-11 is the current international revision; chapters and hierarchy support pipeline classification |
| **Clinical-informatics developer** | `loinc_search`, `loinc_details`, `find_equivalent` | LOINC for lab/observation interoperability; cross-terminology search to scaffold new mappings |
| **Educator / curriculum author** | `mesh_descriptor`, `icd11_lookup`, `rxnorm_search` | Authoritative definitions, tree numbers, and drug term-types you can drop into self-checked exercises |

## Try the hosted instance (no install)

A public Cloudflare Workers deployment runs at:

```
https://medical.sidneybissoli.com/mcp
```

Connect via the MCP Inspector or any Streamable HTTP MCP client:

```bash
npx @modelcontextprotocol/inspector --transport streamable-http \
  --server-url https://medical.sidneybissoli.com/mcp
```

Or install via Smithery, which proxies the same endpoint through their gateway:

```bash
npx -y smithery mcp add sidneybissoli/medical-terminologies-mcp
```

The hosted instance has WHO credentials configured, so all 33 default tools work without any setup on your side. For your own deployment (e.g. corporate network, different region, custom WHO credentials), see the [Installation](#installation) and [Hosted on Cloudflare Workers](#hosted-on-cloudflare-workers-primary) sections below.

## Installation

### Global Installation (Recommended)

```bash
npm install -g medical-terminologies-mcp
```

### Local Installation

```bash
npm install medical-terminologies-mcp
```

## Configuration

### Claude Desktop

Add to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "medical-terminologies": {
      "command": "npx",
      "args": ["-y", "medical-terminologies-mcp"],
      "env": {
        "WHO_CLIENT_ID": "your-who-client-id",
        "WHO_CLIENT_SECRET": "your-who-client-secret"
      }
    }
  }
}
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `WHO_CLIENT_ID` | Yes¹ | WHO ICD API Client ID |
| `WHO_CLIENT_SECRET` | Yes¹ | WHO ICD API Client Secret |
| `WHO_ICD11_RELEASE_ID` | No | ICD-11 release to query (e.g. `2025-01`, `2026-01`). Default `2026-01`. |
| `ENABLE_SNOMED_TOOLS` | No² | Set to `true` to register the 6 SNOMED-dependent tools. Default off. |
| `SNOMED_BASE_URL` | No² | Base URL for a Snowstorm instance, e.g. `https://my-snowstorm.example.com/snowstorm/snomed-ct`. |
| `SNOMED_LANGUAGE` | No² | Accept-Language tag(s) for SNOMED responses, e.g. `pt`, `pt-BR`, `es`. Default `en`. Single-tag values are pass-through reliably; composite values with q-weights (e.g. `pt-BR,en;q=0.8`) depend on your Snowstorm instance's Accept-Language handling — fallback semantics may vary. Test against your specific deployment if relying on weighted fallback. |
| `LOG_LEVEL` | No | pino log level (`debug`, `info`, `warn`, `error`, `fatal`). Default `info`. |

¹ Required for ICD-11 tools. Get credentials at: https://icd.who.int/icdapi.

² See [SNOMED CT setup (advanced)](#snomed-ct-setup-advanced) below. LOINC, RxNorm, and MeSH need no configuration.

### HTTP transport (hosted)

The server runs over stdio by default — that's what Claude Desktop and IDE clients expect. The Streamable HTTP transport is served by the Cloudflare Worker in `worker/` (an instance of the maintainer's Fase 0 hosting template). The `--http` flag of the Node entry was removed in v1.6.0 — if you need a local HTTP endpoint, run the Worker locally:

```bash
npm ci && cd worker && npm ci
npm run dev     # wrangler dev on http://localhost:8787
# Inspector via HTTP
npx @modelcontextprotocol/inspector --transport streamable-http --server-url http://localhost:8787/mcp
```

Hosted endpoints (production and local alike):

- `POST /mcp` — JSON-RPC over Streamable HTTP (the MCP protocol). Stateless mode: each request is independent.
- `GET /health` — liveness probe returning `{ status, name, version, tool_count, uptime_s }`.
- `GET /status` — version + deploy metadata. `GET /metrics` — aggregated per-tool usage.
- `GET /stats` and `GET /stats/badge` — public tool-call counter (since 2026-05-13) and its shields.io badge.
- `GET /.well-known/mcp/server-card.json` — static server card for registry scanners.
- CORS is permissive (`*`) so browser clients (e.g. the MCP Inspector web UI) can connect directly.

### ChatGPT (Deep Research)

ChatGPT deep research (and company knowledge, and research workflows over the Responses API) only uses an MCP server that exposes exactly `search` and `fetch` — this server does, on top of the terminology tools. Point the connector at the hosted endpoint, no key required:

```
https://medical.sidneybissoli.com/mcp
```

`search` ranks the query across the bundled CID-10 (categories, subcategories, chapters), the terminology version records and a live fan-out to ICD-11, LOINC, RxNorm and MeSH (the same fan-out `find_equivalent` does; a source that fails is skipped) and returns `{ id, title, url }`; `fetch` renders the document through the terminology's own lookup tool (`cid10_lookup`, `icd11_lookup`, `loinc_details`, `rxnorm_concept`, `mesh_descriptor`, `terminology_versions`) as readable Markdown with the canonical public page (WHO ICD browsers, loinc.org, RxNav, MeSH Browser), which is what ChatGPT cites. Both carry the same provenance block as every other tool — `search` one block per source that answered, like `find_equivalent`. SNOMED is not part of the corpus (its public browser retired, so there is no page to cite). In ChatGPT's developer mode (Settings → Security and login → Developer mode) any tool is callable — the terminology tools remain the ones to use for data.

### Hosted on Cloudflare Workers (primary)

The production deployment is the Cloudflare Worker in `worker/`, config in `worker/wrangler.jsonc`, CI deploy in `.github/workflows/deploy-worker.yml` (auto-runs on every push to `main`).

To deploy your own instance:

```bash
npm ci && npm run build:worker-lib
cd worker && npm ci
npx wrangler login         # one-time, browser flow
npx wrangler deploy        # publishes to <name>.<account>.workers.dev
# Set ICD-11 secrets so those 5 tools work:
npx wrangler secret put WHO_CLIENT_ID
npx wrangler secret put WHO_CLIENT_SECRET
```

Note: `worker/wrangler.jsonc` pins the maintainer's `account_id` and custom domain route — remove/replace both for your own deployment.

Why Workers: zero cold start at the edge, $5/mo flat for 10M requests (free tier covers up to 100k req/day), and no VMs to size or restart. The template ships per-IP rate limiting and a usage-stats Durable Object; the upstream-facing cache/rate-limiter are per-isolate (PROGRESS.md Phase 11.9 Stage 2 tracks the KV/DO upgrade).

### Listing on Smithery

After your Worker is live, register the URL on Smithery:

1. Visit https://smithery.ai → **Publish → MCP** (or `https://smithery.ai/new`).
2. Pick the **URL** submission path (Smithery deprecated container hosting in 2024 — URL is the supported flow now).
3. Paste `https://<your-worker>.workers.dev/mcp`. Smithery's gateway scans for compliance and proxies traffic.

## Available Tools (33 by default, 39 with SNOMED enabled)

### Official Portuguese (pt-BR) content

The server never machine-translates terminology content — but several sources publish official translations, and the tools expose them:

- **CID-10 is natively Portuguese**: `cid10_search` / `cid10_lookup` / `cid10_chapter(s)` serve the DataSUS V2008 dataset (the CID-10 the Brazilian SUS uses operationally).
- **ICD-11 in official Portuguese**: pass `language: "pt"` to `icd11_search` / `icd11_lookup` to search and read WHO's official pt-BR linearization labels.
- **MeSH**: pass `language: "pt"` to `mesh_search` / `mesh_descriptor` to request NLM's official translations where they exist.
- **SNOMED CT** (when enabled): `language` requests the descriptions loaded in your Snowstorm edition (e.g. a national extension's pt-BR refset).

If a source has no official translation for an entry, you get the source language back — never a machine translation.

### ICD-11 Tools (5)

| Tool | Description | Example |
|------|-------------|---------|
| `icd11_search` | Search ICD-11 by term | `query: "diabetes mellitus"` |
| `icd11_lookup` | Get entity details by code/URI | `code: "5A11"` |
| `icd11_hierarchy` | Navigate parent/child relationships | `code: "5A11"` |
| `icd11_chapters` | List all ICD-11 chapters | - |
| `icd11_postcoordination` | Get postcoordination axes | `code: "5A11"` |

### LOINC Tools (4)

| Tool | Description | Example |
|------|-------------|---------|
| `loinc_search` | Search lab tests and observations | `query: "glucose"` |
| `loinc_details` | Get full LOINC code details | `loinc_num: "2339-0"` |
| `loinc_answers` | Get answer list for surveys | `loinc_num: "44249-1"` |
| `loinc_panels` | Get panel/form structure | `loinc_num: "24331-1"` |

### RxNorm Tools (5)

| Tool | Description | Example |
|------|-------------|---------|
| `rxnorm_search` | Search drugs by name | `query: "metformin"` |
| `rxnorm_concept` | Get drug concept details | `rxcui: "6809"` |
| `rxnorm_ingredients` | Get active ingredients | `rxcui: "6809"` |
| `rxnorm_classes` | Get therapeutic classes | `rxcui: "6809"` |
| `rxnorm_ndc` | Map between RxCUI and NDC | `rxcui: "6809"` |

### MeSH Tools (4)

| Tool | Description | Example |
|------|-------------|---------|
| `mesh_search` | Search MeSH descriptors | `query: "hypertension"` |
| `mesh_descriptor` | Get descriptor details | `mesh_id: "D006973"` |
| `mesh_tree` | Get tree hierarchy location | `mesh_id: "D006973"` |
| `mesh_qualifiers` | Get allowed qualifiers | `mesh_id: "D006973"` |

### SNOMED CT Tools (5, disabled by default)

These are only registered when `ENABLE_SNOMED_TOOLS=true`. See [SNOMED CT setup (advanced)](#snomed-ct-setup-advanced).

| Tool | Description | Example |
|------|-------------|---------|
| `snomed_search` | Search concepts by term | `query: "myocardial infarction"` |
| `snomed_concept` | Get concept details by SCTID | `sctid: "22298006"` |
| `snomed_hierarchy` | Get parent/child concepts | `sctid: "22298006"` |
| `snomed_descriptions` | Get all descriptions | `sctid: "22298006"` |
| `snomed_ecl` | Execute ECL queries | `ecl: "<< 73211009"` |

### Crosswalk Tools (5 — `map_snomed_to_icd10` requires SNOMED)

| Tool | Description | Example |
|------|-------------|---------|
| `map_icd10_to_icd11` | Authoritative ICD-10 → ICD-11 mapping via bundled WHO transition tables; returns primary code + chapter + URIs and any WHO-documented alternatives | `icd10_code: "E11"` |
| `map_snomed_to_icd10` | SNOMED CT → ICD-10 guidance (only when `ENABLE_SNOMED_TOOLS=true`) | `sctid: "73211009"` |
| `map_loinc_to_snomed` | LOINC ↔ SNOMED guidance | `loinc_code: "2339-0"` |
| `validate_codes` | Batch-validate up to 100 codes across ICD-11, LOINC, RxNorm, MeSH, ATC, CID-10 (and SNOMED when enabled); returns per-code valid/invalid + display name | `codes: [{terminology:"icd11",code:"5A11"}, …]` |
| `find_equivalent` | Ranked unified search across terminologies: server-computed `match_score`/`rank` per candidate plus cross-terminology `groups` of lexically identical titles; SNOMED branch is skipped when SNOMED tools are disabled | `term: "diabetes"` |

### ATC Tools (3)

WHO Anatomical Therapeutic Chemical classification, served through NLM RxClass (free, no auth). The WHOCC base itself requires a paid subscription, but RxClass envelopes the same code/name pairs.

| Tool | Description | Example |
|------|-------------|---------|
| `atc_classify` | Drug name → ATC code(s) | `drug_name: "metformin"` |
| `atc_lookup` | ATC code (level 1-4) → name + level type | `atc_code: "A10BA"` |
| `atc_members` | ATC class → member drugs | `atc_code: "A10BA"` |

### CID-10 Tools (4)

Brazilian Portuguese translation of ICD-10 (DataSUS V2008). Bundled as a static dataset — no HTTP calls. The Brazilian SUS uses CID-10 V2008 operationally; for the international ICD-11 (current WHO revision), use the ICD-11 tools above.

| Tool | Description | Example |
|------|-------------|---------|
| `cid10_search` | Portuguese text search (diacritic-insensitive) | `query: "diabetes"` |
| `cid10_lookup` | Code → official Portuguese name | `code: "I21"` or `"A00.1"` |
| `cid10_chapters` | List the 22 CID-10 chapters | - |
| `cid10_chapter` | Chapter detail with constituent groups | `num: 9` |

### Versioning Tools (2)

Surface what version of each terminology this server queries against today — useful when running batch validation against a pinned release or when investigating an unexpected lookup miss after an upstream update.

| Tool | Description | Example |
|------|-------------|---------|
| `terminology_versions` | List all 8 supported terminologies with current version, release date, publisher, source URL, and update cadence | - |
| `terminology_diff` | Report what diff data is available between two versions of a terminology (real cross-revision stats for ICD-10 → ICD-11; guidance otherwise) | `terminology: "icd10-icd11"` |

### ChatGPT Deep Research (2)

The OpenAI Deep Research contract — the only two tools without a terminology prefix (names fixed by OpenAI). See [ChatGPT (Deep Research)](#chatgpt-deep-research) above.

| Tool | Description | Example |
|------|-------------|---------|
| `search` | Searches the catalog (CID-10, ICD-11, LOINC, RxNorm, MeSH, terminology versions) and returns `{ id, title, url }` ranked by relevance | `query: "myocardial infarction"` |
| `fetch` | Returns the full document of an id from `search` (`{ id, title, text, url, metadata }`), rendered by the terminology's lookup tool | `id: "cid10:I21.0"` |

## Example Outputs

The samples below are the actual formatted output the tools produce — the text body of the `CallToolResult`. Tools also return a `structuredContent` object matching each tool's `outputSchema` for programmatic consumers.

### `loinc_search` — query: "glucose", max_results: 3

```markdown
## LOINC Search Results for "glucose"

Found 1024 total results (showing 3):

1. **74790-7** - Glucose challenge (hydrogen breath test) panel - Exhaled gas
   Component: Glucose challenge panel | Method: -

2. **104708-3** - Deprecated Estimated average glucose [Moles/volume] in Blood
   Component: Estimated average glucose | Property: SCnc

3. **97510-2** - Glucose measurements in range out of Total glucose measurements during reporting period
   Component: Glucose measurements in range/Total glucose measurements | Property: NFr | Method: Calculated
```

`total_count` (1024) reflects every match in the NLM Clinical Tables index, not just the page returned. Bump `max_results` (max 50) to see canonical codes like `2339-0` (Glucose [Mass/volume] in Blood); the API's relevance ranking puts panels and derived measurements above plain blood-glucose at small page sizes.

### `rxnorm_ingredients` — rxcui: "6809" (metformin)

```markdown
# Ingredients for RxCUI 6809

Found 18 ingredient(s):

| RxCUI | Name | Type |
|-------|------|------|
| 6809 | metformin | Single Ingredient |
| 1007411 | chlorpropamide / metformin | Multiple Ingredient |
| 1043562 | metformin / saxagliptin | Multiple Ingredient |
| 1243019 | linagliptin / metformin | Multiple Ingredient |
| 1486436 | dapagliflozin / metformin | Multiple Ingredient |
| 1545149 | canagliflozin / metformin | Multiple Ingredient |
| 1664314 | empagliflozin / metformin | Multiple Ingredient |
| 729717  | metformin / sitagliptin | Multiple Ingredient |
| ...     | (10 more combinations)   | Multiple Ingredient |
```

For an RxCUI that is itself an ingredient (TTY=IN), the tool returns that ingredient plus every multi-ingredient (TTY=MIN) concept that includes it. Use this to enumerate combination products built around a substance.

### `mesh_descriptor` — mesh_id: "D006973" (Hypertension)

```markdown
# Hypertension
MeSH ID: D006973

## Scope Note

Persistently high systemic arterial BLOOD PRESSURE. Based on multiple readings (BLOOD PRESSURE DETERMINATION), hypertension is currently defined as when SYSTOLIC PRESSURE is consistently greater than 140 mm Hg or when DIASTOLIC PRESSURE is consistently 90 mm Hg or more.

## Tree Numbers

- C14.907.489

## Concepts

- Hypertension *(preferred)*

## Allowed Qualifiers

35 qualifier(s) allowed. Use mesh_qualifiers for details.
```

The scope note comes from the descriptor's *preferred concept*, not its annotation field (which is an indexer-facing note). Tree numbers are the navigable path into MeSH's controlled hierarchy — `C14.907.489` places Hypertension under Cardiovascular Diseases → Vascular Diseases.

## Common Workflows

- **ICD-11 lookup:** `icd11_search` with a clinical term → pick the result → `icd11_lookup` with the code for full details, or `icd11_hierarchy` to walk parents/children.
- **Drug pipeline:** `rxnorm_search` for a brand or generic name → `rxnorm_concept` for the canonical record → `rxnorm_ingredients` and `rxnorm_classes` for downstream analysis.
- **Cross-terminology scaffolding:** `find_equivalent` with a clinical term searches ICD-11, LOINC, RxNorm, MeSH, and (when enabled) SNOMED in one call. Use it to bootstrap mappings; the pairwise `map_*` tools refine them.
- **ICD-10 → ICD-11 (text search, not authoritative):** `map_icd10_to_icd11` does honest text search against WHO ICD-11. Real WHO transition tables are tracked in [PROGRESS.md Phase 13.1](./PROGRESS.md).

## SNOMED CT setup (advanced)

The 5 SNOMED tools (`snomed_search`, `snomed_concept`, `snomed_hierarchy`, `snomed_descriptions`, `snomed_ecl`) plus the SNOMED-dependent crosswalk tool (`map_snomed_to_icd10`) are **disabled by default**. With them disabled, the server registers 33 tools instead of 39; `find_equivalent` still works and skips the SNOMED branch with an explanatory note.

The reason: as of 2026-05-08, the public IHTSDO Snowstorm endpoint that this project historically called (`https://browser.ihtsdotools.org/snowstorm/snomed-ct/...`) returns HTTP 410 Gone for every path. Without a working backend, registering these tools surfaces 6 guaranteed-broken tools to every client.

To enable the SNOMED tools:

1. **Confirm your SNOMED CT license.** SNOMED CT use requires an SNOMED International (IHTSDO) license. Member country residents typically have one through their national release center; non-members can obtain an Affiliate license. See https://www.snomed.org/snomed-ct/get-snomed.

2. **Run a Snowstorm instance.** SNOMED International publishes Snowstorm as open source ([IHTSDO/snowstorm](https://github.com/IHTSDO/snowstorm)) and as a Docker image ([`snomedinternational/snowstorm`](https://hub.docker.com/r/snomedinternational/snowstorm)). Self-hosting requires importing an RF2 release file (provided to license holders).

3. **Configure this server:**

   ```json
   {
     "mcpServers": {
       "medical-terminologies": {
         "command": "npx",
         "args": ["-y", "medical-terminologies-mcp"],
         "env": {
           "WHO_CLIENT_ID": "...",
           "WHO_CLIENT_SECRET": "...",
           "ENABLE_SNOMED_TOOLS": "true",
           "SNOMED_BASE_URL": "https://my-snowstorm.example.com/snowstorm/snomed-ct",
           "SNOMED_LANGUAGE": "en"
         }
       }
     }
   }
   ```

   `SNOMED_BASE_URL` should point at the base under which Snowstorm exposes its `/MAIN/concepts` and related endpoints. `SNOMED_LANGUAGE` accepts standard `Accept-Language` tags (e.g. `pt`, `es`, `pt-BR,en;q=0.8`) — Snowstorm returns localized terms when the branch has them and falls back to English otherwise.

4. **Restart the MCP client** so the server picks up the env vars.

If you set `ENABLE_SNOMED_TOOLS=true` without configuring a working Snowstorm, the SNOMED tools will register but every call will fail at the network layer.

## Terminology Licenses

The MIT license covers the server code and server-maintained metadata
only — **not** the terminology content served through it, and **not**
the two bundled datasets (`cid10.json`, `icd10-to-icd11.json`), which
remain under their own terms. The consolidated notice ships with the
package as [NOTICE.md](./NOTICE.md); every tool response carries a
per-source provenance block with the applicable license.

### ICD-11 (WHO)

ICD-11 content is provided under the [Creative Commons Attribution-NoDerivatives 3.0 IGO license (CC BY-ND 3.0 IGO)](https://creativecommons.org/licenses/by-nd/3.0/igo/), per the [ICD-11 Terms of Use and License Agreement](https://icd.who.int/en/docs/icd11-license.pdf).

- Required citation: *"International Classification of Diseases, Eleventh Revision (ICD-11), World Health Organization (WHO) 2019 https://icd.who.int/browse11. Licensed under the Creative Commons Attribution-NoDerivatives 3.0 IGO licence (CC BY-ND 3.0 IGO)."*
- This server always serves ICD-11 codes and titles together with their URIs, verbatim; non-English labels are WHO's own official translations (never machine-translated)
- WHO may terminate the license at any time by notice (§4.7)
- API access requires registration at https://icd.who.int/icdapi

### WHO ICD-10 → ICD-11 transition tables (bundled)

Format conversion (TSV → JSON, content unaltered) of the tables WHO publishes within the ICD-11 release. © World Health Organization, under the ICD-11 Terms of Use — not under this project's MIT license. WHO's guidance: the tables show correspondence between revisions and *"are not intended for directly converting data from one revision to the other."*

### CID-10 V2008 (DataSUS / CBCD, bundled)

© World Health Organization; Brazilian Portuguese translation © CBCD / Faculdade de Saúde Pública da USP; electronic files published by DataSUS (Ministério da Saúde do Brasil). DataSUS/CBCD permission: developers may use the files **with due credit and at no charge** — this server serves them free with credit in every response. Not under this project's MIT license.

### SNOMED CT

SNOMED CT use requires an IHTSDO (SNOMED International) license. The SNOMED tools in this server are disabled by default and only enabled by operators with a valid license and a self-hosted Snowstorm instance — see [SNOMED CT setup (advanced)](#snomed-ct-setup-advanced).

- Member countries have national licenses
- Affiliate licenses available for others (Brazil is not a member country)
- More info: https://www.snomed.org/get-snomed

### LOINC

This material contains content from LOINC (http://loinc.org). LOINC is copyright © Regenstrief Institute, Inc. and the Logical Observation Identifiers Names and Codes (LOINC) Committee and is available at no cost under the license at http://loinc.org/license. LOINC® is a registered United States trademark of Regenstrief Institute, Inc.

- Served via the free NLM Clinical Tables API; every code comes with its official display name
- Terms with third-party copyright are served with their notice passed through verbatim

### RxNorm

RxNorm is produced by the U.S. National Library of Medicine; the RxNav APIs serve non-proprietary, public-domain RxNorm content free of charge.

> This product uses publicly available data from the U.S. National Library of Medicine (NLM), National Institutes of Health, Department of Health and Human Services; NLM is not responsible for the product and does not endorse or recommend this or any other product.

### ATC (via NLM RxClass)

ATC classification © WHO Collaborating Centre for Drug Statistics Methodology (https://atcddd.fhi.no/), retrieved via NLM RxClass and served verbatim. This server never redistributes the WHOCC ATC/DDD index.

### MeSH

MeSH is a U.S. government work served under the [NLM Terms and Conditions](https://www.nlm.nih.gov/databases/download/terms_and_conditions.html). Courtesy of the U.S. National Library of Medicine.

## API Rate Limits

This server implements rate limiting to respect API providers:

| API | Rate Limit |
|-----|------------|
| WHO ICD-11 | 5 requests/second |
| NLM (LOINC, MeSH) | 10 requests/second |
| RxNorm | 20 requests/second |
| SNOMED CT (Snowstorm) | 10 requests/second |

## Development

### Building from source

```bash
git clone https://github.com/SidneyBissoli/medical-terminologies-mcp.git
cd medical-terminologies-mcp
npm install
npm run build
```

### Running locally

```bash
npm start
```

### Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Author

**Sidney Bissoli**

- GitHub: [@SidneyBissoli](https://github.com/SidneyBissoli)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

Note: While this software is MIT licensed, the medical terminologies accessed through it have their own licenses (see [Terminology Licenses](#terminology-licenses) above).

## Acknowledgments

- [WHO](https://www.who.int/) for the ICD-11 API
- [Regenstrief Institute](https://loinc.org/) for LOINC
- [U.S. National Library of Medicine](https://www.nlm.nih.gov/) for RxNorm and MeSH
- [SNOMED International](https://www.snomed.org/) for SNOMED CT
- [Anthropic](https://www.anthropic.com/) for the Model Context Protocol

## Support

If you encounter any issues or have questions:

- Open an issue on [GitHub](https://github.com/SidneyBissoli/medical-terminologies-mcp/issues)
- Check existing issues for solutions

---

Made with love for the medical informatics community
