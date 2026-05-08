import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  buildInputSchema,
  buildOutputSchema,
  handleToolError,
  READ_ONLY_TOOL_ANNOTATIONS,
} from './zod-schema.js';
import { ApiError } from '../types/index.js';

describe('buildInputSchema', () => {
  it('strips $schema and produces a JSON Schema object', () => {
    const schema = z.object({
      name: z.string().describe('the name'),
      age: z.number().int().min(0).optional(),
    });
    const json = buildInputSchema(schema) as Record<string, unknown>;
    expect(json).not.toHaveProperty('$schema');
    expect(json.type).toBe('object');
    expect(json.properties).toBeDefined();
    expect(json.required).toEqual(['name']);
  });

  it('preserves regex patterns from Zod', () => {
    const schema = z.object({
      sctid: z.string().regex(/^\d+$/, 'SCTID must be numeric'),
    });
    const json = buildInputSchema(schema) as unknown as {
      properties: { sctid: { pattern: string } };
    };
    expect(json.properties.sctid.pattern).toBe('^\\d+$');
  });

  it('preserves enum constraints', () => {
    const schema = z.object({
      direction: z.enum(['parents', 'children']),
    });
    const json = buildInputSchema(schema) as unknown as {
      properties: { direction: { enum: string[] } };
    };
    expect(json.properties.direction.enum).toEqual(['parents', 'children']);
  });

  it('preserves descriptions from .describe()', () => {
    const schema = z.object({
      query: z.string().describe('search term'),
    });
    const json = buildInputSchema(schema) as unknown as {
      properties: { query: { description: string } };
    };
    expect(json.properties.query.description).toBe('search term');
  });
});

describe('buildOutputSchema', () => {
  it('produces the same shape as buildInputSchema (typed differently)', () => {
    const schema = z.object({
      results: z.array(z.object({ id: z.string() })),
    });
    const json = buildOutputSchema(schema) as Record<string, unknown>;
    expect(json).not.toHaveProperty('$schema');
    expect(json.type).toBe('object');
    expect(json.properties).toBeDefined();
  });
});

describe('handleToolError', () => {
  it('wraps ZodError into a CallToolResult with isError=true and field paths', () => {
    const schema = z.object({ loinc_num: z.string().regex(/^\d{1,5}-\d$/) });
    const result = schema.safeParse({ loinc_num: 'abc' });
    if (result.success) throw new Error('expected fail');

    const ctr = handleToolError(result.error);
    expect(ctr.isError).toBe(true);
    expect(ctr.content[0].type).toBe('text');
    const text = (ctr.content[0] as { text: string }).text;
    expect(text).toContain('Validation error');
    expect(text).toContain('loinc_num');
  });

  it('wraps ApiError into a CallToolResult with code in message', () => {
    const apiErr = new ApiError('upstream down', 'NETWORK_ERROR', 503);
    const ctr = handleToolError(apiErr);
    expect(ctr.isError).toBe(true);
    const text = (ctr.content[0] as { text: string }).text;
    expect(text).toContain('NETWORK_ERROR');
    expect(text).toContain('upstream down');
  });

  it('rethrows unrecognized errors so server.ts can log/wrap them', () => {
    expect(() => handleToolError(new Error('something else'))).toThrow('something else');
  });
});

describe('READ_ONLY_TOOL_ANNOTATIONS', () => {
  it('declares read-only/idempotent/open-world/non-destructive', () => {
    expect(READ_ONLY_TOOL_ANNOTATIONS).toEqual({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
      destructiveHint: false,
    });
  });
});
