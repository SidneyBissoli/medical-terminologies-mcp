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
 *   | blob6 = organização do AS | blob7 = classe do erro | blob8 = NOMES dos
 *   parâmetros | double1 = flag de erro.
 *
 * Privacidade: nome da tool, desfecho, contexto de rede agregável e, desde
 * 2026-09-10, a FORMA da chamada — nomes de parâmetro (que são o esquema
 * publicado) e uma classe de erro de vocabulário fechado. Nunca os VALORES dos
 * argumentos, nunca resultados, IP ou conteúdo de consulta. A razão da linha
 * está em src/call-shape.ts.
 *
 * A escrita pega carona no hook `record` do registerAll, que emite SEMPRE
 * `tool_call` e, sincronamente em seguida (mesmo bloco try/finally), o
 * `tool_error` quando a chamada falhou. `withAnalytics` coalesce o par numa
 * linha só: bufferiza no `tool_call` e descarrega via microtask ("ok") ou no
 * `tool_error` síncrono ("error"). O par é atômico no event loop, então não há
 * risco de interlevar chamadas concorrentes.
 *
 * Métodos de PROTOCOLO (`initialize`, `tools/list`, `notifications/*`...) não
 * passam pelo hook: são gravados na camada HTTP, a partir do corpo JSON-RPC,
 * por `recordProtocolMethods` (chamada em src/index.ts) — ver o comentário dela.
 *
 * `writeDataPoint` é síncrono e fire-and-forget no runtime — telemetria nunca
 * entra no caminho crítico; qualquer falha é engolida.
 */

import type { RecordUsage } from "./usage-core.js";

/** Header que os clientes MCP do dono enviam (valor = secret SELF_MARKER). */
export const SELF_HEADER = "x-mcp-self";

/**
 * Rota privada do dono: mesma superficie, mesmo resultado, outro ENDERECO.
 *
 * O marcador por header so funciona em cliente que aceita header custom, e o
 * conector do claude.ai nao aceita — e e por ele que o dono mais usa os
 * proprios servidores. Medido em 28/08/2026: o header pegava UMA chamada por
 * produto por semana; todo o resto do uso proprio saia dos servidores da
 * Anthropic, indistinguivel de terceiro, inflando a adocao.
 *
 * O conector nao manda header, mas aponta para qualquer URL. Entao a
 * separacao vem da ROTA: chamada que chega aqui e uso proprio por construcao.
 *
 * O caminho e adivinhavel de proposito (o dono precisa cola-lo em varios
 * clientes). O risco e um varredor cair aqui e ser contado como dono: sujeira
 * no balde do uso proprio, nao vazamento — a rota serve o mesmo conteudo
 * publico. Detectavel olhando pais/AS das chamadas marcadas.
 */
export const SELF_ROUTE = "/mcp/uso-proprio";

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
    self:
      (!!selfSecret && request.headers.get(SELF_HEADER) === selfSecret) ||
      new URL(request.url).pathname === SELF_ROUTE,
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

  let pending: { name: string; params: string } | null = null;
  const flushOk = () => {
    if (pending !== null) {
      const { name, params } = pending;
      pending = null;
      writeToolCall(analytics, name, false, tag, "", params);
    }
  };

  return (kind, name, forma) => {
    if (kind === "tool_call" && name) {
      flushOk(); // segurança: nunca deve haver pendente aqui (par é atômico)
      pending = { name, params: forma?.params ?? "" };
      queueMicrotask(flushOk); // nenhum tool_error síncrono seguiu → foi "ok"
    } else if (kind === "tool_error" && name && pending !== null && pending.name === name) {
      const params = forma?.params || pending.params;
      pending = null;
      writeToolCall(analytics, name, true, tag, forma?.classe ?? "", params);
    }
    record(kind, name, forma);
  };
}

function writeToolCall(
  analytics: AnalyticsEngineDataset,
  name: string,
  isError: boolean,
  tag: RequestTag,
  errorClass = "",
  params = "",
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
        errorClass,
        params,
      ],
      doubles: [isError ? 1 : 0],
    });
  } catch {
    // Falha de telemetria nunca quebra nem atrasa a resposta de uma tool.
  }
}

/**
 * Métodos de PROTOCOLO, gravados na camada HTTP.
 *
 * O hook `record` só vê `tools/call`: é o registerAll quem o emite, de dentro
 * da tool. `initialize`, `tools/list`, `notifications/*`, `ping` e o que mais
 * o cliente mande (`server/discover`, por exemplo) atravessam o transporte sem
 * tocar hook nenhum — e são eles que contam o FUNIL DE SESSÃO: quantos
 * `initialize` viram chamada de ferramenta de verdade, que é o que separa
 * "acharam o servidor" de "usaram o servidor". Medido em 2026-09-10: só o
 * sih-br-mcp os gravava (178 das 285 linhas dele), porque lá o Worker é um
 * proxy que lê o corpo JSON-RPC antes de encaminhar. Aqui o servidor roda
 * dentro do Worker, e o corpo vem de uma CÓPIA tirada antes de o handler
 * consumir o stream (src/index.ts).
 *
 * Mesmo esquema de blobs, com o método no lugar do nome da tool — igual ao
 * sih. O painel separa os dois pelo nome (`metodo_de_protocolo`).
 *
 * O que entra, e de onde vem o desfecho:
 *  - todo método que não é `tools/call` → uma linha, "ok" se o HTTP da
 *    resposta for < 400, "error" senão. LIMITAÇÃO, a mesma do sih: erro
 *    JSON-RPC que viaja dentro de um 200 (método desconhecido, -32601) sai
 *    como "ok" — ler exigiria consumir o corpo que está sendo devolvido;
 *  - `tools/call` só quando o HTTP é ≥ 400: o transporte recusou antes de
 *    despachar (Accept errado, sessão inválida, Origin estrangeiro) e o hook
 *    nunca rodou; sem isto a recusa seria invisível. Com HTTP < 400 o hook já
 *    gravou a linha, com desfecho e forma de verdade — não se grava de novo;
 *  - lote JSON-RPC (array) → uma linha por item; item sem `method` (resposta
 *    do cliente, corpo que não é JSON) → nada.
 *
 * Só no Analytics Engine: o UsageTracker (/metrics) continua contando tools.
 */
export function protocolNamesFromBody(body: unknown, status: number): string[] {
  const itens = Array.isArray(body) ? body : [body];
  const nomes: string[] = [];
  for (const item of itens) {
    if (!item || typeof item !== "object") continue;
    const msg = item as { method?: unknown; params?: unknown };
    if (typeof msg.method !== "string" || msg.method === "") continue;
    if (msg.method === "tools/call") {
      if (status < 400) continue; // o hook de tools já gravou esta
      const params = msg.params as { name?: unknown } | undefined;
      nomes.push(typeof params?.name === "string" && params.name !== "" ? params.name : "tools/call");
    } else {
      nomes.push(msg.method);
    }
  }
  return nomes;
}

/**
 * Grava no Analytics Engine os métodos de protocolo de um POST no endpoint
 * MCP (ver protocolNamesFromBody). Devolve os nomes gravados. Sem binding,
 * não grava nada.
 */
export function recordProtocolMethods(
  analytics: AnalyticsEngineDataset | undefined,
  tag: RequestTag,
  body: unknown,
  status: number,
): string[] {
  if (!analytics || body === undefined) return [];
  const nomes = protocolNamesFromBody(body, status);
  for (const nome of nomes) writeToolCall(analytics, nome, status >= 400, tag, "", "");
  return nomes;
}
