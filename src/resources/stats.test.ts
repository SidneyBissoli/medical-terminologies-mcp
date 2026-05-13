import { describe, it, expect, afterEach } from 'vitest';
import { resourceRegistry } from '../server-core.js';
import {
  getStatsRecorder,
  setStatsRecorder,
  type StatsRecorder,
  type StatsPayload,
} from '../utils/stats.js';

// Side-effect import — registers info://stats
import './stats.js';

class FixedRecorder implements StatsRecorder {
  constructor(private payload: StatsPayload | null) {}
  async increment(): Promise<void> {}
  async read(): Promise<StatsPayload | null> {
    return this.payload;
  }
}

function textOf(content: { text: string } | { blob: string }): string {
  if (!('text' in content)) throw new Error('expected text content, got blob');
  return content.text;
}

describe('info://stats resource', () => {
  const original = getStatsRecorder();
  afterEach(() => setStatsRecorder(original));

  it('is registered after the side-effect import', () => {
    expect(resourceRegistry.hasResource('info://stats')).toBe(true);
  });

  it('returns the live payload when the recorder has data', async () => {
    setStatsRecorder(
      new FixedRecorder({
        scope: 'hosted endpoint at medical-terminologies-mcp.sidneybissoli.workers.dev',
        since: '2026-05-13T00:00:00.000Z',
        as_of: '2026-05-15T12:00:00.000Z',
        total_invocations: 42,
        by_tool: { icd11_search: 30, loinc_search: 12 },
        top_tool: 'icd11_search',
      }),
    );

    const handler = resourceRegistry.getHandler('info://stats');
    expect(handler).toBeDefined();
    const result = await handler!('info://stats');
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].mimeType).toBe('application/json');
    const body = JSON.parse(textOf(result.contents[0]));
    expect(body.total_invocations).toBe(42);
    expect(body.top_tool).toBe('icd11_search');
    expect(body.by_tool.icd11_search).toBe(30);
  });

  it('returns a placeholder when the recorder is Noop (no shared counter)', async () => {
    setStatsRecorder(new FixedRecorder(null));
    const handler = resourceRegistry.getHandler('info://stats');
    const result = await handler!('info://stats');
    const body = JSON.parse(textOf(result.contents[0]));
    expect(body.scope).toBe('stats unavailable on this transport');
    expect(body.note).toContain('hosted Cloudflare Workers endpoint');
    // Placeholder must not lie with a fake zero count.
    expect(body.total_invocations).toBeUndefined();
  });
});
