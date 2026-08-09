/**
 * StatsCounter legado — preservação integral do contador público do worker
 * pré-template (n=857+ desde 13/05/2026; condição inegociável do decisor na
 * fundação da fase medical).
 *
 * Três responsabilidades, portadas verbatim do antigo src/worker.ts do pacote:
 *
 *  1. `bridgeStats(env)` instala o recorder DO-backed no pacote (uma vez por
 *     isolate) — o dispatcher compartilhado chama `recordInvocation(tool)`
 *     após cada dispatch bem-sucedido e o recorder encaminha ao DO singleton
 *     ("global"). Sem o binding STATS (dev/testes), o Noop do pacote fica.
 *  2. `statsResponse(env)` — GET /stats, payload JSON completo.
 *  3. `statsBadgeResponse(env)` — GET /stats/badge, formato endpoint do
 *     shields.io (badge do README).
 *
 * O DO em si (classe StatsCounter) vive no pacote pai e é re-exportado pelo
 * entrypoint (index.ts) para o runtime instanciar — mesmo class_name e mesmo
 * worker name = mesmo storage, nenhuma migração de números.
 */

import { setStatsRecorder } from "../../dist/worker-lib.js";
import type { Env } from "./types.js";

// Shapes locais dos contratos do pacote pai (tipos não sobrevivem no bundle
// JS; estes espelham StatsPayload/StatsRecorder de src/utils/stats.ts).
interface StatsPayload {
  scope: string;
  since: string | null;
  as_of: string;
  total_invocations: number;
  by_tool: Record<string, number>;
  top_tool: string | null;
}
interface StatsRecorder {
  increment(toolName: string): Promise<void>;
  read(): Promise<StatsPayload | null>;
}

/**
 * Recorder que encaminha ao StatsCounter DO via fetch (contrato do DO legado).
 *
 * O stub é resolvido POR CHAMADA, nunca cacheado: no runtime atual
 * (compatibility_date ≥ 2026) um stub de DO criado no contexto de um request
 * não pode fazer I/O em outro ("Cannot perform I/O on behalf of a different
 * request", tipo OutgoingFactory) — o worker pré-template cacheava o stub por
 * isolate e só funcionava sob a compatibility_date antiga (2025-12-01).
 */
class DurableObjectStatsRecorder implements StatsRecorder {
  constructor(private readonly namespace: DurableObjectNamespace) {}

  private stub(): { fetch(request: Request): Promise<Response> } {
    // Instância única nomeada — todos os isolates escrevem no mesmo DO.
    return this.namespace.get(this.namespace.idFromName("global"));
  }

  async increment(toolName: string): Promise<void> {
    await this.stub().fetch(
      new Request("https://do/increment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: toolName }),
      }),
    );
  }

  async read(): Promise<StatsPayload | null> {
    const response = await this.stub().fetch(new Request("https://do/read", { method: "GET" }));
    if (!response.ok) return null;
    return (await response.json()) as StatsPayload;
  }
}

/**
 * Instala o recorder DO-backed no pacote. Chamado a CADA request (atribuição
 * barata) para que nenhum objeto de I/O atravesse contextos de request.
 */
export function bridgeStats(env: Env): void {
  if (env.STATS) {
    setStatsRecorder(new DurableObjectStatsRecorder(env.STATS));
  }
  // Binding ausente (dev local sem migrations) → recorder Noop permanece:
  // increments viram no-op, reads retornam null e o resource info://stats
  // renderiza o placeholder.
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
} as const;

/**
 * GET /stats — payload JSON completo para consumo humano/programático.
 * Cache-Control curto para que curl-loops e o poller do badge não martelem
 * o DO; 60s mantém números com cara de frescos.
 */
export async function statsResponse(env: Env): Promise<Response> {
  const payload = env.STATS ? await new DurableObjectStatsRecorder(env.STATS).read() : null;
  const body = payload ?? {
    scope: "hosted endpoint at medical.sidneybissoli.com",
    since: null,
    as_of: new Date().toISOString(),
    total_invocations: 0,
    by_tool: {},
    top_tool: null,
  };
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60",
      ...corsHeaders,
    },
  });
}

/**
 * GET /stats/badge — formato endpoint do shields.io. A URL do badge no README
 * é `https://img.shields.io/endpoint?url=<encoded>/stats/badge`.
 *
 * Limiares de cor = sinal de adoção: zero (lightgrey), <100 (yellow),
 * <1000 (blue), ≥1000 (brightgreen).
 */
export async function statsBadgeResponse(env: Env): Promise<Response> {
  const payload = env.STATS ? await new DurableObjectStatsRecorder(env.STATS).read() : null;
  const total = payload?.total_invocations ?? 0;
  const color =
    total === 0 ? "lightgrey" : total < 100 ? "yellow" : total < 1000 ? "blue" : "brightgreen";
  const body = {
    schemaVersion: 1,
    label: "tool calls",
    message: total.toLocaleString("en-US"),
    color,
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
      ...corsHeaders,
    },
  });
}
