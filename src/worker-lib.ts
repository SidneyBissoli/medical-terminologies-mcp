/**
 * Build entry for the Cloudflare Worker's view of this package
 * (`npm run build:worker-lib` → dist/worker-lib.js).
 *
 * The Worker in worker/ is an instance of the portfolio's Fase 0 hosting
 * template and consumes the package through this single surface: the
 * registration layer (registerAll/createServer), the registries and
 * SERVER_INFO, the StatsCounter Durable Object (legacy /stats counter,
 * history preserved), and the stats-recorder bridge the Worker installs
 * per isolate.
 *
 * The bundle inlines all app code and datasets with the workerd-safe
 * recipe of the pre-template worker build (browser platform, node:
 * aliases), but keeps `@modelcontextprotocol/*` and `zod` EXTERNAL so the
 * Worker, the `agents` package, and this lib all share the single SDK
 * copy in the parent node_modules (duplicate SDK instances break
 * instanceof/type identity across registerAll).
 */

export { registerAll, createServer, type ToolUsageRecorder } from './register.js';
export {
  SERVER_INFO,
  SERVER_INSTRUCTIONS,
  SERVER_TITLE,
  SERVER_WEBSITE_URL,
  SERVER_ICONS,
  toolRegistry,
  promptRegistry,
  resourceRegistry,
} from './server-core.js';
// The Worker needs both conformance modules: the discover patch is applied on
// its own `buildServer` (a SEPARATE construction from the stdio one), and the
// cursor guard runs on its POST. Reaching them through this surface keeps the
// single-copy rule — importing `../../src/*.ts` from the Worker would compile a
// second copy against a different tsconfig.
export { announceServedVersions } from './discover.js';
export { unknownCursorError, INVALID_PARAMS, PAGINATED_LIST_METHODS } from './pagination.js';
export { setStatsRecorder, type StatsRecorder, type StatsPayload } from './utils/stats.js';
export { StatsCounter } from './durable-objects/stats-counter.js';
