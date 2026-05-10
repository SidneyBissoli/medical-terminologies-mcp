# Medical Terminologies MCP Server

[![npm version](https://badge.fury.io/js/medical-terminologies-mcp.svg)](https://www.npmjs.com/package/medical-terminologies-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue.svg)](https://modelcontextprotocol.io)

A Model Context Protocol (MCP) server providing unified access to major global medical terminologies:

- **ICD-11** - International Classification of Diseases (WHO)
- **SNOMED CT** - Systematized Nomenclature of Medicine *(opt-in; requires self-hosted Snowstorm)*
- **LOINC** - Logical Observation Identifiers Names and Codes
- **RxNorm** - Normalized names for clinical drugs (NIH)
- **MeSH** - Medical Subject Headings (NLM)
- **ATC** - Anatomical Therapeutic Chemical classification (WHO Collaborating Centre, served via NLM RxClass)
- **CID-10** - Brazilian Portuguese translation of ICD-10 (DataSUS V2008, bundled)

## Features

- 28 default tools (34 with SNOMED enabled) for medical terminology lookup
- Multi-terminology support in a single server
- Cross-terminology mapping and search
- Built-in caching for improved performance
- Rate limiting to respect API limits
- Detailed responses with rich formatting

## Who is this for?

This server is **not** a clinical-care decision tool — practicing clinicians have specialized assistants (UpToDate AI, OpenEvidence, EHR-integrated tools) for that. The actual audience is researchers, public-health analysts, clinical informatics developers, and educators who need programmatic access to authoritative terminology data.

| If you're a... | Start with | Why |
|----------------|------------|-----|
| **Biomedical researcher / bibliographer** | `mesh_search`, `mesh_descriptor`, `mesh_tree` | MeSH is PubMed's indexing vocabulary; tree numbers let you traverse the controlled hierarchy programmatically |
| **Public-health analyst (Brazil / SUS)** | `cid10_search`, `cid10_chapters`, `atc_classify` | CID-10 V2008 is the Brazilian operational standard; ATC pairs cleanly with DataSUS prescription data |
| **Public-health analyst (international)** | `icd11_search`, `icd11_lookup`, `icd11_chapters` | WHO ICD-11 is the current international revision; chapters and hierarchy support pipeline classification |
| **Clinical-informatics developer** | `loinc_search`, `loinc_details`, `find_equivalent` | LOINC for lab/observation interoperability; cross-terminology search to scaffold new mappings |
| **Educator / curriculum author** | `mesh_descriptor`, `icd11_lookup`, `rxnorm_search` | Authoritative definitions, tree numbers, and drug term-types you can drop into self-checked exercises |

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
| `WHO_ICD11_RELEASE_ID` | No | ICD-11 release to query (e.g. `2024-01`, `2025-01`). Default `2024-01`. |
| `ENABLE_SNOMED_TOOLS` | No² | Set to `true` to register the 6 SNOMED-dependent tools. Default off. |
| `SNOMED_BASE_URL` | No² | Base URL for a Snowstorm instance, e.g. `https://my-snowstorm.example.com/snowstorm/snomed-ct`. |
| `SNOMED_LANGUAGE` | No² | Accept-Language tag(s) for SNOMED responses, e.g. `pt`, `pt-BR`, `es`. Default `en`. Single-tag values are pass-through reliably; composite values with q-weights (e.g. `pt-BR,en;q=0.8`) depend on your Snowstorm instance's Accept-Language handling — fallback semantics may vary. Test against your specific deployment if relying on weighted fallback. |
| `LOG_LEVEL` | No | pino log level (`debug`, `info`, `warn`, `error`, `fatal`). Default `info`. |

¹ Required for ICD-11 tools. Get credentials at: https://icd.who.int/icdapi.

² See [SNOMED CT setup (advanced)](#snomed-ct-setup-advanced) below. LOINC, RxNorm, and MeSH need no configuration.

## Available Tools (28 by default, 34 with SNOMED enabled)

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

### Crosswalk Tools (4 — `map_snomed_to_icd10` requires SNOMED)

| Tool | Description | Example |
|------|-------------|---------|
| `map_icd10_to_icd11` | Text search ICD-11 using an ICD-10 code (not authoritative; see [WHO transition tables](https://icd.who.int/browse11/Downloads/Download)) | `icd10_code: "E11"` |
| `map_snomed_to_icd10` | SNOMED CT → ICD-10 guidance (only when `ENABLE_SNOMED_TOOLS=true`) | `sctid: "73211009"` |
| `map_loinc_to_snomed` | LOINC ↔ SNOMED guidance | `loinc_code: "2339-0"` |
| `find_equivalent` | Cross-terminology search; SNOMED branch is skipped when SNOMED tools are disabled | `term: "diabetes"` |

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

The 5 SNOMED tools (`snomed_search`, `snomed_concept`, `snomed_hierarchy`, `snomed_descriptions`, `snomed_ecl`) plus the SNOMED-dependent crosswalk tool (`map_snomed_to_icd10`) are **disabled by default**. With them disabled, the server registers 21 tools instead of 27; `find_equivalent` still works and skips the SNOMED branch with an explanatory note.

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

### ICD-11 (WHO)

ICD-11 content is provided under the [Creative Commons Attribution-NoDerivatives 3.0 IGO license (CC BY-ND 3.0 IGO)](https://creativecommons.org/licenses/by-nd/3.0/igo/).

- You must attribute WHO as the source
- You may not create derivative works
- API access requires registration at https://icd.who.int/icdapi

### SNOMED CT

SNOMED CT use requires an IHTSDO (SNOMED International) license. The SNOMED tools in this server are disabled by default and only enabled by operators with a valid license and a self-hosted Snowstorm instance — see [SNOMED CT setup (advanced)](#snomed-ct-setup-advanced).

- Member countries have national licenses
- Affiliate licenses available for others
- More info: https://www.snomed.org/snomed-ct/get-snomed

### LOINC

LOINC content is provided under the [LOINC License](https://loinc.org/license/).

- Free for most uses
- Attribution required
- Registration recommended

### RxNorm

RxNorm is produced by the U.S. National Library of Medicine and is freely available.

- No license required for use
- Attribution appreciated

### MeSH

MeSH is produced by the U.S. National Library of Medicine and is freely available.

- No license required for use
- Attribution appreciated

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
