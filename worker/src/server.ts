/**
 * Construção do McpServer — chamado pela factory do createMcpHandler a cada
 * request (modelo stateless do MCP SDK v2).
 *
 * As registrations de tools/resources/prompts são reutilizadas verbatim do
 * pacote npm via `registerAll` (dist/worker-lib.js, build do pacote pai), então
 * o transporte HTTP e o STDIO expõem exatamente a mesma superfície. A
 * instrumentação de uso (Durable Object UsageTracker) entra pelo hook `record`
 * do próprio `registerAll` — nomes e contagens apenas, nunca argumentos ou
 * resultados. O contador legado StatsCounter é alimentado por dentro do
 * pacote (recordInvocation → recorder instalado em stats-legacy.ts).
 *
 * Requer o pacote pai compilado (`npm run build:worker-lib` na raiz do repo).
 */

import { McpServer } from "@modelcontextprotocol/server";

import { registerAll, SERVER_INSTRUCTIONS, announceServedVersions } from "../../dist/worker-lib.js";
import { SERVER_CONFIG } from "./config.js";
import type { RecordUsage } from "./usage-core.js";

/** Builds a fresh MCP server with the shared tool/resource/prompt surface. */
export function buildServer(record: RecordUsage = () => {}): McpServer {
  const server = new McpServer(
    {
      name: SERVER_CONFIG.name,
      version: SERVER_CONFIG.version,
      // `title` e `icons` no serverInfo do HANDSHAKE. Esta construção é
      // SEPARADA da do stdio (`src/register.ts`): corrigir lá não corrige aqui.
      // No ibge isso custou um deploy — o stdio foi a 146/148 e produção ficou
      // em 169/173, com CI verde.
      title: SERVER_CONFIG.title,
      websiteUrl: SERVER_CONFIG.websiteUrl,
      icons: SERVER_CONFIG.icons,
    },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerAll(server, (kind: "tool_call" | "tool_error", name: string) => record(kind, name));
  // `server/discover` anuncia todas as revisões atendidas — ver src/discover.ts.
  announceServedVersions(server);
  return server;
}
