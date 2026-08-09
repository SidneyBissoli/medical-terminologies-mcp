/**
 * Payload público de liveness/status (GET /status): versão do servidor + metadados
 * reais do último deploy (binding version_metadata), para que registries, monitores
 * e usuários verifiquem que o servidor está de pé e em qual build — sem o handshake
 * MCP. O bloco deploy é omitido quando o binding está ausente (dev local/testes).
 */

import { SERVER_CONFIG } from "./config.js";
import type { Env } from "./types.js";

export function buildStatus(env: Env) {
  const meta = env.CF_VERSION_METADATA;
  return {
    status: "ok" as const,
    name: SERVER_CONFIG.name,
    version: SERVER_CONFIG.version,
    mcp: SERVER_CONFIG.mcpRoute,
    ...(meta
      ? { deploy: { id: meta.id, tag: meta.tag || null, timestamp: meta.timestamp } }
      : {}),
  };
}
