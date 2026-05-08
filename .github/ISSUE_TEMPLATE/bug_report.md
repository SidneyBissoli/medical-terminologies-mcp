---
name: Bug report
about: A tool returns wrong data, errors out, or doesn't match its outputSchema
title: "[bug] "
labels: bug
---

## Which terminology and tool?

<!-- One of: ICD-11, LOINC, RxNorm, MeSH, SNOMED CT, crosswalk. -->
<!-- Tool name (e.g. icd11_search, loinc_details, find_equivalent). -->

## What did you call it with?

<!-- The exact arguments you passed, e.g.:
  loinc_num: "2339-0"
  query: "diabetes"
-->

```json
{ }
```

## What did you expect?

## What did you get?

<!-- Paste the tool's content text and (if applicable) structuredContent.
     If the tool returned isError: true, include the error message verbatim. -->

## Environment

- Package version (from `npm ls medical-terminologies-mcp` or
  `node -p "require('medical-terminologies-mcp/package.json').version"`):
- Node version (`node --version`):
- MCP client (Claude Desktop / Claude Code / MCP Inspector / other):
- OS:

## Relevant configuration

<!-- Anything you set in the MCP client's `env` block. Redact secrets. -->

- `WHO_ICD11_RELEASE_ID`:
- `ENABLE_SNOMED_TOOLS`:
- `SNOMED_BASE_URL`:
- `SNOMED_LANGUAGE`:
- `LOG_LEVEL`:

## Anything else?

<!-- Stack traces, partial logs, screenshots if it's a rendering issue
     in the consuming client. For SNOMED tools, note whether your
     Snowstorm instance has the relevant refsets/translations imported. -->
