/**
 * Núcleo puro das estatísticas de uso — sem nenhuma API do Workers, para que a
 * agregação seja testável em Node (o Durable Object em usage.ts é uma casca fina).
 *
 * Privacidade (herdada do senado-br-mcp-cloudflare): registram-se apenas o tipo de
 * evento, o nome da tool/rota e contagens diárias. Nunca conteúdo de consulta,
 * parâmetros de tool ou qualquer dado do usuário.
 */

export type UsageKind =
  | "request" // requisição aceita nas rotas não-públicas (nome = pathname)
  | "auth_failure"
  | "rate_limited"
  | "tool_call" // toda chamada de tool (nome = tool)
  | "tool_error" // subconjunto de tool_call que falhou
  | "invalid_cursor"; // lista pedida com cursor de paginação que este servidor nunca emitiu

export interface UsageEvent {
  kind: UsageKind;
  /** Rota (request/auth_failure/rate_limited) ou nome da tool (tool_*). */
  name?: string;
}

/** Assinatura do registrador injetado nas tools — fire-and-forget, nunca lança. */
export type RecordUsage = (kind: UsageKind, name?: string) => void;

/** Chave de dia em UTC ("YYYY-MM-DD") — o grão de agregação persistido. */
export function dayKeyUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Linha da tabela usage_daily do Durable Object. */
export interface UsageRow {
  day: string;
  kind: string;
  name: string;
  n: number;
}

export interface UsageSnapshot {
  /** Somatório por tipo de evento no período. */
  totals: Record<string, number>;
  /** Chamadas e erros por tool (derivado de tool_call/tool_error). */
  perTool: Record<string, { calls: number; errors: number }>;
  /** Contagens por dia e tipo de evento. */
  perDay: Record<string, Record<string, number>>;
  /** Menor dia presente no período, ou null sem dados. */
  since: string | null;
  ts: string;
}

export function buildSnapshot(rows: UsageRow[], now: Date): UsageSnapshot {
  const totals: Record<string, number> = {};
  const perTool: Record<string, { calls: number; errors: number }> = {};
  const perDay: Record<string, Record<string, number>> = {};
  let since: string | null = null;

  for (const row of rows) {
    totals[row.kind] = (totals[row.kind] ?? 0) + row.n;
    const day = (perDay[row.day] ??= {});
    day[row.kind] = (day[row.kind] ?? 0) + row.n;
    if (since === null || row.day < since) since = row.day;
    if (row.kind === "tool_call" || row.kind === "tool_error") {
      const tool = (perTool[row.name] ??= { calls: 0, errors: 0 });
      if (row.kind === "tool_call") tool.calls += row.n;
      else tool.errors += row.n;
    }
  }

  return { totals, perTool, perDay, since, ts: now.toISOString() };
}
