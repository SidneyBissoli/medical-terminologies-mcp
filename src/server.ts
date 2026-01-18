import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';

/**
 * Server metadata
 */
export const SERVER_INFO = {
  name: 'medical-terminologies-mcp',
  version: '1.0.0',
  description: 'MCP Server that unifies access to major global medical terminologies (ICD-11, SNOMED CT, LOINC, RxNorm, MeSH) through a standardized interface',
} as const;

/**
 * Tool handler function type
 */
export type ToolHandler = (args: Record<string, unknown>) => Promise<CallToolResult>;

/**
 * Registry for tool definitions and handlers
 */
class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private handlers: Map<string, ToolHandler> = new Map();

  /**
   * Registers a tool with its handler
   * @param tool - Tool definition
   * @param handler - Function to handle tool invocations
   */
  register(tool: Tool, handler: ToolHandler): void {
    this.tools.set(tool.name, tool);
    this.handlers.set(tool.name, handler);
  }

  /**
   * Gets all registered tools
   * @returns Array of tool definitions
   */
  getTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Gets a tool handler by name
   * @param name - Tool name
   * @returns Tool handler or undefined
   */
  getHandler(name: string): ToolHandler | undefined {
    return this.handlers.get(name);
  }

  /**
   * Checks if a tool is registered
   * @param name - Tool name
   * @returns true if tool exists
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }
}

/** Global tool registry */
export const toolRegistry = new ToolRegistry();

/**
 * Creates and configures the MCP server
 * @returns Configured Server instance
 */
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
    }
  );

  // Handle list tools request
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: toolRegistry.getTools(),
    };
  });

  // Handle tool invocations
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
      process.stderr.write(`[error] Tool "${name}" failed: ${errorMessage}\n`);

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

/**
 * Starts the MCP server with stdio transport
 * @param server - Server instance to start
 */
export async function startServer(server: Server): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write(`[info] ${SERVER_INFO.name} v${SERVER_INFO.version} started\n`);
  process.stderr.write(`[info] ${toolRegistry.getTools().length} tools available\n`);
}
