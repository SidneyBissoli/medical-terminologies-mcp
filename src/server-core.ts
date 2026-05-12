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
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  Tool,
  CallToolResult,
  Prompt,
  GetPromptResult,
  Resource,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';
import pkg from '../package.json';
import { logger } from './utils/logger.js';

export const SERVER_INFO = {
  name: pkg.name,
  version: pkg.version,
  description: 'Unified MCP server for seven medical terminologies (ICD-11, SNOMED CT, LOINC, RxNorm, MeSH, ATC, CID-10) with authoritative WHO ICD-10→ICD-11 mapping. 37 tools, hosted endpoint available, MIT.',
} as const;

export type ToolHandler = (args: Record<string, unknown>) => Promise<CallToolResult>;
export type PromptHandler = (args: Record<string, string | undefined>) => Promise<GetPromptResult>;
export type ResourceHandler = (uri: string) => Promise<ReadResourceResult>;

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

class PromptRegistry {
  private prompts: Map<string, Prompt> = new Map();
  private handlers: Map<string, PromptHandler> = new Map();

  register(prompt: Prompt, handler: PromptHandler): void {
    this.prompts.set(prompt.name, prompt);
    this.handlers.set(prompt.name, handler);
  }

  getPrompts(): Prompt[] {
    return Array.from(this.prompts.values());
  }

  getHandler(name: string): PromptHandler | undefined {
    return this.handlers.get(name);
  }

  hasPrompt(name: string): boolean {
    return this.prompts.has(name);
  }
}

class ResourceRegistry {
  private resources: Map<string, Resource> = new Map();
  private handlers: Map<string, ResourceHandler> = new Map();

  register(resource: Resource, handler: ResourceHandler): void {
    this.resources.set(resource.uri, resource);
    this.handlers.set(resource.uri, handler);
  }

  getResources(): Resource[] {
    return Array.from(this.resources.values());
  }

  getHandler(uri: string): ResourceHandler | undefined {
    return this.handlers.get(uri);
  }

  hasResource(uri: string): boolean {
    return this.resources.has(uri);
  }
}

export const toolRegistry = new ToolRegistry();
export const promptRegistry = new PromptRegistry();
export const resourceRegistry = new ResourceRegistry();

export function createServer(): Server {
  const server = new Server(
    {
      name: SERVER_INFO.name,
      version: SERVER_INFO.version,
    },
    {
      capabilities: {
        tools: {},
        prompts: {},
        resources: {},
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

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: promptRegistry.getPrompts(),
    };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const handler = promptRegistry.getHandler(name);
    if (!handler) {
      throw new Error(`Unknown prompt "${name}". Use prompts/list to see available prompts.`);
    }

    return await handler(args ?? {});
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: resourceRegistry.getResources(),
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    const handler = resourceRegistry.getHandler(uri);
    if (!handler) {
      throw new Error(`Unknown resource "${uri}". Use resources/list to see available resources.`);
    }

    return await handler(uri);
  });

  return server;
}
