/**
 * Estatísticas de uso duráveis — Durable Object singleton com storage SQLite.
 *
 * Padrão da Fase 0: estado cross-request vive atrás de um handle próprio
 * (idFromName("global")), nunca do session ID do MCP — o transporte é stateless
 * (createMcpHandler). O registro é fire-and-forget via ctx.waitUntil:
 * observabilidade nunca é caminho crítico, uma falha aqui não pode derrubar nem
 * atrasar a resposta de uma tool.
 */

import { DurableObject } from "cloudflare:workers";
import type { Env } from "./types.js";
import {
  buildSnapshot,
  dayKeyUtc,
  type RecordUsage,
  type UsageEvent,
  type UsageRow,
  type UsageSnapshot,
} from "./usage-core.js";

export class UsageTracker extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS usage_daily (
         day  TEXT NOT NULL,
         kind TEXT NOT NULL,
         name TEXT NOT NULL,
         n    INTEGER NOT NULL DEFAULT 0,
         PRIMARY KEY (day, kind, name)
       )`,
    );
  }

  /** Incrementa contadores do dia corrente (UTC). Chamado via RPC pelo Worker. */
  record(events: UsageEvent[]): void {
    const day = dayKeyUtc(new Date());
    for (const ev of events) {
      this.ctx.storage.sql.exec(
        `INSERT INTO usage_daily (day, kind, name, n) VALUES (?, ?, ?, 1)
         ON CONFLICT (day, kind, name) DO UPDATE SET n = n + 1`,
        day,
        ev.kind,
        ev.name ?? "",
      );
    }
  }

  /** Agregado dos últimos `days` dias — servido em GET /metrics. */
  snapshot(days = 30): UsageSnapshot {
    const cutoff = dayKeyUtc(new Date(Date.now() - days * 86_400_000));
    const rows = this.ctx.storage.sql
      .exec(`SELECT day, kind, name, n FROM usage_daily WHERE day >= ? ORDER BY day`, cutoff)
      .toArray() as unknown as UsageRow[];
    return buildSnapshot(rows, new Date());
  }
}

/**
 * Registrador fire-and-forget para o request corrente. Sem o binding USAGE
 * (dev local/testes) degrada para no-op.
 */
export function createUsageRecorder(env: Env, ctx: ExecutionContext): RecordUsage {
  const ns = env.USAGE;
  if (!ns) return () => {};
  const stub = ns.get(ns.idFromName("global"));
  return (kind, name) => {
    try {
      ctx.waitUntil(Promise.resolve(stub.record([{ kind, name: name ?? "" }])).catch(() => {}));
    } catch {
      // Telemetria nunca derruba a resposta.
    }
  };
}

/** Snapshot para GET /metrics; null quando o binding USAGE está ausente. */
export async function usageSnapshot(env: Env, days = 30): Promise<UsageSnapshot | null> {
  const ns = env.USAGE;
  if (!ns) return null;
  const stub = ns.get(ns.idFromName("global"));
  return await stub.snapshot(days);
}
