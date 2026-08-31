/**
 * Entrypoint do Worker — instância do template de hosting da Fase 0, com o
 * contador legado StatsCounter mantido AO LADO do UsageTracker (condição do
 * decisor: /stats, badge e histórico desde 13/05/2026 preservados verbatim).
 *
 * Fluxo por request: pontes (env → __MCP_ENV, waitUntil, StatsCounter
 * recorder) → rotas públicas (landing, /health, /status, /metrics, /stats,
 * /stats/badge, server card, glama) → Bearer auth opcional → rate limit por
 * cliente → createMcpHandler (stateless, factory cria um McpServer novo por
 * request — MCP SDK v2 + agents 0.20+).
 */

import { createMcpHandler } from "agents/mcp/server";
import { unknownCursorError } from "../../dist/worker-lib.js";

import { StatsCounter, toolRegistry } from "../../dist/worker-lib.js";
import { tagRequest, withAnalytics } from "./analytics.js";
import { checkAuth } from "./auth.js";
import { getServerCard } from "./card.js";
import { SERVER_CONFIG } from "./config.js";
import { bridgeEnv } from "./env-bridge.js";
import { landingResponse } from "./landing.js";
import { logger } from "./logger.js";
import { checkRateLimit } from "./rate-limit.js";
import { buildServer } from "./server.js";
import { bridgeStats, statsBadgeResponse, statsResponse } from "./stats-legacy.js";
import { buildStatus } from "./status.js";
import type { Env } from "./types.js";
import { createUsageRecorder, usageSnapshot, UsageTracker } from "./usage.js";

// O runtime instancia os Durable Objects a partir dos exports do entrypoint.
// StatsCounter vem do pacote pai (mesmo class_name do worker pré-template =
// mesmo storage; o histórico do contador não migra nem zera).
export { UsageTracker, StatsCounter };

// Baseline de uptime por isolate para o /health. Definido no primeiro request,
// NÃO no init do módulo — Date.now() em module-load no Workers pode retornar 0.
let isolateStartMs: number | null = null;

function json(data: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (isolateStartMs === null) {
      isolateStartMs = Date.now();
    }

    // Pontes por isolate/request para o código compartilhado do pacote:
    // credenciais (getEnv), recorder do StatsCounter e ctx.waitUntil (mantém o
    // isolate vivo até o RPC fire-and-forget do contador flushar).
    bridgeEnv(env);
    bridgeStats(env);
    (globalThis as { __MCP_WAIT_UNTIL?: (p: Promise<unknown>) => void }).__MCP_WAIT_UNTIL =
      ctx.waitUntil.bind(ctx);

    const url = new URL(request.url);
    const start = Date.now();
    const record = createUsageRecorder(env, ctx);

    // --- Rotas públicas, servidas antes de qualquer auth ---
    if (url.pathname === "/") return landingResponse();
    if (url.pathname === "/health") {
      // Shape JSON preservado do worker pré-template (tool_count + uptime).
      const uptimeMs = Date.now() - isolateStartMs;
      return json({
        status: "ok",
        name: SERVER_CONFIG.name,
        version: SERVER_CONFIG.version,
        tool_count: toolRegistry.getTools().length,
        uptime_s: Math.round(uptimeMs / 10) / 100,
      });
    }
    if (url.pathname === "/status") {
      return json(buildStatus(env), { "Cache-Control": "no-store" });
    }
    if (url.pathname === "/metrics") {
      const snap = await usageSnapshot(env);
      return json(snap ?? { aviso: "binding USAGE ausente — estatísticas de uso desativadas" });
    }
    // Contador legado (StatsCounter DO) — rotas preservadas verbatim.
    if (request.method === "GET" && url.pathname === "/stats") {
      return statsResponse(env);
    }
    if (request.method === "GET" && url.pathname === "/stats/badge") {
      return statsBadgeResponse(env);
    }

    // MCP server card para scanners de registry que o leem em vez do /mcp.
    if (url.pathname === "/.well-known/mcp/server-card.json") {
      try {
        return new Response(await getServerCard(), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        logger.error("server-card generation failed", { err: String(err) });
        return new Response(JSON.stringify({ error: "server card unavailable" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Descritor de conector do Glama (descoberta de registry).
    if (url.pathname === "/.well-known/glama.json") {
      return json({
        $schema: "https://glama.ai/mcp/schemas/connector.json",
        maintainers: [{ email: SERVER_CONFIG.contactEmail }],
      });
    }

    // Preflight CORS nunca carrega Authorization — o handler MCP responde o OPTIONS.
    if (request.method !== "OPTIONS") {
      const authResponse = await checkAuth(request, env.API_KEY);
      if (authResponse) {
        record("auth_failure", url.pathname);
        logger.warn("auth_failure", {
          method: request.method,
          path: url.pathname,
          status: authResponse.status,
        });
        return authResponse;
      }

      const clientId = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const decision = checkRateLimit(clientId);
      if (!decision.allowed) {
        record("rate_limited", url.pathname);
        return new Response("Too Many Requests", {
          status: 429,
          headers: { "Retry-After": String(decision.retryAfterS), "Content-Type": "text/plain" },
        });
      }
    }

    record("request", url.pathname);

    // Contexto da requisição (país/AS/marcador self) + escrita no Analytics
    // Engine pegando carona no hook de uso — ver src/analytics.ts.
    const recordWithAnalytics = withAnalytics(record, env.ANALYTICS, tagRequest(request, env.SELF_MARKER));

    // Cópia do corpo tirada ANTES do handler consumir o stream — é dela que o
    // guarda de cursor abaixo decide.
    const corpoMcp =
      request.method === "POST" && url.pathname === SERVER_CONFIG.mcpRoute
        ? await request
            .clone()
            .json()
            .catch(() => undefined)
        : undefined;

    const handler = createMcpHandler(() => buildServer(recordWithAnalytics), {
      route: SERVER_CONFIG.mcpRoute,
      // Sem a opção, o handler aceita localhost e *.workers.dev. Ao definir
      // extraAllowedHostnames (domínio próprio), a lista SUBSTITUI os defaults —
      // por isso config.ts inclui nela também o hostname workers.dev.
      ...(SERVER_CONFIG.extraAllowedHostnames.length
        ? { allowedHostnames: [...SERVER_CONFIG.extraAllowedHostnames] }
        : {}),
      corsOptions: {
        origin: env.ALLOWED_ORIGIN || "*",
        methods: "GET, POST, DELETE, OPTIONS",
        headers: "Content-Type, Accept, mcp-session-id, MCP-Protocol-Version, Authorization",
        maxAge: 86400,
      },
    });

    // Cursor de paginação inválido -> JSON-RPC -32602 (ver src/pagination.ts).
    // DEPOIS do handler: quem valida Host e Origin é o próprio
    // `createMcpHandler`, e um guarda antes dele responderia -32602 a uma
    // requisição que a checagem de segurança ia recusar com 403.
    const doHandler = await handler(request, env, ctx);
    const recusaDeCursor =
      doHandler.status === 200 && corpoMcp !== undefined ? unknownCursorError(corpoMcp) : undefined;

    let response = doHandler;
    if (recusaDeCursor) {
      record("invalid_cursor", url.pathname);
      void doHandler.body?.cancel();
      // 200 com erro JSON-RPC no corpo: a falha é de protocolo, não de HTTP.
      const corsOrigin = doHandler.headers.get("Access-Control-Allow-Origin");
      response = new Response(JSON.stringify(recusaDeCursor), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...(corsOrigin ? { "Access-Control-Allow-Origin": corsOrigin } : {}),
        },
      });
    }
    logger.info("request", {
      method: request.method,
      path: url.pathname,
      status: response.status,
      ms: Date.now() - start,
    });
    return response;
  },
} satisfies ExportedHandler<Env>;
