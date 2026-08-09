/**
 * MCP Resource `info://stats` — public per-tool invocation counter for the
 * hosted Workers endpoint. Reads from the `StatsCounter` Durable Object
 * (Worker path) or returns a "stats unavailable" placeholder (Node/stdio).
 *
 * Why expose this as an MCP Resource (not just an HTTP endpoint): MCP
 * clients like Smithery, MCP Inspector, and LobeHub can surface
 * resources directly in their UI — meaning a listing's grid card can
 * show "1,247 tool calls; most used: icd11_search" without the user
 * leaving the marketplace. The `/stats` HTTP route in worker.ts serves
 * the same data for shields.io badge and human consumption.
 *
 * The counter is necessarily a partial view: only requests that pass
 * through the hosted endpoint contribute. Local stdio installs (npm
 * install medical-terminologies-mcp) are by-design unmeasurable. The
 * `scope` field in the payload makes this explicit.
 */

import type { Resource, ReadResourceResult } from '@modelcontextprotocol/server';
import { resourceRegistry, type ResourceHandler } from '../server-core.js';
import { getStatsRecorder } from '../utils/stats.js';

const statsResource: Resource = {
  uri: 'info://stats',
  name: 'Usage stats (hosted endpoint)',
  description:
    'Per-tool invocation counts and total successful dispatches recorded by the hosted Cloudflare Workers endpoint. Excludes local stdio installs (those have no shared counter by design). Useful for adoption signal — see top_tool to know which terminology is pulling the most demand.',
  mimeType: 'application/json',
};

const statsHandler: ResourceHandler = async (uri): Promise<ReadResourceResult> => {
  const payload = await getStatsRecorder().read();

  const body =
    payload === null
      ? {
          scope: 'stats unavailable on this transport',
          note: 'Per-tool counters are recorded only by the hosted Cloudflare Workers endpoint at https://medical.sidneybissoli.com. The local stdio transport has no shared state with that counter — query the hosted endpoint`s GET /stats route or info://stats resource to read live numbers.',
        }
      : payload;

  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(body, null, 2),
      },
    ],
  };
};

resourceRegistry.register(statsResource, statsHandler);
