/**
 * Leitura do ENVELOPE da resposta — o que transforma "o container devolveu
 * HTTP 200" em "esta mensagem deu certo / esta falhou, e por quê".
 *
 * O PROBLEMA QUE ESTE ARQUIVO RESOLVE, E QUE AQUI É PIOR QUE NO `sih`. A
 * telemetria deste Worker decide o desfecho pelo HTTP da resposta, e em cima
 * disso `protocolNamesFromBody` tinha a linha `if (status < 400) continue`, com
 * o comentário "o hook de tools já gravou esta". A reconciliação era por STATUS,
 * e supunha que 200 implica que o hook gravou. Quando a tool NÃO CHEGA A RODAR
 * — recusa de esquema do zod, antes do handler — ninguém grava, e o `continue`
 * fecha a única outra porta. O `sih` carimbava `ok` numa falha: número errado.
 * Aqui não havia número NENHUM: a chamada não era contada nem como chamada.
 *
 * Medido na produção em 24/09/2026, pela rota do dono, no ilo, uis, senado e
 * bcb — os quatro idênticos, e são DUAS formas, não uma: recusa de esquema sai
 * HTTP 200 com `result.isError: true` e SEM código JSON-RPC; ferramenta
 * inexistente sai HTTP 200 com o código −32602 (não −32601). Os dois são 200,
 * então os dois caíam no `continue`.
 *
 * POR QUE NÃO BUFFERIZAR. Este Worker não é proxy — quem produz a resposta é o
 * `createMcpHandler` aqui dentro —, mas a técnica é a mesma e pelo mesmo motivo:
 * segurar bytes para ler o fim trocaria um defeito de medição por um defeito de
 * produto (a lição do `sih`, cuja série de 34 anos leva ~30 s). O corpo é TEADO
 * (`ReadableStream.tee()`): um ramo segue intocado para o cliente, no mesmo
 * ritmo de antes, e o outro é lido aqui em `ctx.waitUntil`, depois que a
 * resposta já saiu.
 *
 * O TEE RESOLVE, DE QUEBRA, UM PROBLEMA DE TEMPO. O hook de tools escreve
 * durante a execução da tool, que num transporte SSE pode terminar DEPOIS de o
 * handler já ter devolvido a Response. Ler o envelope até o fim do stream é,
 * por construção, esperar a tool acabar — é só então que se sabe o que o hook
 * gravou, e a reconciliação por nome (src/analytics.ts) só vale aí.
 *
 * REGRA DE OURO DESTE MÓDULO: ele nunca lança e nunca segura bytes. Qualquer
 * coisa que ele não entenda vira "sem desfecho", e quem chama cai no critério
 * antigo (o HTTP). Medir pior é aceitável; atrapalhar a resposta do usuário não é.
 *
 * DOIS TETOS, pelo mesmo motivo. Um evento SSE acumulado passa de
 * `MAX_EVENTO_BYTES` → é descartado sem parsear (o `isError` pode estar no fim
 * do JSON, mas mensagem de erro é curta: evento gigante é quase certamente
 * resultado feliz, e o teto troca uma classificação improvável por um limite de
 * memória e de CPU garantido). Mais de `MAX_DESFECHOS` respostas no mesmo corpo
 * → o resto é ignorado; lote JSON-RPC de verdade tem punhado de mensagens.
 *
 * O CAMINHO DE ERRO-MOLE FICA DE FORA, de propósito. Ferramenta que responde
 * ausência como DADO — uma resposta de SUCESSO cujo payload diz "não há" — está
 * funcionando, e continua sendo `ok`. O que conta como falha é `isError: true`
 * ou um erro JSON-RPC, nada mais. (No `sih`, de onde este arquivo vem, isso é a
 * decisão 38 e seis ferramentas dependem dela; aqui o erro de tool já nasce de
 * `IlostatUserError` / `IlostatUpstreamError` e vira `isError`.)
 *
 * Cópia de sih-br-mcp/worker/src/envelope.ts, porque o classificador não pode
 * divergir entre os sete. O que muda é só este cabeçalho e o `teeResposta` do
 * fim, que lá não existe: o `sih` monta a Response do zero a partir do upstream
 * e teia no caminho; aqui a Response já vem pronta do handler. O import vem de `../../dist/worker-lib.js`
 * porque o Worker e o servidor stdio sao pacotes npm separados neste repo e o
 * worker-lib e a SUPERFICIE UNICA por onde worker/src alcanca a raiz. Importar
 * `../../src/*.ts` compilaria uma segunda copia contra outro tsconfig -- o
 * proprio cabecalho do worker-lib avisa disso.
 */

import { classeDoErroRpc, classifyError, errorText } from "../../dist/worker-lib.js";

/** Teto de bytes acumulados por evento SSE (ou por linha) antes de desistir dele. */
export const MAX_EVENTO_BYTES = 64 * 1024;
/** Teto de respostas rastreadas por corpo. */
export const MAX_DESFECHOS = 64;

/** Desfecho de UMA mensagem JSON-RPC: falhou, e com que classe. */
export interface Desfecho {
  erro: boolean;
  /**
   * Classe do vocabulário fechado; "" quando não houve erro.
   *
   * Tipada como `string` porque o worker-lib chega aqui como BUNDLE de esbuild,
   * que não carrega tipos — é a mesma razão pela qual `usage-core.ts` já tipa
   * `classe: string` nesta fronteira. O vocabulário continua sendo o de
   * `src/call-shape.ts`, que é quem produz o valor.
   */
  classe: string;
}

/**
 * Desfecho de uma resposta JSON-RPC, com o `id` que a liga ao pedido.
 * `null` quando o objeto não é uma resposta identificável:
 *  - sem `id` (ou `id: null`, que é a resposta a um pedido que nem parseou) —
 *    não há a que ligar, e o chamador fica com o critério do HTTP;
 *  - sem `result` e sem `error` — não é resposta (é notificação, ou lixo).
 */
export function desfechoDaResposta(msg: unknown): { id: string; desfecho: Desfecho } | null {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return null;
  const m = msg as { id?: unknown; result?: unknown; error?: unknown };
  if (typeof m.id !== "string" && typeof m.id !== "number") return null;
  const id = String(m.id);

  if (m.error && typeof m.error === "object") {
    const e = m.error as { code?: unknown; message?: unknown };
    const code = typeof e.code === "number" ? e.code : undefined;
    const texto = typeof e.message === "string" ? e.message : "";
    return { id, desfecho: { erro: true, classe: classeDoErroRpc(code, texto) } };
  }

  if (m.result && typeof m.result === "object") {
    const r = m.result as { isError?: unknown };
    if (r.isError === true) {
      return { id, desfecho: { erro: true, classe: classifyError(errorText(m.result)) } };
    }
    return { id, desfecho: { erro: false, classe: "" } };
  }
  // `result` primitivo (o SDK responde `{}` em alguns métodos, mas nunca um
  // escalar) ainda é sucesso; o que não é resposta é o objeto sem os dois.
  if (m.result !== undefined) return { id, desfecho: { erro: false, classe: "" } };
  return null;
}

/**
 * O desfecho de UMA mensagem do pedido, já com o CRITÉRIO DE RESERVA aplicado.
 *
 * Regra: vale o que o envelope disse. Quando o envelope não disse nada — `id`
 * ausente (notificação), stream cortado, evento grande demais, resposta que
 * não parseou —, vale o HTTP do container, que era o critério único até
 * 24/09/2026. Nunca se inventa classe: sem leitura, a classe é "".
 */
export function resolveDesfecho(
  id: string,
  desfechos: Map<string, Desfecho>,
  falhouHttp: boolean,
): Desfecho {
  const lido = id === "" ? undefined : desfechos.get(id);
  return lido ?? { erro: falhouHttp, classe: "" };
}

/**
 * Lê o corpo da resposta aos pedaços e vai colhendo desfechos por `id`.
 *
 * Aceita os dois formatos que o transporte Streamable HTTP usa: SSE (`data:`
 * por evento, evento fechado por linha em branco, várias linhas `data:` do
 * mesmo evento juntadas por `\n`) e JSON cru (resposta direta, sem stream).
 * Linhas `event:`, `id:`, `retry:` e comentários (`:`) são ignoradas.
 */
export class LeitorDeEnvelope {
  private resto = "";
  private descartandoLinha = false;
  private evento: string[] = [];
  private bytesDoEvento = 0;
  private eventoEstourado = false;
  private viuSse = false;
  private cru = "";
  /** Desfechos colhidos, por `id` de mensagem JSON-RPC. */
  readonly desfechos = new Map<string, Desfecho>();

  /** Entrega mais um pedaço de TEXTO já decodificado. Nunca lança. */
  push(texto: string): void {
    if (!this.viuSse && this.cru.length < MAX_EVENTO_BYTES) this.cru += texto;
    this.resto += texto;
    for (;;) {
      const quebra = this.resto.indexOf("\n");
      if (quebra < 0) break;
      const linha = this.resto.slice(0, quebra);
      this.resto = this.resto.slice(quebra + 1);
      if (this.descartandoLinha) {
        // Fim da linha gigante que foi descartada: o evento inteiro cai junto,
        // porque o JSON dele está incompleto.
        this.descartandoLinha = false;
        this.eventoEstourado = true;
        continue;
      }
      this.linha(linha.endsWith("\r") ? linha.slice(0, -1) : linha);
    }
    // Linha sem fim à vista e já maior que o teto: para de acumular em vez de
    // crescer com o corpo (uma resposta de 34 anos é uma única linha `data:`).
    if (this.resto.length > MAX_EVENTO_BYTES) {
      this.resto = "";
      this.descartandoLinha = true;
    }
  }

  /** Fecha o que ficou pendente. Chamar uma vez, ao fim do stream. */
  end(): void {
    if (this.resto !== "" && !this.descartandoLinha) {
      const linha = this.resto.endsWith("\r") ? this.resto.slice(0, -1) : this.resto;
      this.resto = "";
      this.linha(linha);
    }
    this.fechaEvento();
    // Corpo que nunca teve uma linha `data:` é JSON cru.
    if (!this.viuSse) this.registra(this.cru);
  }

  private linha(linha: string): void {
    if (linha === "") {
      this.fechaEvento();
      return;
    }
    if (!linha.startsWith("data:")) return;
    this.viuSse = true;
    const pedaco = linha.slice(5).replace(/^ /, "");
    this.bytesDoEvento += pedaco.length;
    if (this.bytesDoEvento > MAX_EVENTO_BYTES) {
      this.eventoEstourado = true;
      this.evento = [];
      return;
    }
    this.evento.push(pedaco);
  }

  private fechaEvento(): void {
    const partes = this.evento;
    const estourou = this.eventoEstourado;
    this.evento = [];
    this.bytesDoEvento = 0;
    this.eventoEstourado = false;
    if (estourou || partes.length === 0) return;
    this.registra(partes.join("\n"));
  }

  private registra(json: string): void {
    if (json === "" || this.desfechos.size >= MAX_DESFECHOS) return;
    let obj: unknown;
    try {
      obj = JSON.parse(json);
    } catch {
      return; // pedaço cortado ao meio, ou não era JSON: fica sem desfecho
    }
    for (const item of Array.isArray(obj) ? obj : [obj]) {
      if (this.desfechos.size >= MAX_DESFECHOS) return;
      const d = desfechoDaResposta(item);
      if (d) this.desfechos.set(d.id, d.desfecho);
    }
  }
}

/**
 * Consome um stream inteiro e devolve os desfechos por `id`. Nunca lança: se o
 * stream for cortado no meio (cliente desconectou, container caiu), vale o que
 * deu para ler até ali e o resto fica sem desfecho.
 */
export async function desfechosDoCorpo(
  corpo: ReadableStream<Uint8Array>,
): Promise<Map<string, Desfecho>> {
  const leitor = new LeitorDeEnvelope();
  const decoder = new TextDecoder();
  const reader = corpo.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) leitor.push(decoder.decode(value, { stream: true }));
    }
    leitor.push(decoder.decode());
  } catch {
    // Stream interrompido: o que já foi lido continua valendo.
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignorado
    }
  }
  leitor.end();
  return leitor.desfechos;
}

/**
 * Parte o corpo da resposta em dois: o que vai para o cliente e o que a
 * telemetria lê. Só isto, e nunca mais que isto — a Response devolvida tem o
 * mesmo status, o mesmo statusText e os mesmos cabeçalhos da original.
 *
 * Resposta sem corpo (204, HEAD, erro montado na borda) devolve `corpo: null` e
 * a própria Response intacta: não há o que teiar, e `new Response(null, resp)`
 * seria uma cópia à toa.
 */
export function teeResposta(resposta: Response): {
  paraCliente: Response;
  paraLeitura: ReadableStream<Uint8Array> | null;
} {
  if (!resposta.body) return { paraCliente: resposta, paraLeitura: null };
  const [cliente, leitura] = resposta.body.tee();
  return { paraCliente: new Response(cliente, resposta), paraLeitura: leitura };
}
