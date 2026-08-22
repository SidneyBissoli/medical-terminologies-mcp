/**
 * Telemetria de tool calls no Analytics Engine — uma linha por chamada, com o
 * contexto da REQUISIÇÃO que o UsageTracker não tem: país, organização do AS
 * (egress de plataformas de IA aparece como a rede delas, ex.: Anthropic/
 * Google Cloud) e o marcador de uso próprio (header secreto configurado só nos
 * clientes MCP do dono — único jeito de separar o uso do dono quando ele chega
 * por conectores hospedados, que egressam de servidores da plataforma).
 *
 * Esquema de blobs CONSISTENTE com o senado-br-mcp-cloudflare (instrument.ts):
 *   index1 = tool | blob1 = tool | blob2 = "ok"/"error" | blob3 = classe de
 *   cache (não medida neste worker — vazio) | blob4 = "self"/"" | blob5 = país
 *   | blob6 = organização do AS | double1 = flag de erro.
 *
 * Privacidade: nome da tool, desfecho e contexto de rede agregável — nunca
 * argumentos, resultados, IP ou conteúdo de consulta.
 *
 * A escrita pega carona no hook `record` do registerAll, que emite SEMPRE
 * `tool_call` e, sincronamente em seguida (mesmo bloco try/finally), o
 * `tool_error` quando a chamada falhou. `withAnalytics` coalesce o par numa
 * linha só: bufferiza no `tool_call` e descarrega via microtask ("ok") ou no
 * `tool_error` síncrono ("error"). O par é atômico no event loop, então não há
 * risco de interlevar chamadas concorrentes.
 *
 * `writeDataPoint` é síncrono e fire-and-forget no runtime — telemetria nunca
 * entra no caminho crítico; qualquer falha é engolida.
 */

import type { RecordUsage } from "./usage-core.js";

/** Header que os clientes MCP do dono enviam (valor = secret SELF_MARKER). */
export const SELF_HEADER = "x-mcp-self";

/** Contexto de uma requisição HTTP, calculado uma vez no fetch do Worker. */
export interface RequestTag {
  self: boolean;
  country: string;
  asOrg: string;
}

/** Extrai país/AS do request.cf e compara o header secreto de uso próprio. */
export function tagRequest(request: Request, selfSecret?: string): RequestTag {
  const cf = (request as { cf?: IncomingRequestCfProperties }).cf;
  return {
    self: !!selfSecret && request.headers.get(SELF_HEADER) === selfSecret,
    country: typeof cf?.country === "string" ? cf.country : "",
    asOrg: typeof cf?.asOrganization === "string" ? cf.asOrganization : "",
  };
}

/**
 * Envolve o registrador de uso: repassa todo evento ao UsageTracker e, para o
 * par tool_call/tool_error, grava UMA linha no Analytics Engine. Sem binding
 * (dev local/testes), devolve o registrador original intacto.
 */
export function withAnalytics(
  record: RecordUsage,
  analytics: AnalyticsEngineDataset | undefined,
  tag: RequestTag,
): RecordUsage {
  if (!analytics) return record;

  let pending: string | null = null;
  const flushOk = () => {
    if (pending !== null) {
      const name = pending;
      pending = null;
      writeToolCall(analytics, name, false, tag);
    }
  };

  return (kind, name) => {
    if (kind === "tool_call" && name) {
      flushOk(); // segurança: nunca deve haver pendente aqui (par é atômico)
      pending = name;
      queueMicrotask(flushOk); // nenhum tool_error síncrono seguiu → foi "ok"
    } else if (kind === "tool_error" && name && pending === name) {
      pending = null;
      writeToolCall(analytics, name, true, tag);
    }
    record(kind, name);
  };
}

function writeToolCall(
  analytics: AnalyticsEngineDataset,
  name: string,
  isError: boolean,
  tag: RequestTag,
): void {
  try {
    analytics.writeDataPoint({
      // Índice de baixa cardinalidade → GROUP BY barato no SQL do AE.
      indexes: [name],
      blobs: [
        name,
        isError ? "error" : "ok",
        "", // classe de cache — só o senado mede por chamada
        tag.self ? "self" : "",
        tag.country,
        tag.asOrg,
      ],
      doubles: [isError ? 1 : 0],
    });
  } catch {
    // Falha de telemetria nunca quebra nem atrasa a resposta de uma tool.
  }
}
