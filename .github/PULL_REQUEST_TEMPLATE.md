## What changed

<!-- One or two sentences. The diff shows the rest. -->

## Why

<!-- The user-visible motivation. If addressing an item from PROGRESS.md
     (audit findings or active deferrals), reference it (e.g.
     "PROGRESS.md Phase 8: getLOINCDetails false-null bug"). -->

## Type

<!-- Pick all that apply. -->

- [ ] Bug fix
- [ ] New tool / new terminology coverage
- [ ] Tool description / output-schema change
- [ ] Client-layer change (parsing, rate limit, retry, cache)
- [ ] Refactor (no behavior change)
- [ ] Docs / build / CI / config

## Breaking change?

<!-- "Breaking" here means: an existing tool's name, input schema, or
     output schema changed in a way a consumer might rely on. Behavior
     changes inside an opaque tool (e.g., better parsing) are not
     breaking. If yes, describe the migration path. -->

- [ ] No
- [ ] Yes — explain below

## Tests

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes locally
- [ ] Added or updated fixtures in `src/types/schemas.test.ts` (if a
      schema changed)
- [ ] Added or updated unit tests under `src/utils/` (if a util
      changed)
- [ ] Manually exercised via MCP Inspector or a real client (note
      below)

## CHANGELOG

- [ ] Added a bullet under `## [Unreleased]` in `CHANGELOG.md`
- [ ] Not user-visible — no CHANGELOG entry needed
