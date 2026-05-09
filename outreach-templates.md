# Outreach Templates

> Copy-paste-ready drafts for the channels listed in PROGRESS.md
> Phase 12 (Content & Outreach). Originally drafted on 2026-05-09 as
> part of `roadmap.md`; folded into this file when PROGRESS.md absorbed
> roadmap.md as Phase 12.
>
> **Tool counts and version numbers in these drafts reflect the project
> state when each template was last refreshed.** Quick verification
> before publishing: current state is **28 tools default / 34 with
> SNOMED enabled, v1.1.0, 243-test Vitest suite**. Refresh inline if
> any of these have changed.
>
> Templates assume Phase 11.1 (server.json sync to 1.1.0) and Phase 11.3
> (README polish with output samples) are done. Don't publish before
> those — outreach pointing to an outdated registry or a text-only
> README hurts credibility.

---

## A.1 — PR to `awesome-mcp-servers`

**PR title:** *Add medical-terminologies-mcp to Healthcare/Medical*

**Branch:** `add-medical-terminologies-mcp`

**Diff (style of `punkpeye/awesome-mcp-servers`):**

```markdown
- [SidneyBissoli/medical-terminologies-mcp](https://github.com/SidneyBissoli/medical-terminologies-mcp) 📇 🏠 - Unified MCP server for ICD-11 (WHO), LOINC, RxNorm, MeSH (NLM), ATC, CID-10 (DataSUS), and optional SNOMED CT. 28 tools by default (34 with SNOMED), structured outputs on most tools, contract + integration tested.
```

(Verify which emojis the destination repo uses; `punkpeye/awesome-mcp-servers`
historically used 📇 for "official integration" and 🏠 for "self-hosted".)

**PR body:**

> Adding `medical-terminologies-mcp`, an open-source MCP server I've
> been maintaining that wraps seven major medical terminology APIs:
> ICD-11 (WHO), LOINC, RxNorm, MeSH (all NLM), ATC (via NLM RxClass),
> CID-10 (Brazilian — bundled DataSUS V2008), and SNOMED CT (optional,
> license-gated).
>
> - 28 tools active by default; 34 with SNOMED enabled.
> - No auth required for LOINC, RxNorm, MeSH, ATC, CID-10; ICD-11 needs
>   free WHO API credentials.
> - structuredContent + outputSchema on all default tools.
> - 243-test Vitest suite (unit + contract + integration); CI on PR.
> - MIT licensed.
>
> Listed on the official MCP Registry as
> `io.github.SidneyBissoli/medical-terminologies-mcp`.
>
> npm: https://www.npmjs.com/package/medical-terminologies-mcp
> Repo: https://github.com/SidneyBissoli/medical-terminologies-mcp

---

## A.2 — Glama.ai submission

**Name:** Medical Terminologies MCP

**One-line description:**

> Unified MCP server providing LLMs with reliable lookup access to
> ICD-11, LOINC, RxNorm, MeSH, ATC, CID-10, and (optionally) SNOMED CT.

**Long description (300–500 words):**

> `medical-terminologies-mcp` is a Model Context Protocol server that
> exposes 28 ready-to-use tools (34 with SNOMED enabled) wrapping
> seven major medical terminology APIs and datasets. Built for LLM
> agents that need reliable, verified terminology lookup instead of
> hallucinated codes.
>
> **Coverage:**
>
> - **ICD-11** (WHO) — 5 tools: search, lookup, hierarchy, chapters,
>   postcoordination axes. Free OAuth credentials required from
>   icd.who.int/icdapi.
> - **LOINC** (NLM Clinical Tables) — 4 tools: search, details,
>   answers, panels. No auth.
> - **RxNorm** (NIH) — 5 tools: search, concept lookup, ingredients,
>   therapeutic classes, NDC mapping. No auth.
> - **MeSH** (NLM Linked Data) — 4 tools: search, descriptor details
>   with scope notes, tree hierarchy, allowed qualifiers. No auth.
> - **ATC** (WHO Anatomical Therapeutic Chemical, served via NLM
>   RxClass) — 3 tools: classify a drug, lookup an ATC code (levels
>   1-4), list class members. No auth.
> - **CID-10** (Brazilian Portuguese ICD-10, DataSUS V2008) — 4 tools:
>   diacritic-insensitive search, code lookup, chapter listing, chapter
>   detail with constituent groups. Bundled dataset, no HTTP.
> - **SNOMED CT** — 5 tools, gated behind `ENABLE_SNOMED_TOOLS=true`.
>   Requires IHTSDO license and self-hosted Snowstorm. Off by default
>   because the public IHTSDO endpoint was retired in 2026.
> - **Crosswalk** — 4 tools including a cross-terminology search
>   (`find_equivalent`). Crosswalk descriptions are explicit about
>   which return real mappings vs. text-search guidance.
>
> **Engineering details:**
>
> - TypeScript, Node 20+, esbuild bundle.
> - Token-bucket rate limiting per API (WHO 5/s, NLM 10/s, RxNorm 20/s).
> - Exponential backoff with ±25% jitter, retry on network errors and
>   408/429/500/502/503/504.
> - WHO OAuth2 with proper `expires_in` cache TTL.
> - `structuredContent` + `outputSchema` on every default tool (MCP spec
>   2024-11-05).
> - `annotations` (`readOnlyHint`, `idempotentHint`, `openWorldHint`)
>   declared on every tool.
> - 243-test Vitest suite (unit + contract using nock + integration
>   gated by env flag) gating CI on PR. Daily integration cron catches
>   upstream API drift.
>
> **What it deliberately does not do:**
>
> - No authoritative ICD-10 → ICD-11 mapping today (`map_icd10_to_icd11`
>   does text search; descriptions are explicit). Real WHO transition
>   tables planned.
> - No LOINC ↔ SNOMED mapping (`map_loinc_to_snomed` returns guidance
>   only — UMLS license required for the actual relationships).
> - No clinical decision support. This is a lookup layer.
>
> MIT licensed. The medical terminology content has its own licenses,
> documented in the README.

**Categories/tags:** healthcare, medical, terminology, ICD-11, LOINC,
RxNorm, MeSH, SNOMED, ATC, CID-10, NIH, WHO, NLM, DataSUS,
clinical-informatics, medical-coding, public-data.

**Repository URL:** https://github.com/SidneyBissoli/medical-terminologies-mcp

**npm package:** medical-terminologies-mcp

---

## A.3 — `mcpservers.org` submission

**Name:** medical-terminologies-mcp

**Category:** Healthcare

**Description (one paragraph):**

> Unified Model Context Protocol server for seven medical terminologies:
> ICD-11 (WHO), LOINC and MeSH (NLM), RxNorm (NIH), ATC (via NLM
> RxClass), CID-10 (Brazilian DataSUS), and SNOMED CT (optional,
> license-gated). 28 tools work out of the box; ICD-11 requires free
> WHO API credentials. Structured outputs, rate-limiting, retry, and
> proper OAuth handling. MIT licensed.

**Repository:** https://github.com/SidneyBissoli/medical-terminologies-mcp

**Install:** `npm install -g medical-terminologies-mcp`

**License:** MIT

---

## A.4 — Smithery.ai submission (after Phase 11.2 — HTTP transport)

**Critical:** Smithery requires Streamable HTTP transport. **Do not
submit before Phase 11.2 is complete and published.**

**Server name:** medical-terminologies

**Display name:** Medical Terminologies (ICD-11, LOINC, RxNorm, MeSH, ATC, CID-10, SNOMED)

**Description:**

> Open-source MCP server providing unified lookup across major medical
> terminologies. ICD-11, LOINC, RxNorm, MeSH, ATC, CID-10 out of the box
> (28 tools); SNOMED CT optional with valid IHTSDO license. Real API
> calls and bundled datasets, not LLM-invented codes.

**`smithery.yaml`** (place at repo root after Phase 11.2):

```yaml
startCommand:
  type: http
  configSchema:
    type: object
    properties:
      whoClientId:
        type: string
        description: WHO ICD-11 API Client ID (optional; required only for ICD-11 tools)
      whoClientSecret:
        type: string
        description: WHO ICD-11 API Client Secret
      whoIcd11ReleaseId:
        type: string
        default: "2024-01"
        description: ICD-11 release ID (e.g. 2024-01, 2025-01)
      enableSnomedTools:
        type: boolean
        default: false
        description: Enable SNOMED CT tools (requires IHTSDO license + self-hosted Snowstorm)
      snomedBaseUrl:
        type: string
        description: Base URL for self-hosted Snowstorm instance
      snomedLanguage:
        type: string
        default: "en"
        description: Accept-Language tag for SNOMED responses
      logLevel:
        type: string
        default: "info"
        enum: [debug, info, warn, error, fatal]
```

(Validate against the current Smithery spec before commit; the format
may have evolved.)

---

## A.5 — Early-adopter outreach email

**Subject (template):** *Quick question on [specific thing they wrote/built]*

**Body — personalize the opener, keep the rest:**

> Hi [Name],
>
> [Specific opener tied to something they wrote or built — e.g.,
> "I read your post on running Claude alongside Epic queries last
> month and the part about terminology drift stuck with me." This line
> is mandatory, no exceptions.]
>
> I've been working on a small open-source project — a Model Context
> Protocol server that wraps ICD-11, LOINC, RxNorm, MeSH, ATC, CID-10
> (and optionally SNOMED CT) so LLM agents can look up codes against
> the real APIs instead of inventing them. v1.1.0, ~160 monthly
> downloads, mostly organic.
>
> I'm specifically interested in feedback from people doing real
> clinical or research informatics work — not "is the code clean"
> feedback (the README and repo are the public answer to that), but
> "would this actually be useful in the workflow you run?"
>
> If you have 5 minutes to look at one or two of the use cases in the
> README and tell me what's missing or wrong for your work, I'd be
> genuinely grateful. No expectation, no follow-up if you don't reply.
>
> https://github.com/SidneyBissoli/medical-terminologies-mcp
>
> Thanks for your time.
>
> Sidney Bissoli
> https://github.com/SidneyBissoli

**Usage notes:**

- The opener line is non-negotiable. Without it, the email is spam.
- Don't send more than one reminder; no reply = no reply.
- Don't send to ≥5 people the same day (avoid spam-pattern detection).

**Targets:**

1. **Clinical Informatics fellows** at MIT, Stanford, Vanderbilt,
   Columbia, OHSU, Utah, Pittsburgh, UTHealth — fellow listings public
   on each program's site, institutional emails available.
2. **Devs who published health-related MCP servers on GitHub** —
   search `topic:mcp-server health` or `topic:mcp medical`. Contact
   authors of correlated projects for genuine peer exchange (not
   spam — for feedback).
3. **Authors of recent (last 3 months) blog posts on LLM in digital
   health** — Hacker News, Towards Data Science, Substack health-tech.
   Identify 5–10.

---

## A.6 — Show HN

**Title:** *Show HN: Medical-Terminologies-MCP – ICD-11, LOINC, RxNorm, MeSH, ATC, CID-10 lookup for LLMs*

**Body:**

> I built an open-source MCP server that gives LLMs reliable lookup
> access to seven medical terminologies: ICD-11 (WHO), LOINC, RxNorm,
> MeSH (all NLM), ATC (via NLM RxClass), CID-10 (Brazilian DataSUS,
> bundled), and optionally SNOMED CT.
>
> 28 tools work without any setup beyond the npx command in the MCP
> client config; ICD-11 needs free WHO API credentials (5-min signup).
> SNOMED is gated behind a flag because the public IHTSDO endpoint
> was retired in 2026 — operators with a license run it against a
> self-hosted Snowstorm instance.
>
> What I tried to get right:
> - structuredContent + outputSchema on every default tool, so MCP
>   clients that consume typed data don't have to re-parse markdown.
> - Token-bucket rate limiting per upstream API (WHO 5/s, NLM 10/s,
>   RxNorm 20/s). Retry with exponential backoff and jitter.
> - WHO OAuth2 with actual expires_in handling (not a hardcoded TTL).
> - 243-test Vitest suite (unit + contract using nock + integration
>   against live APIs gated by env flag) gating CI on PR. Daily
>   integration cron surfaces upstream API drift close to when it
>   happens — that work caught three silent production regressions
>   that had been masking degraded data for an unknown duration.
> - Honest crosswalk tools — `map_icd10_to_icd11` says explicitly in
>   its description that it does text search, not authoritative
>   mapping. `map_loinc_to_snomed` says it returns guidance, not a
>   mapping, because the real mapping requires UMLS or LOINC
>   Expression Association files.
>
> The use case I keep returning to: an LLM working alongside research
> or coding work that needs to pin down "the LOINC for procalcitonin
> in serum" gets `33959-8` from the actual NLM API, not whatever the
> model would have invented.
>
> MIT licensed. Repo:
> https://github.com/SidneyBissoli/medical-terminologies-mcp
>
> Feedback specifically welcome on what's missing for clinical
> informatics, biomedical research, and public-health data workflows.

---

## A.7 — Long-form post (Medium + Dev.to)

**Title:** *Five medical terminologies, one MCP server: a practical walkthrough for clinical and research use*

**Platforms:** Medium (general digital-health audience) and Dev.to
(technical audience). Same text; on Medium add a cover image (suggestion:
screenshot of MCP Inspector showing the tool list); on Dev.to use tags
`#mcp #healthcare #ai #typescript`.

**Medium hashtags:** `Medical Coding`, `Health Informatics`, `MCP`,
`Claude AI`, `Open Source`.

**Dev.to tags:** `mcp`, `healthcare`, `ai`, `typescript`, `opensource`.

**FULL DRAFT — copy-paste ready:**

---

# Five medical terminologies, one MCP server: a practical walkthrough for clinical and research use

If you've ever asked an LLM to "find the LOINC code for procalcitonin" or "list the active ingredients in Janumet," you've probably watched it confidently invent a code that doesn't exist. Medical terminologies are exactly the kind of structured, frequently-updated reference data that language models are bad at memorizing and good at *looking up* — if you give them the right tool.

`medical-terminologies-mcp` is a Model Context Protocol server that gives any MCP-compatible client (Claude Desktop, Claude Code, Continue, and others) unified access to seven medical terminology systems:

- **ICD-11** (WHO International Classification of Diseases, 11th Revision)
- **LOINC** (Logical Observation Identifiers Names and Codes)
- **RxNorm** (NIH normalized clinical drug names)
- **MeSH** (NLM Medical Subject Headings)
- **ATC** (WHO Anatomical Therapeutic Chemical, served via NLM RxClass)
- **CID-10** (Brazilian Portuguese translation of ICD-10, DataSUS V2008 — bundled)
- **SNOMED CT** (Systematized Nomenclature of Medicine, optional, license required)

Twenty-three tools work out of the box with no authentication for LOINC, RxNorm, MeSH, ATC, and CID-10. ICD-11 needs free WHO API credentials (a five-minute signup), bringing the default count to 28. SNOMED is gated behind an explicit feature flag and requires an IHTSDO license plus a self-hosted Snowstorm instance — more on why below.

This post walks through three concrete clinical and research workflows where the server earns its place in the toolbelt.

## Setup in 60 seconds

```json
{
  "mcpServers": {
    "medical-terminologies": {
      "command": "npx",
      "args": ["-y", "medical-terminologies-mcp"],
      "env": {
        "WHO_CLIENT_ID": "your-who-id",
        "WHO_CLIENT_SECRET": "your-who-secret"
      }
    }
  }
}
```

Drop that into your Claude Desktop config (`%APPDATA%\Claude\claude_desktop_config.json` on Windows, `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS), restart Claude, and 28 tools appear. WHO credentials are optional — without them the 5 ICD-11 tools throw a clear configuration error and the other 23 work fine.

## Use case 1: sepsis triage — finding the right LOINC for procalcitonin

A clinical scenario. An ED resident is documenting a sepsis workup and needs the LOINC code for serum procalcitonin to attach to the lab order in the EMR. They could open loinc.org, run a search, scroll through results, and copy the code. Or they could ask their LLM-powered scribe.

```
You: What's the LOINC code for procalcitonin in serum?

Claude (calling loinc_search):
## LOINC Search Results for "procalcitonin"
Found 23 total results (showing 10):

1. **33959-8** - Procalcitonin [Mass/volume] in Serum or Plasma
   Component: Procalcitonin | Property: MCnc | Timing: Pt | System: Ser/Plas
   Class: CHEM | Status: ACTIVE
2. **75241-0** - Procalcitonin [Mass/volume] in Body fluid
...
```

The LLM picks `33959-8` and proposes it. The clinician confirms or asks for details:

```
You: Give me the full LOINC details for 33959-8.

Claude (calling loinc_details):
# 33959-8 - Procalcitonin [Mass/volume] in Serum or Plasma

| Attribute | Value |
|-----------|-------|
| Component | Procalcitonin |
| Property  | MCnc |
| Timing    | Pt |
| System    | Ser/Plas |
| Scale Type| Qn |
| Method    | (none) |
| Class     | CHEM |
| Status    | ACTIVE |
```

What this replaces in practice: a 30-second context switch from EMR to a browser tab, every time a clinician needs to pin down a specific code. Multiplied across the day, across a team, that's real time.

The same workflow applies to any biomarker, vital sign, or observation: lactate (`2524-7`), troponin I high-sensitivity (`67151-1`), SpO₂ (`59408-5`). The tool is `loinc_search` for the discovery step, `loinc_details` for the verification step. Both are deterministic API calls against NLM Clinical Tables — the LLM doesn't memorize codes, it looks them up.

## Use case 2: medication reconciliation — breaking down a combination product

A scenario familiar to any inpatient pharmacist or hospitalist: a patient is admitted on Janumet (a brand combo of sitagliptin and metformin), and the team needs to reconcile this against the formulary, check for class-level interactions, and document the active ingredients separately.

```
You: I need to break down Janumet for the admission med rec.
What are the active ingredients and their drug classes?

Claude (calling rxnorm_search, then rxnorm_ingredients, then atc_classify):

Step 1 — search for Janumet:
**860975** - Janumet (sitagliptin 50 MG / metformin hydrochloride 500 MG Oral Tablet)
   Type: SBD | Synonym: sitagliptin/metformin

Step 2 — get the ingredients:
| RxCUI | Name | Type |
|-------|------|------|
| 593411 | sitagliptin | Single Ingredient |
| 6809 | metformin | Single Ingredient |

Step 3 — get ATC classes for each ingredient:
For sitagliptin (593411): A10BH (Dipeptidyl-Peptidase IV Inhibitors)
For metformin (6809):     A10BA (Biguanides)
                          A10BD (Combinations of oral blood glucose lowering drugs)
```

Three tool calls, structured data, no hallucination risk. The LLM can compose this into a med rec note, flag that both ingredients sit in the same A10B (oral glucose-lowering) ATC bucket, and surface the ATC codes for any pharmacy system that uses ATC.

What this enables that bare LLMs don't: the chain `brand → ingredients → ATC classes` is a graph traversal across a real database. The model isn't recalling that sitagliptin is a DPP-4 inhibitor; it's *looking it up* against the same source the FDA uses.

## Use case 3: evidence synthesis — building a precise PubMed search with MeSH

A scenario for a researcher running a systematic review on the impact of primary health care interventions on avoidable hospitalizations. The quality of a literature search hinges on hitting the right MeSH descriptors and qualifiers — not on free-text keyword guesswork.

```
You: I'm building a search strategy for a systematic review on
primary health care and avoidable hospitalizations. Help me find
the right MeSH descriptors and applicable qualifiers.

Claude (calling mesh_search):
| MeSH ID | Label |
|---------|-------|
| D011320 | Primary Health Care |
| D006297 | Health Services Accessibility |
| D004472 | Hospitalization |
| D006308 | Health Services Misuse |

You: Get me the tree position and allowed qualifiers for Primary Health Care.

Claude (calling mesh_tree, then mesh_qualifiers):
# Tree Numbers for D011320

### Health Care
- `N04.590.233.727`
- `N02.421.143.827`

# Allowed Qualifiers for D011320

| Qualifier ID | Label |
|--------------|-------|
| Q000208 | ethics |
| Q000379 | methods |
| Q000523 | organization & administration |
| Q000592 | standards |
| Q000656 | trends |
| Q000706 | statistics & numerical data |
| Q000941 | utilization |

*Use qualifiers with descriptors like: "Primary Health Care/utilization"*
```

That last detail — the seven allowed qualifiers, with `/utilization` and `/statistics & numerical data` highlighted — is exactly what a precise PubMed search needs. The model now has enough to draft `("Primary Health Care/utilization"[MeSH] OR "Primary Health Care/statistics & numerical data"[MeSH]) AND "Hospitalization/prevention and control"[MeSH]` and explain why each leg matters.

The use case generalizes: any research informatics workflow that needs controlled vocabulary mapping (PubMed, Cochrane, OVID) benefits from `mesh_search` + `mesh_qualifiers` + `mesh_tree`. For systematic reviews specifically, the qualifier list is the part that's hardest to remember and easiest to get wrong.

## What the server doesn't claim to do

A few things worth being explicit about, because the README is honest about them and the LLM should be too:

- **`map_icd10_to_icd11` is a text search** today, not an authoritative ICD-10 → ICD-11 mapping. For clinical coding or billing migration, the WHO transition tables at https://icd.who.int/browse11/Downloads/Download are the source of truth (real implementation is on the roadmap).
- **`map_loinc_to_snomed` returns guidance**, not a mapping. Direct LOINC ↔ SNOMED CT mappings live in UMLS Metathesaurus (license required) or the LOINC SNOMED CT Expression Association files (LOINC license required).
- **SNOMED tools are off by default** because the historical public IHTSDO Snowstorm endpoint was retired (HTTP 410 Gone). Operators with an IHTSDO license and a self-hosted Snowstorm instance flip them on with `ENABLE_SNOMED_TOOLS=true SNOMED_BASE_URL=...`.
- **None of this is a substitute for clinical judgment.** It's a lookup layer for already-known codes, not a diagnostic tool.

## Under the hood, briefly

For developers curious about the engineering: TypeScript on Node 20+, bundled with esbuild, built around a token-bucket rate limiter (5 req/s for WHO, 10 req/s for NLM, 20 req/s for RxNorm) and exponential-backoff retry with ±25% jitter. WHO OAuth tokens are cached using the actual `expires_in` from the API response, not a hardcoded TTL. Every default tool declares `outputSchema` and returns `structuredContent` alongside markdown — so MCP clients that consume structured data get typed objects, not parsed prose. The 243-test Vitest suite (unit + contract via nock + integration against live APIs gated by env flag) gates CI on PR. A daily integration cron catches upstream API drift — work that already caught three silent production regressions where the API had drifted and the client gracefully returned empty data.

It's MIT licensed. The medical terminology content has its own licenses, all linked in the README.

## Try it

- **npm:** https://www.npmjs.com/package/medical-terminologies-mcp
- **GitHub:** https://github.com/SidneyBissoli/medical-terminologies-mcp
- **MCP Registry:** `io.github.SidneyBissoli/medical-terminologies-mcp`

WHO API credentials (free): https://icd.who.int/icdapi.

Issues, PRs, and use-case reports welcome — especially from clinical informatics teams, research informatics groups, and public-health data analysts using LLMs in real workflows. There's a real gap between "LLM as scribe" and "LLM with reliable terminology access," and closing it is what this server is for.

---

**End of long-form draft.**

### Platform-specific adaptation notes

- **Medium:** add cover image (MCP Inspector screenshot or simple
  diagram of the seven terminologies). Tags above. Reading time ~7 min.
- **Dev.to:** publish with the listed tags. Add canonical URL pointing
  to Medium (or vice versa). Dev.to renders code blocks with syntax
  highlight automatically.
- **GitHub Discussions:** crosspost the same text under
  https://github.com/SidneyBissoli/medical-terminologies-mcp/discussions
  in the "Show and tell" category — works as a permanent link and
  helps repo-page SEO.

---

## A.8 — LinkedIn post (~700 words)

**Platform:** LinkedIn personal feed (then crosspost to Healthcare
Informatics / Clinical Informatics / Health IT Pros groups, see Phase
12.2).

**FULL DRAFT — copy-paste ready:**

---

If you've watched an LLM confidently invent a LOINC or ICD-11 code that doesn't exist, you know the gap I'm trying to close.

Over the past months I've been building `medical-terminologies-mcp`, an open-source Model Context Protocol server that gives Claude (and any other MCP-compatible client) unified access to seven medical terminology systems:

→ ICD-11 (WHO)
→ LOINC (NLM)
→ RxNorm (NIH)
→ MeSH (NLM)
→ ATC (via NLM RxClass)
→ CID-10 (Brazilian Portuguese, bundled DataSUS V2008)
→ SNOMED CT (optional, license-gated)

28 tools work out of the box. The model doesn't memorize codes — it looks them up against the same APIs the WHO and NLM publish for everyone else.

Three concrete examples of what changes when an LLM has reliable terminology access:

🩺 ED triage. A resident asks "what's the LOINC for procalcitonin in serum?" and gets `33959-8` with full attributes (component, property, system, scale, method) — verified against NLM, not invented. Same workflow for any lab, vital sign, or observation.

💊 Medication reconciliation. Janumet → break it down into sitagliptin (RxCUI 593411) and metformin (RxCUI 6809), get the ATC classes for each (DPP-4 inhibitor A10BH; biguanide A10BA), surface the codes for the pharmacy system. Three tool calls, zero hallucination.

📚 Systematic reviews. "Primary Health Care" → MeSH D011320, tree position N02.421.143.827, allowed qualifiers including /utilization and /statistics & numerical data. The qualifier list is exactly what makes a precise PubMed search precise.

What's deliberately not in scope:

❌ Authoritative ICD-10 → ICD-11 mapping today (the tool is text search; for coding/billing use the WHO transition tables. Real mapping is on the roadmap.)
❌ LOINC ↔ SNOMED mapping (requires UMLS or LOINC Expression Association files — neither is freely accessible via API)
❌ Clinical decision-making (this is a lookup layer, not a diagnostic tool)

The server is honest about each of these in its tool descriptions. I'd rather it return "this tool does text search, not curated mapping; consult the official transition tables" than pretend to do something it doesn't.

For the engineering-minded: TypeScript on Node 20+, OAuth2 with proper expires_in handling, token-bucket rate limiting (5/10/20 req/s per API), exponential backoff with jitter, structuredContent on every default tool, 243-test Vitest suite (unit + contract + integration) gating CI. Daily integration cron caught three silent upstream regressions during the last sweep. MIT licensed.

If you work in clinical informatics, EMR integration, biomedical research, or health-tech and you're experimenting with LLM agents, I'd genuinely value your feedback — especially on what's missing for the workflows you actually run.

🔗 npm: https://www.npmjs.com/package/medical-terminologies-mcp
🔗 GitHub: https://github.com/SidneyBissoli/medical-terminologies-mcp

#HealthInformatics #ClinicalInformatics #MedicalCoding #LLM #ModelContextProtocol #OpenSource #DigitalHealth #ClaudeAI

---

**End of LinkedIn draft.**

### LinkedIn-specific notes

- Short paragraph breaks (LinkedIn truncates posts with >3 continuous
  lines in preview).
- Bullet emojis, not markdown — LinkedIn doesn't render markdown.
- Hashtags grouped at the end. Mix specific (HealthInformatics,
  ClinicalInformatics) with broader (LLM, OpenSource).
- No "Read more" or artificial cliffhanger — LinkedIn truncates
  naturally; the first 3 paragraphs need to read well.

---

## A.9 — Reddit posts (3 versions)

**ATTENTION:** read the *Risks and what NOT to do* section at the
bottom of this file before posting to any subreddit. r/medicine has
strict rules against self-promotion; the title and framing need to be
careful.

### A.9.a — r/medicalcoding

**Title:** *Open-source MCP server for ICD-11, LOINC, RxNorm, MeSH, ATC lookup from LLMs*

**Flair:** "Resources" or "Tools" (verify what's available).

**Body:**

> I built a small MCP (Model Context Protocol) server that lets LLMs
> like Claude do reliable lookups against ICD-11, LOINC, RxNorm, MeSH,
> ATC, CID-10, and optionally SNOMED CT. It's not a diagnostic or
> coding-suggestion tool — it's a lookup layer that calls the actual
> NLM and WHO APIs (or, for CID-10, a bundled DataSUS dataset) so the
> model stops inventing codes.
>
> Specifically useful if you're experimenting with LLM-assisted chart
> review or trying to keep your team's documentation grounded in real
> codes. 23 tools work without any authentication; ICD-11 needs free
> WHO API credentials.
>
> A few things it deliberately doesn't do (yet):
> - No authoritative ICD-10 → ICD-11 mapping (it's text search; the
>   WHO transition tables are the real source — implementing real
>   mapping is on the roadmap).
> - No LOINC ↔ SNOMED mapping (UMLS or LOINC Expression Association
>   files; neither is freely API-accessible).
> - No SNOMED browser by default — public IHTSDO Snowstorm endpoint
>   was retired; tools gated behind a flag for self-hosted instances.
>
> MIT licensed, npm: https://www.npmjs.com/package/medical-terminologies-mcp
>
> Genuinely interested in feedback from people doing real coding work —
> what's missing? What would make it actually useful in your workflow?

### A.9.b — r/medicine

**SPECIAL ATTENTION:** r/medicine has a rule against self-promotion.
This version is more cautious, framing-first. Post ONLY if a
"Resource" or "Other" flair is available, and be ready for the post
to be removed. Consider asking via modmail first.

**Title:** *Has anyone tried using MCP servers to ground LLM outputs in real medical terminology APIs?*

**Body:**

> Genuine question, not a sales pitch. There's an emerging pattern in
> the LLM space called Model Context Protocol — a standard way to
> connect language models to external data sources, kind of like a
> universal plugin interface. For medical use, it's interesting because
> it could (in principle) make LLMs much more reliable for terminology
> lookup: instead of the model guessing what the LOINC code for
> procalcitonin is, it makes a real API call to NLM Clinical Tables
> and gets back a verified code.
>
> I built one such server (links below — happy to take it down if this
> crosses self-promotion lines, just let me know) wrapping ICD-11,
> LOINC, RxNorm, MeSH, ATC, and a Brazilian CID-10 dataset. The
> interesting question for me is: is this actually useful for any of
> you running LLMs alongside clinical work, or is the bottleneck
> somewhere else entirely (regulatory, EMR integration, trust)?
>
> What would actually make this useful in your day-to-day, if anything?
>
> https://github.com/SidneyBissoli/medical-terminologies-mcp

**Suggested flair:** "Resources" or "Other"; **NOT** clinical flairs.
If removed, do not recreate.

### A.9.c — r/healthIT

**Title:** *Open-source MCP server: unified API access to ICD-11, LOINC, RxNorm, MeSH, ATC, CID-10 for LLM agents*

**Flair:** "Open Source" if available, else "Discussion".

**Body:**

> Sharing a project that might be useful if your team is exploring
> LLM agents for clinical, research, or public-health data workflows.
>
> `medical-terminologies-mcp` is a Model Context Protocol server that
> exposes 28 default tools (34 with optional SNOMED) for terminology
> lookup. Built on the standard MCP spec, so it works with Claude
> Desktop, Claude Code, Continue, and other MCP-compatible clients —
> drop in a config snippet, restart the client, the tools appear.
>
> What it does well:
> - Real API calls (no LLM-invented codes); CID-10 served from a
>   bundled DataSUS dataset
> - structuredContent + outputSchema on every default tool (typed
>   objects, not just markdown)
> - Token-bucket rate limiting per upstream API
> - WHO OAuth2 with actual expires_in handling
> - 243-test Vitest suite (unit + contract + integration) gating CI
> - Daily integration cron catches upstream API drift
>
> What it doesn't do (deliberately):
> - No authoritative cross-terminology mapping yet (LOINC↔SNOMED needs
>   UMLS license; ICD-10→ICD-11 currently text-search, real mapping
>   on roadmap)
> - No clinical decision support — it's a lookup layer
> - SNOMED gated by default (public IHTSDO endpoint retired; needs
>   self-hosted Snowstorm + IHTSDO license)
>
> MIT, free, no telemetry. Feedback specifically welcome from anyone
> running LLMs alongside production EMR or research workflows.
>
> https://www.npmjs.com/package/medical-terminologies-mcp
> https://github.com/SidneyBissoli/medical-terminologies-mcp

### Variants worth considering

- **r/HealthInformatics** — same text as r/healthIT works; smaller but
  more focused community.
- **r/Bioinformatics** — only with a specific framing on MeSH +
  scientific literature search; don't post without that angle.

---

## A.10 — Mastodon / Bluesky (3 variants ≤500 chars)

**Variant A — clinical use:**

> New: medical-terminologies-mcp — open-source MCP server giving LLMs
> reliable lookup access to ICD-11, LOINC, RxNorm, MeSH, ATC, CID-10,
> optionally SNOMED CT. 28 tools out of the box, no auth needed for
> most. The model stops inventing codes and starts looking them up.
>
> https://github.com/SidneyBissoli/medical-terminologies-mcp
>
> #healthinformatics #medicalcoding #mcp #opensource

**Variant B — research:**

> If you're using LLMs for systematic reviews and tired of made-up
> MeSH terms: medical-terminologies-mcp lets the model do real lookups
> against NLM, get tree numbers, allowed qualifiers, the whole graph.
> Open source, MIT.
>
> https://www.npmjs.com/package/medical-terminologies-mcp
>
> #systematicreview #pubmed #ai4health

**Variant C — devs:**

> Built an MCP server for medical terminologies (ICD-11, LOINC, RxNorm,
> MeSH, ATC, CID-10, SNOMED). TypeScript, Vitest, structuredContent on
> every default tool, token-bucket rate limiting, OAuth handled
> properly. MIT.
>
> Drop into Claude Desktop, get 28 tools.
>
> https://github.com/SidneyBissoli/medical-terminologies-mcp
>
> #mcp #typescript #healthtech

**Recommended instances:**

- `academic.social` — academic profile, research audience
- `fediscience.org` — science generally
- `mastodon.social` — broad reach
- (optional) `infosec.exchange` — variant C works here on the
  engineering angle

**Bluesky crosspost:** same content, same hashtags. Bluesky has a 300-char
limit; Variant A needs trimming. Bluesky version:

> medical-terminologies-mcp: open-source MCP server giving LLMs
> reliable lookup access to ICD-11, LOINC, RxNorm, MeSH, ATC, CID-10,
> optionally SNOMED. 28 tools, MIT.
>
> github.com/SidneyBissoli/medical-terminologies-mcp
>
> #healthinformatics #mcp #opensource

---

## A.11 — GitHub Discussions / repo announcement

For crosspost at https://github.com/SidneyBissoli/medical-terminologies-mcp/discussions:

**Category:** Show and tell (create if it doesn't exist)

**Title:** *v1.1.0 — what's new and what's coming*

**Body:** short version of the long-form post focusing on (a) what's
in 1.1.0 (reference CHANGELOG), (b) the 3 use cases, (c) the visible
roadmap (Phase 11 HTTP transport, Phase 13 expanded coverage).

---

## Risks and what NOT to do

### What can burn reputation

1. **Posting to r/medicine without reading the rules.** The
   self-promotion rule is strict. If posted and removed, the sub-mod
   may ban repeat offenders. Safe strategy: framing as a genuine
   question (variant A.9.b), offer voluntary removal if it crosses
   the line, **don't recreate if removed.**

2. **Spam at chat.fhir.org.** The HL7 community detects drive-by
   self-promo in seconds. **Post only in response to context.** Don't
   create a "look what I built" thread. If posting proactively, do it
   in `#tooling` or similar with a technical, not promotional, framing.

3. **Generic cold email to AMIA membership.** AMIA listserv has clear
   rules. Generic email = bounce + reputation hit. Use the A.5
   template and personalize the opener **always**.

4. **Cross-posting to 5 subreddits the same day.** Reddit admin tools
   detect this and mark you as a spammer. Spread ≥48h between subs.

5. **Inflated promotional language.** "Revolutionary," "Game-changing,"
   "The first-ever" — any of these attracts backlash on HN, Reddit,
   and dev Mastodon. The drafts in this file deliberately avoid that
   register. **Don't edit it back.**

6. **Claim of clinical use in production.** The server isn't
   certified for production clinical use, and the README says so.
   **No outreach piece should suggest otherwise.** "Useful for
   clinical informatics workflows" is OK; "ready for production EHR
   integration" is not.

7. **Inventing capabilities.** Everything described in the drafts
   above is in the verified code. If during adaptation you feel the
   urge to add "and also does X," verify in `src/tools/` first. Real
   differentiators (structuredContent, annotations, OAuth, rate
   limiting, retry, contract+integration tests, three regression
   discoveries) are already strong; no need to inflate.

### Communities where self-promotion is poorly received

| Community | Tolerance | How to navigate |
|-----------|-----------|------------------|
| r/medicine | Very low | Frame as a question; offer removal; don't push |
| r/MedicalSchool | Very low | Don't post; not the audience |
| chat.fhir.org | Low for self-promo, high for technical reply | Only in response to a relevant thread |
| AMIA forums (membership) | Medium | Personalization mandatory; specific channel |
| HN front page | High intolerance to marketing-speak | But Show HN is the right channel if the tone is technical |
| Mastodon academic.social | Medium; tolerates honest announcements | Direct tone, no hype |
| LinkedIn | High self-promo tolerance | But overdose causes unfollow |
| Discord MCP communities | High | It's the channel; just follow server rules |
| ResearchGate | Medium | Project announcement = OK; DM spam = no |

### What NOT to include in posts

- **Empty metrics.** "1000+ downloads in 24 hours" only works after it
  happened. Don't predict.
- **Direct competitor comparisons.** No direct equivalent exists in the
  health-MCP space. Comparing to loinc.org or icd.who.int is absurd
  (those are upstream sources). Comparing to proprietary tools (3M,
  Wolters Kluwer) is out of scale. Focus on what the server does, not
  on who it "beats".
- **Future features as if they shipped.** Phase 13 expansions, hosted
  HTTP — mention as "upcoming" if relevant, never as "supports".
- **Vague marketing terms.** "Comprehensive," "robust,"
  "enterprise-ready," "scalable" — if you mean rate limiting, "5 req/s
  for WHO" says it. If you mean tests, "243-test Vitest suite" says it.
- **AI comparisons.** Don't compare Claude to other LLMs in the
  context of using this server — the server is client-agnostic.

### When to stop

If 30 days in zero of the target metrics move, **stop outreach and
diagnose the product**. Likely:

- HTTP transport is still the main gap (if Phase 11.2 wasn't done).
- Real demand is smaller than estimated — in which case marginal
  outreach effort has low return.

Don't scale volume chasing conversion; scale channel quality, or go
back to product.
