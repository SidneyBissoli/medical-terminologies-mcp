/**
 * Platform-agnostic MCP server core — runs unchanged on Node (stdio +
 * Node HTTP) and Cloudflare Workers (web-standard fetch). Lives in its
 * own file because importing `src/server.ts` from a Workers bundle would
 * drag in `node:http` and `@hono/node-server` (the SDK's Node wrapper
 * for StreamableHTTPServerTransport) — neither of which exist in the
 * Workers runtime.
 *
 * What goes here:  createServer, ToolRegistry, SERVER_INFO, shared types.
 * What stays in server.ts:  startServer (stdio), startHttpServer (Node http).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import pkg from '../package.json';
import { logger } from './utils/logger.js';

export const SERVER_INFO = {
  name: pkg.name,
  version: pkg.version,
  description: 'MCP Server that unifies access to major global medical terminologies (ICD-11, SNOMED CT, LOINC, RxNorm, MeSH) through a standardized interface',
} as const;

export type ToolHandler = (args: Record<string, unknown>) => Promise<CallToolResult>;

class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private handlers: Map<string, ToolHandler> = new Map();

  register(tool: Tool, handler: ToolHandler): void {
    this.tools.set(tool.name, tool);
    this.handlers.set(tool.name, handler);
  }

  getTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  getHandler(name: string): ToolHandler | undefined {
    return this.handlers.get(name);
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }
}

export const toolRegistry = new ToolRegistry();

export function createServer(): Server {
  const server = new Server(
    {
      name: SERVER_INFO.name,
      version: SERVER_INFO.version,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: toolRegistry.getTools(),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const handler = toolRegistry.getHandler(name);
    if (!handler) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: Unknown tool "${name}". Use list_tools to see available tools.`,
          },
        ],
        isError: true,
      };
    }

    try {
      return await handler(args ?? {});
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ tool: name, err: errorMessage }, 'Tool handler failed');

      return {
        content: [
          {
            type: 'text',
            text: `Error executing tool "${name}": ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}
