import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import pkg from '../package.json';
import { logger } from './utils/logger.js';

/**
 * Server metadata
 */
export const SERVER_INFO = {
  name: pkg.name,
  version: pkg.version,
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

/**
 * Starts the MCP server with stdio transport
 * @param server - Server instance to start
 */
export async function startServer(server: Server): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info(
    {
      name: SERVER_INFO.name,
      version: SERVER_INFO.version,
      tool_count: toolRegistry.getTools().length,
    },
    'Server started over stdio',
  );
}

/**
 * Starts the MCP server with Streamable HTTP transport in stateless mode.
 *
 * Stateless was chosen over stateful so each request is independent — no
 * session storage on the server side. This is what hosted-runtime targets
 * (Cloudflare Workers, Smithery, etc.) expect, and it keeps the local-dev
 * story simple (no session-cookie tracking, no Mcp-Session-Id headers to
 * thread through curl).
 *
 * @param mcpServer - Server instance to start
 * @param port - TCP port to listen on (use 0 for an ephemeral port in tests)
 * @param host - Bind address. Defaults to 127.0.0.1 (loopback) so a dev
 *               machine doesn't accidentally expose the server. Pass
 *               '0.0.0.0' for container/hosted deployments.
 * @returns The underlying http.Server (for shutdown) and the transport
 *          (mostly for tests that need to introspect it).
 */
export async function startHttpServer(
  mcpServer: Server,
  port: number,
  host: string = '127.0.0.1',
): Promise<{ httpServer: HttpServer; transport: StreamableHTTPServerTransport }> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await mcpServer.connect(transport);

  const httpServer = createHttpServer((req, res) => {
    // CORS for browser-based clients (MCP Inspector web UI, playgrounds).
    // Permissive on purpose — this transport is meant for hosted/public use.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Mcp-Session-Id, Last-Event-Id, Mcp-Protocol-Version',
    );
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    // Lightweight health probe for load balancers / uptime monitors —
    // does not exercise any tool, just confirms the process is alive.
    if (req.method === 'GET' && req.url === '/health') {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200).end(
        JSON.stringify({
          status: 'ok',
          name: SERVER_INFO.name,
          version: SERVER_INFO.version,
          tool_count: toolRegistry.getTools().length,
        }),
      );
      return;
    }

    if (req.url === '/mcp' || req.url === '/') {
      transport.handleRequest(req, res).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err: msg, method: req.method, url: req.url }, 'HTTP transport error');
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: msg }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found', hint: 'POST JSON-RPC to /mcp; GET /health for liveness' }));
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => resolve());
  });

  const address = httpServer.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;

  logger.info(
    {
      name: SERVER_INFO.name,
      version: SERVER_INFO.version,
      tool_count: toolRegistry.getTools().length,
      host,
      port: boundPort,
    },
    'Server started over Streamable HTTP',
  );

  return { httpServer, transport };
}
