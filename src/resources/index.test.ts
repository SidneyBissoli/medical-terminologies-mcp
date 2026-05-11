import { describe, it, expect } from 'vitest';
import { resourceRegistry } from '../server-core.js';

// Side-effect imports — registers the resources and at least one tool
// module so info://server can report a non-zero tool_count.
import './index.js';
import '../tools/cid10.js';

describe('resources/index registration', () => {
  it('registers info://server', () => {
    expect(resourceRegistry.hasResource('info://server')).toBe(true);
  });

  it('registers info://cid10/chapters', () => {
    expect(resourceRegistry.hasResource('info://cid10/chapters')).toBe(true);
  });

  it('registers info://licenses', () => {
    expect(resourceRegistry.hasResource('info://licenses')).toBe(true);
  });

  it('every registered resource has uri, name, description, and mimeType', () => {
    for (const r of resourceRegistry.getResources()) {
      expect(r.uri).toBeTruthy();
      expect(r.name).toBeTruthy();
      expect(r.description, `resource "${r.uri}" missing description`).toBeTruthy();
      expect(r.mimeType, `resource "${r.uri}" missing mimeType`).toBeTruthy();
    }
  });
});

describe('resources/index handlers', () => {
  function textOf(content: { text: string } | { blob: string }): string {
    if (!('text' in content)) throw new Error('expected text content, got blob');
    return content.text;
  }

  it('info://server returns JSON with version, tool_count, terminologies', async () => {
    const handler = resourceRegistry.getHandler('info://server');
    expect(handler).toBeDefined();
    const result = await handler!('info://server');
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].uri).toBe('info://server');
    expect(result.contents[0].mimeType).toBe('application/json');
    const body = JSON.parse(textOf(result.contents[0]));
    expect(body.name).toBe('medical-terminologies-mcp');
    expect(typeof body.version).toBe('string');
    expect(body.tool_count).toBeGreaterThan(0);
    expect(Array.isArray(body.terminologies)).toBe(true);
    expect(body.terminologies.length).toBeGreaterThanOrEqual(6);
  });

  it('info://cid10/chapters returns the 22 chapters', async () => {
    const handler = resourceRegistry.getHandler('info://cid10/chapters');
    expect(handler).toBeDefined();
    const result = await handler!('info://cid10/chapters');
    const body = JSON.parse(textOf(result.contents[0]));
    expect(body.source).toContain('DataSUS');
    expect(body.count).toBe(22);
    expect(body.chapters).toHaveLength(22);
  });

  it('info://licenses returns markdown content mentioning the major terminologies', async () => {
    const handler = resourceRegistry.getHandler('info://licenses');
    expect(handler).toBeDefined();
    const result = await handler!('info://licenses');
    expect(result.contents[0].mimeType).toBe('text/markdown');
    const text = textOf(result.contents[0]);
    expect(text).toContain('ICD-11');
    expect(text).toContain('LOINC');
    expect(text).toContain('SNOMED CT');
    expect(text).toContain('CID-10');
    expect(text).toContain('lookup layer');
  });
});
