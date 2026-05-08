# Medical Terminologies MCP Server

[![npm version](https://badge.fury.io/js/medical-terminologies-mcp.svg)](https://www.npmjs.com/package/medical-terminologies-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue.svg)](https://modelcontextprotocol.io)

A Model Context Protocol (MCP) server providing unified access to major global medical terminologies:

- **ICD-11** - International Classification of Diseases (WHO)
- **SNOMED CT** - Systematized Nomenclature of Medicine
- **LOINC** - Logical Observation Identifiers Names and Codes
- **RxNorm** - Normalized names for clinical drugs (NIH)
- **MeSH** - Medical Subject Headings (NLM)

## Features

- 27 specialized tools for medical terminology lookup
- Multi-terminology support in a single server
- Cross-terminology mapping and search
- Built-in caching for improved performance
- Rate limiting to respect API limits
- Detailed responses with rich formatting

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

## Available Tools (21 by default, 27 with SNOMED enabled)

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

## Usage Examples

### Search for a diagnosis in ICD-11

```
Use icd11_search with query "type 2 diabetes mellitus"
```

### Look up a lab test in LOINC

```
Use loinc_details with loinc_num "2339-0" to get glucose test details
```

### Find drug information in RxNorm

```
Use rxnorm_search with query "metformin" then rxnorm_concept for details
```

### Search across all terminologies

```
Use find_equivalent with term "diabetes" to search ICD-11, SNOMED, LOINC, RxNorm, and MeSH
```

### Map ICD-10 to ICD-11

```
Use map_icd10_to_icd11 with icd10_code "E11" to find ICD-11 equivalents
```

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
