# Contributing

Thanks for considering a contribution. This project ships an MCP server
for seven medical terminologies (ICD-11, LOINC, RxNorm, MeSH, ATC,
CID-10, SNOMED CT) — most served via public APIs, CID-10 from a
bundled DataSUS dataset, SNOMED gated behind a feature flag. Most
contributions land in one of three buckets:

- **Tool changes** — adding or refining tools under `src/tools/*.ts`
  (description, output schema, structured content shape).
- **Prompt or Resource changes** — adding or refining MCP Prompts
  under `src/prompts/*.ts` or Resources under `src/resources/*.ts`.
  Prompts orchestrate tool calls into named workflows; Resources
  expose in-process reference content by URI.
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
- **Tools, Prompts, and Resources are registered via side-effect
  import** in `src/index.ts` AND `src/worker.ts`, with
  `tree-shaking=false` in the esbuild config — all three are
  load-bearing. The meta-test in `src/index.test.ts` enforces
  side-effect-import coverage across `src/tools/`, `src/prompts/`,
  and `src/resources/` for the Node entry. Don't tree-shake the
  bundle and don't forget to wire new files into both entry points.

## Local setup

```bash
git clone https://github.com/SidneyBissoli/medical-terminologies-mcp.git
cd medical-terminologies-mcp
npm install
```

Node 22+ required (`engines.node` in `package.json`). Node 20 reached end of life on 2026-04-30.

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
3. `npm run build` succeeds and the bundle still has 39
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

## Releasing

Releases are driven by `gh release create v<X.Y.Z>` against `main`.
That fires `.github/workflows/publish.yml`, which runs
`npm publish --provenance` and then `mcp-publisher publish` to
register the new version with the MCP Registry (which Smithery and
mcpservers.org auto-discover from — re-scans usually propagate within
minutes to hours of a successful publish). LobeHub does **not** auto-discover
from the MCP Registry; it requires a manual submission via GitHub issue at
`lobehub/lobehub` (see PROGRESS.md Phase 11.10 for the verified pattern).

Before tagging:

1. **Bump the version with `npm version <patch|minor|major> --no-git-tag-version`.**
   The `version` hook (`scripts/sync-version.mjs`) mirrors it into `server.json`
   (top level and every `packages[].version`) and `lhm.plugin.json`, and stages
   them. Do not edit those by hand, and do not let npm create a local tag — the
   tag comes from `gh release create`.
2. **If the surface changed** (a tool, parameter, description or schema):
   - `npm run surface:lock` — regenerates `surface.lock.json`; it only accepts a
     new surface under a new version;
   - `npm run manifest:lhm` — regenerates the LobeHub manifest;
   - **a tool added or removed needs a new baseline in the same PR:**
     `npm run build && node scripts/dump-surface.mjs --stdio >
     baselines/surface-stdio-<version>.json`, plus a row in
     `baselines/README.md`. The production smoke derives the expected tool count
     from the newest baseline; 1.18.0 and 1.18.1 shipped without one and both
     deploy workflows failed with the Worker live. `src/baseline-sync.test.ts`
     now fails the PR first.
3. Add a `## [X.Y.Z] - YYYY-MM-DD` block to `CHANGELOG.md` between
   `## [Unreleased]` and the previous release.
4. Verify locally:
   `npm run typecheck && npm test && npm run build:all`.
5. Open a PR, wait for CI, squash-merge, then
   `gh release create vX.Y.Z --target main --title "..." --notes-file <notes>` —
   this fires the publish workflow. Afterwards confirm the deploy workflow ended
   green and the post-deploy `mcpscore` audit ran (it is skipped when the deploy
   fails).

### Annual ICD-11 release bump

WHO publishes a new ICD-11 MMS release about once a year (usually January or
February). The server pins one release in `WHO_ICD11_DEFAULT_RELEASE`
(`src/clients/who-client.ts`); every ICD-11 call, the `data_vintage` of every
ICD-11 provenance block and `terminology_versions` derive from it.

**You learn about a new release from the daily integration run**, not from a
calendar: the case *"the pinned ICD-11 release is the latest WHO publishes"*
asks WHO for its latest release and fails with the new id. To bump:

1. Set `WHO_ICD11_DEFAULT_RELEASE` to the new id (e.g. `'2027-01'`). It is the
   single copy — `src/provenance.ts` and `src/tools/versioning.ts` import it.
2. Run the live suite against the new release:
   `INTEGRATION_TESTS=1 WHO_CLIENT_ID=… WHO_CLIENT_SECRET=… npm test -- src/integration/`
   (or dispatch the *Integration tests (live APIs)* workflow on your branch).
   Watch especially the chapter count, `5A11` lookup, and the search shape
   (`theCode`, `matchingPVs`) that `harmonize_terms` ranks on.
3. Spot-check codes the release may have moved: run `harmonize_terms` and
   `icd11_lookup` on a few common diagnoses and compare with the previous
   release. WHO's release notes:
   https://icd.who.int/browse11/Downloads/Download
4. The WHO ICD-10 → ICD-11 transition tables (`src/data/icd10-to-icd11.json`)
   are a separate, bundled dataset with their own release; regenerate them with
   `scripts/build-icd10-to-icd11-dataset.mjs` only when WHO publishes new tables.
5. Ship it as a minor release (the data clients see changes): CHANGELOG entry
   naming both releases, then the normal steps above.

Operators can pin a different release without a code change via the
`WHO_ICD11_RELEASE_ID` environment variable.

### `server.json` constraints worth memorizing

- **`description` is hard-capped at 100 characters** by the MCP
  Registry validator. Exceeding it returns HTTP 422 from
  `mcp-publisher validate`. `package.json` and `SERVER_INFO`
  (`src/server-core.ts`) have no such cap, so they can carry a
  longer, richer copy — the three descriptions don't need to be
  identical, and in practice the longer copy is more useful on npm
  search results and in `serverInfo` runtime responses.
- **`title`, `websiteUrl`, `icons[]`** are the discovery-surface
  fields scored by Smithery's quality-score rubric (alongside the
  per-tool `outputSchema` coverage). Schema reference:
  https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json.
  Icons must be HTTPS URLs (≤255 chars) with `mimeType` in
  `image/{png, jpeg, svg+xml, webp}`.

### When the registry publish fails after npm publish succeeds

This is the documented happy path per the publish workflow's comments
— npm is already at the new version, you just need to retry the
registry step alone. The `publish` job in the workflow can't be
re-run blindly: a second `npm publish` of the same version returns
`EPUBLISHCONFLICT` and prevents the dependent `publish-registry` job
from running. Instead, finish the registry publish from your local
machine:

1. Fix the underlying issue (usually a `server.json` validation
   error — see the constraints above) and commit + push to `main`
   (`fix(server.json): ...`).
2. Download `mcp-publisher` for your platform from
   https://github.com/modelcontextprotocol/registry/releases/latest.
3. From the repo root, after `git pull` to get the fix locally:
   ```bash
   ./mcp-publisher validate
   ./mcp-publisher login github     # interactive device flow
   ./mcp-publisher publish
   ./mcp-publisher logout
   ```
4. Verify by fetching from the registry:
   ```bash
   curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=medical-terminologies" \
     | jq '.servers[].server | select(.version=="X.Y.Z") | {version, title, description}'
   ```

## License

By contributing, you agree your contributions will be licensed under
the project's [MIT License](./LICENSE).
