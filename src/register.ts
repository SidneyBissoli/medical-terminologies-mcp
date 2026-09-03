/**
 * SDK v2 registration layer — the single place where the module-level
 * registries (populated by the side-effect imports below) are projected
 * onto a fresh `McpServer`.
 *
 * Design decisions of the v2 migration (Fase Medical, Sessão 02):
 *
 * - The advertised JSON Schemas are the exact objects `buildInputSchema` /
 *   `buildOutputSchema` already produce — passed through the SDK's
 *   `fromJsonSchema` so `tools/list` stays byte-identical to the 1.x
 *   surface. We do NOT hand the SDK the Zod schemas: its own emitter
 *   would re-derive slightly different JSON, and the tool files' JSON is
 *   the canonical published surface.
 *
 * - `fromJsonSchema` gets a permissive validator: SDK-level validation is
 *   deliberately OFF, matching the 1.x behavior where the low-level
 *   `Server` never validated. Input validation stays inside each handler
 *   (Zod, via `handleToolError`) so invalid arguments keep producing the
 *   pedagogical `isError` text results instead of protocol-level
 *   InvalidParams errors. Output validation is covered by the schema
 *   fixture tests, not at runtime.
 *   NOTE the SDK still requires `structuredContent` on every non-error
 *   result of a tool that declares `outputSchema` — that check runs
 *   before any validator and cannot be disabled.
 *
 * - The dispatcher behavior of the 1.x server-core is preserved verbatim
 *   in the `handle` wrapper: `recordInvocation` (StatsCounter, hosted
 *   only) fires after every handler resolution (including `isError`
 *   results), unexpected throws are logged and wrapped into an error
 *   result, and the optional `record` hook (UsageTracker on the Worker)
 *   sees `tool_call`/`tool_error` events — names and counts only, never
 *   arguments or results.
 */

import {
  McpServer,
  fromJsonSchema,
  type jsonSchemaValidator,
  type JsonSchemaValidator,
  type JsonSchemaValidatorResult,
  type JsonSchemaType,
  type Prompt,
  type StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import {
  SERVER_INFO,
  SERVER_INSTRUCTIONS,
  SERVER_TITLE,
  SERVER_WEBSITE_URL,
  SERVER_ICONS,
  toolRegistry,
  promptRegistry,
  resourceRegistry,
  type ToolHandler,
} from './server-core.js';
import { logger } from './utils/logger.js';
import { recordInvocation } from './utils/stats.js';
import { runWithFetchMeta } from './utils/fetch-meta.js';

// Tool side-effect imports — each module registers its tools at load time.
// This is now the ONLY place that needs the full list; both entry points
// (src/index.ts and the Worker) reach the registries through this module.
// The meta-test in src/index.test.ts pins the list against src/{tools,
// prompts,resources}/*.ts.
import './tools/icd11.js';
import './tools/loinc.js';
import './tools/rxnorm.js';
import './tools/mesh.js';
import './tools/snomed.js';
import './tools/crosswalk.js';
import './tools/atc.js';
import './tools/cid10.js';
import './tools/versioning.js';
// `search`/`fetch` (ChatGPT Deep Research contract) — registered last so the
// wire order keeps the terminology tools first.
import './tools/deep-research.js';

// Prompts — orchestration templates exposed to MCP clients
import './prompts/index.js';

// Resources — static reference content exposed by URI
import './resources/index.js';
// Stats counter resource — DO-backed on Workers, placeholder on stdio
import './resources/stats.js';
import { announceServedVersions } from './discover.js';

/**
 * Validator provider that accepts every value. See the module docstring:
 * SDK-level validation is intentionally disabled to keep 1.x behavior
 * (handlers validate with Zod and return pedagogical error results).
 */
const permissiveValidator: jsonSchemaValidator = {
  getValidator<T>(): JsonSchemaValidator<T> {
    return (input: unknown): JsonSchemaValidatorResult<T> => ({
      valid: true,
      data: input as T,
      errorMessage: undefined,
    });
  },
};

/** Advertise an existing JSON Schema verbatim, without SDK-side validation. */
function passthroughSchema(schema: unknown): StandardSchemaWithJSON {
  return fromJsonSchema(schema as JsonSchemaType, permissiveValidator);
}

/**
 * Rebuilds a prompt's `argsSchema` from its wire-format `arguments` list.
 * The SDK derives `prompts/list` arguments back from this schema via
 * properties + required, so the round trip preserves name/description/
 * required exactly.
 */
function promptArgsSchema(prompt: Prompt): StandardSchemaWithJSON | undefined {
  const args = prompt.arguments ?? [];
  if (args.length === 0) return undefined;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const arg of args) {
    properties[arg.name] = {
      type: 'string',
      ...(arg.description !== undefined ? { description: arg.description } : {}),
    };
    if (arg.required) required.push(arg.name);
  }
  return passthroughSchema({
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  });
}

/**
 * Optional per-tool usage hook: `tool_call` fires on every invocation,
 * `tool_error` additionally when the call fails (error result or throw).
 * The stdio entry passes nothing; the Cloudflare Worker passes its
 * UsageTracker Durable Object recorder.
 */
export type ToolUsageRecorder = (kind: 'tool_call' | 'tool_error', name: string) => void;

/**
 * Registers every tool, resource, and prompt from the module registries
 * onto a given `McpServer`. Kept separate from `createServer` so the
 * Cloudflare Worker (which builds its own `McpServer` per request) can
 * reuse the exact same registrations.
 */
export function registerAll(server: McpServer, record?: ToolUsageRecorder): void {
  const handle = (name: string, handler: ToolHandler) =>
    async (args: unknown) => {
      try {
        // The fetch-meta collector gives the provenance block the REAL
        // upstream extraction instant per source (cache hits keep the
        // original fetch instant) — see src/utils/fetch-meta.ts.
        const result = await runWithFetchMeta(() =>
          handler((args ?? {}) as Record<string, unknown>),
        );
        // Fire-and-forget stats increment (StatsCounter DO on the hosted
        // endpoint, no-op on stdio). Counts every dispatch that resolved,
        // including isError results — same semantics as the 1.x dispatcher.
        recordInvocation(name);
        record?.('tool_call', name);
        if (result.isError === true) record?.('tool_error', name);
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ tool: name, err: errorMessage }, 'Tool handler failed');
        record?.('tool_call', name);
        record?.('tool_error', name);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error executing tool "${name}": ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    };

  for (const tool of toolRegistry.getTools()) {
    const handler = toolRegistry.getHandler(tool.name);
    if (!handler) continue; // registry invariant: register() always pairs them
    server.registerTool(
      tool.name,
      {
        ...(tool.title !== undefined ? { title: tool.title } : {}),
        description: tool.description,
        inputSchema: passthroughSchema(tool.inputSchema),
        ...(tool.outputSchema !== undefined
          ? { outputSchema: passthroughSchema(tool.outputSchema) }
          : {}),
        ...(tool.annotations !== undefined ? { annotations: tool.annotations } : {}),
      },
      handle(tool.name, handler),
    );
  }

  for (const prompt of promptRegistry.getPrompts()) {
    const handler = promptRegistry.getHandler(prompt.name);
    if (!handler) continue;
    const argsSchema = promptArgsSchema(prompt);
    server.registerPrompt(
      prompt.name,
      {
        // Display title. The registry name is a kebab-case identifier
        // (`find-medical-code`); `mcpscore` flags prompts without a human title
        // (`prompts_titles_present`), and a client picker shows the title.
        // Derived from the name, so a prompt added later cannot forget it.
        title: displayTitle(prompt.name),
        description: prompt.description,
        ...(argsSchema !== undefined ? { argsSchema } : {}),
      },
      async (args: unknown) => handler((args ?? {}) as Record<string, string | undefined>),
    );
  }

  for (const resource of resourceRegistry.getResources()) {
    const handler = resourceRegistry.getHandler(resource.uri);
    if (!handler) continue;
    server.registerResource(
      resource.name,
      resource.uri,
      {
        // Resource names here are already human-readable ("CID-10 chapters"),
        // so the title IS the name — but it has to be declared, or the client
        // shows the URI and `mcpscore` fails `resources_titles_present`.
        title: resource.name,
        ...(resource.description !== undefined ? { description: resource.description } : {}),
        ...(resource.mimeType !== undefined ? { mimeType: resource.mimeType } : {}),
      },
      async (uri: URL) => handler(uri.href),
    );
  }
}

/**
 * Builds a fresh, fully registered `McpServer`. Side-effect-free beyond
 * object allocation — no transport is connected, so it is safe to call
 * from tests and once per request on stateless HTTP transports.
 */
/**
 * Turns a kebab-case prompt identifier into a display title
 * (`cid10-portuguese-lookup` -> `Cid10 Portuguese Lookup`). Derived rather than
 * hand-written so a prompt added later cannot ship without one.
 */
function displayTitle(nome: string): string {
  return nome
    .split(/[-_]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: SERVER_INFO.name,
      version: SERVER_INFO.version,
      title: SERVER_TITLE,
      websiteUrl: SERVER_WEBSITE_URL,
      icons: SERVER_ICONS,
    },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerAll(server);
  // Announce every protocol revision this server actually serves on
  // `server/discover`, not only the modern ones the SDK filters — see
  // src/discover.ts.
  announceServedVersions(server);
  return server;
}
