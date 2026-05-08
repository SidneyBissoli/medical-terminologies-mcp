import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { ApiError } from '../types/index.js';

/**
 * MCP behavioral hints applied to every tool in this server. They all read
 * from external terminology APIs, never write — so they're read-only,
 * non-destructive, and idempotent (same input → same output, modulo upstream
 * data changes). openWorldHint=true reflects that they reach out to APIs
 * not under this server's control.
 *
 * Clients that honor these hints (e.g. Claude Desktop) can skip
 * confirmation prompts and let LLMs call them more freely.
 */
export const READ_ONLY_TOOL_ANNOTATIONS: NonNullable<Tool['annotations']> = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
  destructiveHint: false,
};

/**
 * Converts a Zod schema into the JSON Schema shape MCP expects for
 * Tool.inputSchema. Strips the $schema metadata key (MCP doesn't need it)
 * and inlines all references so clients see a flat object schema.
 */
// `zodToJsonSchema`'s typed signature has overloads whose generics chain
// through Zod v3's branded refinements and trip TS2589 ("type instantiation
// excessively deep"). Erasing the call-site type sidesteps it; the runtime
// behavior is unchanged and the return shape is enforced below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toJsonSchema = zodToJsonSchema as (schema: unknown, options?: unknown) => any;

export function buildInputSchema(schema: z.ZodTypeAny): Tool['inputSchema'] {
  const json = toJsonSchema(schema, {
    $refStrategy: 'none',
    target: 'jsonSchema7',
  }) as Record<string, unknown>;
  delete json.$schema;
  return json as Tool['inputSchema'];
}

function formatZodError(error: z.ZodError): string {
  return error.errors
    .map((e) => {
      const path = e.path.join('.');
      return path ? `${path}: ${e.message}` : e.message;
    })
    .join('; ');
}

/**
 * Centralized error mapper for tool handlers. Converts Zod validation
 * failures and ApiError instances into MCP CallToolResult error responses.
 * Re-throws anything else so the server.ts dispatcher can log + wrap it.
 *
 * Handlers that need custom error handling (e.g., a NOT_FOUND that should
 * render as a non-error informational result) should branch on the error
 * shape first and fall back to this helper for the generic cases.
 */
export function handleToolError(error: unknown): CallToolResult {
  if (error instanceof z.ZodError) {
    return {
      content: [{ type: 'text', text: `Validation error: ${formatZodError(error)}` }],
      isError: true,
    };
  }
  if (error instanceof ApiError) {
    return {
      content: [{ type: 'text', text: `API error (${error.code}): ${error.message}` }],
      isError: true,
    };
  }
  throw error;
}
