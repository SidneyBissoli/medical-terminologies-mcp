import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/server';
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
 * Converts a Zod schema into the JSON Schema shape MCP expects, using Zod 4's
 * native `z.toJSONSchema`. `target: 'draft-07'` matches what MCP clients expect,
 * `reused: 'inline'` inlines references so clients see a flat object schema (the
 * Zod 3 `zod-to-json-schema` equivalent was `$refStrategy: 'none'`), and the
 * `$schema` metadata key is stripped because MCP doesn't need it.
 *
 * `io` distinguishes the input vs output projection of a schema — Zod 4 treats
 * e.g. `.default()` fields as optional on input but present on output — which is
 * exactly the input/output split these two helpers exist to express.
 */
// `z.toJSONSchema`'s return type chains through Zod's branded generics and can
// trip TS2589 ("type instantiation excessively deep"); erasing the call-site
// type sidesteps it. Runtime behavior is unchanged and the return shape is
// enforced by the `as` cast on each helper's result below.
const toJsonSchema = z.toJSONSchema as (schema: unknown, options?: unknown) => Record<string, unknown>;

export function buildInputSchema(schema: z.ZodTypeAny): Tool['inputSchema'] {
  const json = toJsonSchema(schema, {
    target: 'draft-07',
    reused: 'inline',
    io: 'input',
  });
  delete json.$schema;
  return json as Tool['inputSchema'];
}

/**
 * Same conversion as buildInputSchema, but typed for Tool.outputSchema.
 * Kept as a separate function so call sites read clearly: input vs output.
 */
export function buildOutputSchema(schema: z.ZodTypeAny): NonNullable<Tool['outputSchema']> {
  const json = toJsonSchema(schema, {
    target: 'draft-07',
    reused: 'inline',
    io: 'output',
  });
  delete json.$schema;
  return json as NonNullable<Tool['outputSchema']>;
}

function formatZodError(error: z.ZodError): string {
  return error.issues
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
