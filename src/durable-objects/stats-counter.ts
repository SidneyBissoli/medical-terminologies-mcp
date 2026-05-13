/**
 * StatsCounter Durable Object — persistent, single-instance tool-invocation
 * counter for the hosted Workers endpoint.
 *
 * What it counts: successful tool dispatch attempts (a count per tool name,
 * plus a `total`). The first-seen timestamp is captured on first increment
 * so the public `/stats` endpoint can show "X invocations since {date}".
 *
 * What it does NOT capture: stdio-mode invocations (each user installs and
 * runs locally — privacy-preserving by design, not measurable from here),
 * payload contents, user identifiers, IP addresses, errors. Counts only.
 *
 * Why a Durable Object and not just an in-memory counter:
 *   Cloudflare Workers isolates are stateless and die freely between
 *   requests, especially under low traffic where cold starts are common.
 *   An in-memory counter would reset constantly, producing wildly
 *   under-reported numbers that look like "nobody is using this" even
 *   when there's real adoption.
 *
 * Why a single DO instance ("global") and not sharded:
 *   At our scale (well under 1k req/s expected for the foreseeable
 *   future), one DO is plenty. Sharding only matters when the DO becomes
 *   a write hotspot — Cloudflare publishes that as ~1k writes/s per DO,
 *   way above what we'll see.
 *
 * Storage shape (DO storage is a key-value store, persisted to durable
 * SQLite under the hood):
 *   `since`  → ISO timestamp of first increment (set once, never overwritten)
 *   `total`  → integer count of all increments
 *   `tool:<name>` → integer count for that tool
 *
 * Reads are sub-millisecond (in-memory after first access); writes are
 * batched and persisted asynchronously by the runtime.
 */

/**
 * Minimal DurableObjectState shape we depend on. Importing the full
 * @cloudflare/workers-types just for this one interface inflates the
 * Node build and isn't necessary — the Worker runtime hands us the
 * real type; here we only need the storage methods we actually call.
 */
interface DurableObjectState {
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    put<T = unknown>(key: string, value: T): Promise<void>;
    list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>;
  };
}

interface StatsPayload {
  scope: string;
  since: string | null;
  as_of: string;
  total_invocations: number;
  by_tool: Record<string, number>;
  top_tool: string | null;
}

const HOSTED_ENDPOINT = 'medical-terminologies-mcp.sidneybissoli.workers.dev';

export class StatsCounter {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  /**
   * Single fetch entrypoint — the Worker calls this DO via
   *   stub.fetch(new Request('https://do/<route>', { method, body }))
   *
   * Routes:
   *   POST /increment   body: {"tool": "<name>"} → 204
   *   GET  /read        → 200 JSON StatsPayload
   *
   * The fake hostname doesn't matter — DO `fetch` ignores the host part;
   * only path + method + body are honored.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/increment') {
      const body = (await request.json().catch(() => null)) as { tool?: unknown } | null;
      const tool = body && typeof body.tool === 'string' ? body.tool : null;
      if (!tool) {
        return new Response('missing tool', { status: 400 });
      }
      await this.increment(tool);
      return new Response(null, { status: 204 });
    }

    if (request.method === 'GET' && url.pathname === '/read') {
      const payload = await this.read();
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('not found', { status: 404 });
  }

  private async increment(tool: string): Promise<void> {
    // First-write sets the "since" timestamp once. After that it's frozen.
    const since = await this.state.storage.get<string>('since');
    if (!since) {
      await this.state.storage.put('since', new Date().toISOString());
    }

    const toolKey = `tool:${tool}`;
    const [currentTotal, currentTool] = await Promise.all([
      this.state.storage.get<number>('total'),
      this.state.storage.get<number>(toolKey),
    ]);

    await Promise.all([
      this.state.storage.put('total', (currentTotal ?? 0) + 1),
      this.state.storage.put(toolKey, (currentTool ?? 0) + 1),
    ]);
  }

  private async read(): Promise<StatsPayload> {
    const [since, total, toolEntries] = await Promise.all([
      this.state.storage.get<string>('since'),
      this.state.storage.get<number>('total'),
      this.state.storage.list<number>({ prefix: 'tool:' }),
    ]);

    const byTool: Record<string, number> = {};
    let topTool: string | null = null;
    let topCount = 0;

    for (const [key, count] of toolEntries.entries()) {
      const toolName = key.slice('tool:'.length);
      byTool[toolName] = count;
      if (count > topCount) {
        topCount = count;
        topTool = toolName;
      }
    }

    return {
      scope: `hosted endpoint at ${HOSTED_ENDPOINT}`,
      since: since ?? null,
      as_of: new Date().toISOString(),
      total_invocations: total ?? 0,
      by_tool: byTool,
      top_tool: topTool,
    };
  }
}
