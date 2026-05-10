# Contributing

Thanks for considering a contribution. This project ships an MCP server
that wraps five public medical terminology APIs (ICD-11, LOINC, RxNorm,
MeSH, SNOMED CT). Most contributions land in one of three buckets:

- **Tool changes** — adding or refining tools under `src/tools/*.ts`
  (description, output schema, structured content shape).
- **Client changes** — fixing parsing bugs in `src/clients/*.ts` when
  an upstream API response shape changes or is misread.
- **Cross-cutting** — shared utilities under `src/utils/` (cache,
  rate-limiter, retry, schema helpers, logger).

Project-specific notes that aren't obvious from the README:

- **SNOMED tools are off by default** because the historical public
  IHTSDO Snowstorm endpoint was retired (returns HTTP 410). Contributors
  who want to exercise SNOMED code paths need a self-hosted Snowstorm
  and `ENABLE_SNOMED_TOOLS=true SNOMED_BASE_URL=<your-instance>`. See
  the README's "SNOMED CT setup (advanced)".
- **Schemas are the source of truth.** Zod input/output schemas live
  in `src/types/index.ts`. The MCP `inputSchema` and `outputSchema`
  surfaces are *derived* from those Zod definitions via
  `buildInputSchema()` / `buildOutputSchema()` in
  `src/utils/zod-schema.ts`. Don't hand-write JSON Schemas in tool
  files; change the Zod definition and the JSON Schema follows.
- **Tools are registered via side-effect import** in `src/index.ts`
  with `tree-shaking=false` in the esbuild config — both load-bearing.
  Don't tree-shake the bundle.

## Local setup

```bash
git clone https://github.com/SidneyBissoli/medical-terminologies-mcp.git
cd medical-terminologies-mcp
npm install
```

Node 20+ required (`engines.node` in `package.json`).

## Running

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run test:watch  # interactive
npm run build       # esbuild bundle to dist/index.js
npm start           # node dist/index.js (runs over stdio)
```

To exercise the server interactively against a real MCP client, the
fastest path is the official Inspector:

```bash
npm run build
npx @modelcontextprotocol/inspector node dist/index.js
```

## Before opening a PR

1. `npm run typecheck` clean (CI gates on this).
2. `npm test` passes (CI gates on this).
3. `npm run build` succeeds and the bundle still has 34
   `toolRegistry.register` source-level call sites (CI gates on this
   count to catch accidental tool removal).
4. If you added a tool with `outputSchema`, add a fixture to
   `src/types/schemas.test.ts` exercising the typical-result and one
   edge case (empty-list, all-nullable-fields, etc.). Pattern:
   `<Schema>OutputSchema.safeParse({...}).success` should be `true` for
   well-formed shapes and `false` for missing-required-field cases.
5. If your change is user-visible, add a bullet under `## [Unreleased]`
   in `CHANGELOG.md` (Added / Changed / Fixed / Removed / Security per
   Keep-a-Changelog).

## Commit messages

Conventional Commits style — the repo's history uses
`feat:` / `fix:` / `refactor:` / `docs:` / `test:` / `chore:` /
`perf:` prefixes. Body should explain *why*, not *what* (the diff
shows the what).

If your change addresses an item from `PROGRESS.md` (audit findings or
active deferrals), reference it explicitly in the body so future readers
can map the commit to that context.

## Tests philosophy

Tests cover three layers: utils + Zod schemas (unit), HTTP clients
against captured fixtures (contract — `src/clients/*.contract.test.ts`,
using nock), and live API smoke tests (integration —
`src/integration/`, gated by `INTEGRATION_TESTS=1`). The integration
suite runs daily on cron (`.github/workflows/integration.yml`) so
upstream API drift surfaces close to when it happens.

When adding a new HTTP-backed feature, capture a live fixture into
`src/__fixtures__/<api>/` and write a contract test pinning the parser
against it. WHO + SNOMED tests use inline mocks because their public
hosts don't ship test creds.

## Reporting issues

Use the issue templates under `.github/ISSUE_TEMPLATE/`. The bug
template asks specifically which terminology and tool are affected
because behavior often varies sharply between APIs.

## Style and formatting

- TypeScript strict mode (`noUnusedLocals`, `noUnusedParameters`,
  `noImplicitReturns`, etc.) — turned on in `tsconfig.json` and not
  negotiable.
- No formal linter (no ESLint or Biome configured). The strict TS
  compiler catches most of what a linter would.
- Prettier is *not* configured; existing formatting is consistent
  enough — match the surrounding code in the file you're editing.
- Don't pin transitive deps; `package-lock.json` is the source of truth.

## License

By contributing, you agree your contributions will be licensed under
the project's [MIT License](./LICENSE).
