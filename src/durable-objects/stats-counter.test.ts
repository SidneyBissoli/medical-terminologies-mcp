import { describe, it, expect, beforeEach } from 'vitest';
import { StatsCounter } from './stats-counter.js';

// In-memory mock of the DurableObjectState.storage surface we use.
// Real DO storage is durable + transactional; this mock is just a Map.
class MockStorage {
  private store = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.store.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
  }

  async list<T>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const prefix = options?.prefix ?? '';
    const result = new Map<string, T>();
    for (const [k, v] of this.store.entries()) {
      if (k.startsWith(prefix)) {
        result.set(k, v as T);
      }
    }
    return result;
  }
}

function makeCounter(): { counter: StatsCounter; storage: MockStorage } {
  const storage = new MockStorage();
  // Cast through unknown — the DO accepts our minimal interface.
  const counter = new StatsCounter({ storage } as unknown as ConstructorParameters<typeof StatsCounter>[0]);
  return { counter, storage };
}

async function increment(counter: StatsCounter, tool: string): Promise<Response> {
  return counter.fetch(
    new Request('https://do/increment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool }),
    }),
  );
}

async function read(counter: StatsCounter): Promise<{
  total_invocations: number;
  by_tool: Record<string, number>;
  top_tool: string | null;
  since: string | null;
}> {
  const resp = await counter.fetch(new Request('https://do/read', { method: 'GET' }));
  return resp.json() as Promise<{
    total_invocations: number;
    by_tool: Record<string, number>;
    top_tool: string | null;
    since: string | null;
  }>;
}

describe('StatsCounter DO', () => {
  let counter: StatsCounter;

  beforeEach(() => {
    ({ counter } = makeCounter());
  });

  it('starts empty: zero total, no top_tool, null since', async () => {
    const payload = await read(counter);
    expect(payload.total_invocations).toBe(0);
    expect(payload.by_tool).toEqual({});
    expect(payload.top_tool).toBeNull();
    expect(payload.since).toBeNull();
  });

  it('increment bumps both the per-tool counter and the total', async () => {
    await increment(counter, 'icd11_search');
    await increment(counter, 'icd11_search');
    await increment(counter, 'loinc_search');

    const payload = await read(counter);
    expect(payload.total_invocations).toBe(3);
    expect(payload.by_tool).toEqual({ icd11_search: 2, loinc_search: 1 });
    expect(payload.top_tool).toBe('icd11_search');
  });

  it('top_tool reflects the most-called name; ties pick whichever wins the comparison first (stable for our use)', async () => {
    await increment(counter, 'a_tool');
    await increment(counter, 'b_tool');
    await increment(counter, 'b_tool');

    const payload = await read(counter);
    expect(payload.top_tool).toBe('b_tool');
  });

  it('since is set on first increment and frozen thereafter', async () => {
    await increment(counter, 'tool_x');
    const first = await read(counter);
    const firstSince = first.since;
    expect(firstSince).toBeTruthy();

    // Multiple later increments must not change the since timestamp.
    await increment(counter, 'tool_x');
    await increment(counter, 'tool_y');
    const later = await read(counter);
    expect(later.since).toBe(firstSince);
  });

  it('increment without a tool field returns 400', async () => {
    const resp = await counter.fetch(
      new Request('https://do/increment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(resp.status).toBe(400);
  });

  it('unknown routes return 404', async () => {
    const resp = await counter.fetch(new Request('https://do/anything-else', { method: 'GET' }));
    expect(resp.status).toBe(404);
  });

  it('read response has the documented scope string and as_of timestamp', async () => {
    const resp = await counter.fetch(new Request('https://do/read', { method: 'GET' }));
    const payload = (await resp.json()) as { scope: string; as_of: string };
    expect(payload.scope).toContain('hosted endpoint');
    expect(payload.as_of).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
