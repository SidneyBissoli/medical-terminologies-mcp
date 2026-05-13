import { describe, it, expect, afterEach } from 'vitest';
import {
  getStatsRecorder,
  setStatsRecorder,
  recordInvocation,
  type StatsRecorder,
  type StatsPayload,
} from './stats.js';

class MockRecorder implements StatsRecorder {
  public increments: string[] = [];
  public throws = false;
  public readResult: StatsPayload | null = null;

  async increment(toolName: string): Promise<void> {
    if (this.throws) throw new Error('mock-increment-failure');
    this.increments.push(toolName);
  }

  async read(): Promise<StatsPayload | null> {
    return this.readResult;
  }
}

describe('stats recorder abstraction', () => {
  // Save the recorder that's active at test-suite entry (the Noop default)
  // so each test can restore it; otherwise tests bleed state into each other.
  const original = getStatsRecorder();
  afterEach(() => {
    setStatsRecorder(original);
    delete (globalThis as { __MCP_WAIT_UNTIL?: unknown }).__MCP_WAIT_UNTIL;
  });

  it('default recorder is a no-op: increment resolves, read returns null', async () => {
    const r = getStatsRecorder();
    await expect(r.increment('foo')).resolves.toBeUndefined();
    await expect(r.read()).resolves.toBeNull();
  });

  it('setStatsRecorder swaps the active recorder', async () => {
    const mock = new MockRecorder();
    mock.readResult = {
      scope: 'test',
      since: null,
      as_of: 'now',
      total_invocations: 5,
      by_tool: { foo: 5 },
      top_tool: 'foo',
    };
    setStatsRecorder(mock);

    await getStatsRecorder().increment('foo');
    expect(mock.increments).toEqual(['foo']);

    const payload = await getStatsRecorder().read();
    expect(payload?.total_invocations).toBe(5);
  });

  it('recordInvocation calls the active recorder fire-and-forget', async () => {
    const mock = new MockRecorder();
    setStatsRecorder(mock);

    recordInvocation('icd11_search');
    // Give the microtask queue a turn so the unawaited promise resolves.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mock.increments).toEqual(['icd11_search']);
  });

  it('recordInvocation swallows recorder errors and does not throw', async () => {
    const mock = new MockRecorder();
    mock.throws = true;
    setStatsRecorder(mock);

    expect(() => recordInvocation('tool_x')).not.toThrow();
    // Wait for the promise rejection to be handled by the catch.
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Caller did NOT see an exception; the dispatcher continues normally.
  });

  it('recordInvocation passes its promise to globalThis.__MCP_WAIT_UNTIL when present', async () => {
    const mock = new MockRecorder();
    setStatsRecorder(mock);

    const waited: Promise<unknown>[] = [];
    (globalThis as { __MCP_WAIT_UNTIL?: (p: Promise<unknown>) => void }).__MCP_WAIT_UNTIL = (
      p,
    ) => {
      waited.push(p);
    };

    recordInvocation('tool_y');
    expect(waited).toHaveLength(1);
    await waited[0];
    expect(mock.increments).toEqual(['tool_y']);
  });
});
