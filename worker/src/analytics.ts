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
 *   parâmetros | blob9 = sessão (id emitido no initialize) |
 *   blob10 = cliente (clientInfo.name, só na linha do initialize) | double1 =
 *   flag de erro.
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
  /** Id de sessão (blob9): emitido no initialize, lido do cabeçalho depois; "" sem sessão. */
  sessao: string;
}

/** Extrai país/AS do request.cf e compara o header secreto de uso próprio. */
export function tagRequest(request: Request, selfSecret?: string, sessao = ""): RequestTag {
  const cf = (request as { cf?: IncomingRequestCfProperties }).cf;
  return {
    self:
      (!!selfSecret && request.headers.get(SELF_HEADER) === selfSecret) ||
      new URL(request.url).pathname === SELF_ROUTE,
    country: typeof cf?.country === "string" ? cf.country : "",
    asOrg: typeof cf?.asOrganization === "string" ? cf.asOrganization : "",
    sessao,
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
  cliente = "",
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
        tag.sessao,
        cliente,
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
  const cliente = clientNameFromBody(body);
  const nomes = protocolNamesFromBody(body, status);
  for (const nome of nomes) {
    writeToolCall(analytics, nome, status >= 400, tag, "", "", nome === "initialize" ? cliente : "");
  }
  return nomes;
}

/**
 * SESSÃO E CLIENTE (blobs 9 e 10, desde 2026-09-17).
 *
 * O que faltava para o funil de sessão do painel ser um funil de verdade: a
 * telemetria tinha `initialize` e `tools/call` como contagens soltas, sem
 * nada que ligasse duas linhas à mesma sessão — a razão "chamadas por
 * initialize" mistura quantas sessões usaram com quanto cada uma usou, e
 * 2,5 tanto pode ser todo mundo chamando 2 ou 3 vezes quanto 10% chamando 25.
 *
 * O elo é o do próprio protocolo: o servidor devolve `Mcp-Session-Id` na
 * resposta ao `initialize` e o cliente é obrigado a repeti-lo em toda
 * requisição seguinte. O handler continua STATELESS — o transporte do SDK v2
 * não emite id neste modo e, conferido em 16/09/2026 nos sete servidores e
 * no código (`validateSession` retorna sem checar quando não há gerador),
 * também não lê nem valida o que o cliente manda. Então o Worker sorteia o
 * id no `initialize`, devolve no cabeçalho e, nas demais requisições, só lê
 * o que o cliente devolveu e grava. Nada é armazenado; o id é aleatório
 * (UUID v4 do `crypto`) e não identifica pessoa, máquina nem rede — só liga
 * as linhas de um aperto de mão. Colisão de UUID v4 é da ordem de n²/2¹²⁹:
 * não é risco prático.
 *
 * O cliente é o software que se apresentou no `initialize`
 * (`params.clientInfo.name`): claude.ai, Claude Code, Inspector, um scanner
 * com nome próprio. É autodeclarado e descreve o programa, não a pessoa. Vai
 * normalizado (minúsculas, sem versão, vocabulário de caracteres fechado,
 * tamanho limitado) para não virar texto livre na telemetria, e SÓ na linha
 * do `initialize` — as chamadas seguintes chegam ao cliente pela sessão.
 *
 * Id que o cliente manda e não parece um id (fora do vocabulário, comprido
 * demais) é tratado como ausente: continua sem estado, e a telemetria não
 * carrega o que não sabe ler.
 */
export const SESSION_HEADER = "mcp-session-id";
const SESSION_ID_OK = /^[A-Za-z0-9._~-]{1,64}$/;

/** O corpo (mensagem ou lote JSON-RPC) contém um `initialize`? */
export function isInitialize(body: unknown): boolean {
  const itens = Array.isArray(body) ? body : [body];
  return itens.some(
    (m) => !!m && typeof m === "object" && (m as { method?: unknown }).method === "initialize",
  );
}

/**
 * A sessão desta requisição: sorteada no `initialize` (`nova`), lida do
 * cabeçalho nas demais; "" quando não há sessão legível.
 */
export function sessionFromRequest(request: Request, body: unknown): { id: string; nova: boolean } {
  if (isInitialize(body)) return { id: crypto.randomUUID(), nova: true };
  const enviada = request.headers.get(SESSION_HEADER) ?? "";
  return { id: SESSION_ID_OK.test(enviada) ? enviada : "", nova: false };
}

/** Devolve a resposta com o `Mcp-Session-Id` quando a sessão nasceu aqui. */
export function withSessionHeader(response: Response, sessao: { id: string; nova: boolean }): Response {
  if (!sessao.nova || !sessao.id) return response;
  const headers = new Headers(response.headers);
  headers.set(SESSION_HEADER, sessao.id);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Nome do cliente normalizado: minúsculas, caracteres fechados, até 40. */
export function normalizeClientName(x: unknown): string {
  if (typeof x !== "string") return "";
  return x
    .toLowerCase()
    .replace(/[^a-z0-9._+/ -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

/** `clientInfo.name` do `initialize` (o primeiro, num lote); "" fora dele. */
export function clientNameFromBody(body: unknown): string {
  const itens = Array.isArray(body) ? body : [body];
  for (const m of itens) {
    if (!m || typeof m !== "object") continue;
    const msg = m as { method?: unknown; params?: { clientInfo?: { name?: unknown } } };
    if (msg.method === "initialize") return normalizeClientName(msg.params?.clientInfo?.name);
  }
  return "";
}
