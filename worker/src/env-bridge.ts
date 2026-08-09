/**
 * Ponte de bindings → globalThis.__MCP_ENV, lida pelo getEnv() compartilhado
 * do pacote (src/utils/env.ts). Necessária porque o polyfill nodejs_compat
 * expõe process.env mas não bridgeia secrets de forma confiável (verificado
 * em produção em 2026-05-10 no worker pré-template). Idempotente por isolate.
 */

import type { Env } from "./types.js";

let envBridged = false;

export function bridgeEnv(env: Env): void {
  if (envBridged) return;
  (globalThis as { __MCP_ENV?: Record<string, string | undefined> }).__MCP_ENV = {
    WHO_CLIENT_ID: env.WHO_CLIENT_ID,
    WHO_CLIENT_SECRET: env.WHO_CLIENT_SECRET,
    WHO_ICD11_RELEASE_ID: env.WHO_ICD11_RELEASE_ID,
    ENABLE_SNOMED_TOOLS: env.ENABLE_SNOMED_TOOLS,
    SNOMED_BASE_URL: env.SNOMED_BASE_URL,
    SNOMED_LANGUAGE: env.SNOMED_LANGUAGE,
    LOG_LEVEL: env.LOG_LEVEL,
  };
  envBridged = true;
}
