/**
 * Leitura do envelope da resposta (src/envelope.ts) — o que separa "o servidor
 * devolveu 200" de "esta mensagem falhou, e por quê".
 *
 * Guarda portada de sih-br-mcp/worker/tests/envelope.test.ts, onde o desenho
 * estreou. O que muda são os CORPOS: os de lá foram medidos no `sih`, os daqui
 * foram medidos NESTE servidor, em produção, em 24/09/2026, pela rota privada
 * do dono (`/mcp/uso-proprio`) — recusa de esquema, ferramenta que não existe,
 * método que não existe, ausência respondida como dado e sucesso.
 *
 * Por que medir de novo em vez de reusar os do `sih`: o corpo é produzido por
 * outra coisa. Lá um container responde através de um proxy; aqui quem responde
 * é o `createMcpHandler` dentro do próprio Worker. Foi essa medição que corrigiu
 * a suposição de que a recusa de esquema viraria erro de protocolo — ela vira
 * `result.isError` — e a de que ferramenta inexistente daria −32601: dá −32602.
 * (−32601 existe, mas é para MÉTODO que não existe, e aqui está medido também.)
 *
 * A regressão que importa é que sucesso continue valendo `ok`.
 */

import { describe, expect, it } from "vitest";

import { recordProtocolMethods, type RequestTag } from "../src/analytics.js";
import {
  LeitorDeEnvelope,
  MAX_EVENTO_BYTES,
  desfechoDaResposta,
  desfechosDoCorpo,
  resolveDesfecho,
  type Desfecho,
} from "../src/envelope.js";

/** Corpos SSE como este servidor os escreve (uma linha `data:` por evento). */
const SSE = {
  recusaDeEsquema:
    'event: message\ndata: {"result":{"content":[{"type":"text","text":"Validation error: code: Invalid input: expected string, received undefined; Unrecognized key: \\"codigo\\""}],"isError":true},"jsonrpc":"2.0","id":1}\n\n',
  toolInexistente:
    'event: message\ndata: {"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"Tool nao_existe not found"}}\n\n',
  metodoInexistente:
    'event: message\ndata: {"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"Method not found"}}\n\n',
  erroMole:
    'event: message\ndata: {"result":{"content":[{"type":"text","text":"{\\"results\\": [], \\"note\\": \\"No term matched the query.\\"}"}]},"jsonrpc":"2.0","id":1}\n\n',
  sucesso: 'event: message\ndata: {"result":{"content":[{"type":"text","text":"{}"}]},"jsonrpc":"2.0","id":7}\n\n',
};

function ler(texto: string): Map<string, Desfecho> {
  const leitor = new LeitorDeEnvelope();
  leitor.push(texto);
  leitor.end();
  return leitor.desfechos;
}

describe("desfechoDaResposta — uma mensagem JSON-RPC", () => {
  it("isError: true é falha, e a classe sai da mensagem", () => {
    expect(
      desfechoDaResposta({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "Input validation error: Invalid arguments" }], isError: true },
      }),
    ).toEqual({ id: "1", desfecho: { erro: true, classe: "contrato" } });
  });

  it("erro JSON-RPC do protocolo é classificado pelo CÓDIGO, não pelo idioma da mensagem", () => {
    expect(desfechoDaResposta({ id: 1, error: { code: -32601, message: "Method not found" } })?.desfecho).toEqual({
      erro: true,
      classe: "contrato",
    });
    expect(desfechoDaResposta({ id: 1, error: { code: -32603, message: "qualquer coisa" } })?.desfecho).toEqual({
      erro: true,
      classe: "defeito",
    });
    // Código fora da faixa reservada cai na mensagem, como nos seis irmãos.
    expect(desfechoDaResposta({ id: 1, error: { code: -32000, message: "Tempo de resposta excedido" } })?.desfecho).toEqual(
      { erro: true, classe: "fonte" },
    );
  });

  it("id de texto também casa, e vira chave de texto", () => {
    expect(desfechoDaResposta({ id: "abc", result: {} })).toEqual({ id: "abc", desfecho: { erro: false, classe: "" } });
  });

  it("sem id, com id nulo, ou sem result e sem error, não há o que casar", () => {
    expect(desfechoDaResposta({ result: {} })).toBeNull();
    expect(desfechoDaResposta({ id: null, error: { code: -32700, message: "Parse error" } })).toBeNull();
    expect(desfechoDaResposta({ id: 1, method: "notifications/initialized" })).toBeNull();
    expect(desfechoDaResposta(null)).toBeNull();
    expect(desfechoDaResposta("texto")).toBeNull();
    expect(desfechoDaResposta([{ id: 1, result: {} }])).toBeNull();
  });
});

describe("LeitorDeEnvelope — corpos medidos na produção", () => {
  it("recusa de esquema: falha com classe contrato", () => {
    expect(ler(SSE.recusaDeEsquema).get("1")).toEqual({ erro: true, classe: "contrato" });
  });

  it("ferramenta que não existe: falha com classe contrato", () => {
    expect(ler(SSE.toolInexistente).get("1")).toEqual({ erro: true, classe: "contrato" });
  });

  it("método que não existe: falha com classe contrato", () => {
    expect(ler(SSE.metodoInexistente).get("1")).toEqual({ erro: true, classe: "contrato" });
  });

  it("ERRO-MOLE continua sendo acerto: ausência respondida como dado não é falha", () => {
    // Busca que não casa nada responde lista vazia numa resposta de SUCESSO —
    // a ferramenta funcionou e disse "não há". Contar isso como erro encheria a
    // fila de saúde de ferramentas que estão funcionando como desenhadas.
    expect(ler(SSE.erroMole).get("1")).toEqual({ erro: false, classe: "" });
  });

  it("sucesso comum é ok sem classe", () => {
    expect(ler(SSE.sucesso).get("7")).toEqual({ erro: false, classe: "" });
  });
});

describe("LeitorDeEnvelope — formatos e bordas do stream", () => {
  it("lê JSON cru, sem SSE (resposta direta do container)", () => {
    expect(ler('{"jsonrpc":"2.0","id":3,"error":{"code":-32602,"message":"Tool x not found"}}').get("3")).toEqual({
      erro: true,
      classe: "contrato",
    });
  });

  it("lote JSON-RPC: um desfecho por mensagem", () => {
    const d = ler(
      'data: [{"jsonrpc":"2.0","id":1,"result":{}},{"jsonrpc":"2.0","id":2,"error":{"code":-32601,"message":"Method not found"}}]\n\n',
    );
    expect(d.get("1")).toEqual({ erro: false, classe: "" });
    expect(d.get("2")).toEqual({ erro: true, classe: "contrato" });
  });

  it("evento partido em vários chunks, e linha sem o \\n final, ainda são lidos", () => {
    const leitor = new LeitorDeEnvelope();
    leitor.push('event: message\nda');
    leitor.push('ta: {"jsonrpc":"2.0","id":9,"err');
    leitor.push('or":{"code":-32601,"message":"Method not found"}}');
    leitor.end();
    expect(leitor.desfechos.get("9")).toEqual({ erro: true, classe: "contrato" });
  });

  it("várias linhas data: do mesmo evento são juntadas por \\n (formato SSE)", () => {
    const d = ler('data: {"jsonrpc":"2.0","id":4,\ndata: "result":{}}\n\n');
    expect(d.get("4")).toEqual({ erro: false, classe: "" });
  });

  it("CRLF e linhas de controle do SSE (event:, id:, retry:, comentário) não atrapalham", () => {
    const d = ler(
      ': ping\r\nevent: message\r\nid: 12\r\nretry: 3000\r\ndata: {"jsonrpc":"2.0","id":5,"result":{"isError":true,"content":[{"type":"text","text":"Ferramenta desconhecida: x"}]}}\r\n\r\n',
    );
    expect(d.get("5")).toEqual({ erro: true, classe: "contrato" });
  });

  it("stream cortado no meio de um JSON não inventa desfecho", () => {
    expect(ler('data: {"jsonrpc":"2.0","id":1,"result":{"isEr').size).toBe(0);
  });

  it("evento maior que o teto é descartado, e o EVENTO SEGUINTE continua sendo lido", () => {
    const gigante = "x".repeat(MAX_EVENTO_BYTES + 10);
    const d = ler(`data: {"texto":"${gigante}"}\n\n${SSE.toolInexistente}`);
    expect(d.get("1")).toEqual({ erro: true, classe: "contrato" });
  });

  it("linha gigante SEM quebra não faz o buffer crescer com o corpo", () => {
    const leitor = new LeitorDeEnvelope();
    for (let i = 0; i < 40; i++) leitor.push("y".repeat(16 * 1024)); // 640 KiB numa linha só
    leitor.push("\n\n");
    leitor.push(SSE.metodoInexistente);
    leitor.end();
    expect(leitor.desfechos.get("1")).toEqual({ erro: true, classe: "contrato" });
  });

  it("corpo sem nada de JSON-RPC não produz desfecho nenhum", () => {
    expect(ler("Internal Server Error").size).toBe(0);
    expect(ler("").size).toBe(0);
  });
});

describe("desfechosDoCorpo — leitura do stream", () => {
  function stream(pedacos: string[], falhaNoFim = false): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    let i = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i < pedacos.length) {
          controller.enqueue(enc.encode(pedacos[i++]));
          return;
        }
        if (falhaNoFim) controller.error(new Error("stream cortado"));
        else controller.close();
      },
    });
  }

  it("consome o stream inteiro e devolve os desfechos", async () => {
    const d = await desfechosDoCorpo(stream(["event: mes", "sage\n", SSE.toolInexistente.slice(14)]));
    expect(d.get("1")).toEqual({ erro: true, classe: "contrato" });
  });

  it("stream que ERRA no meio não lança: vale o que deu para ler", async () => {
    const d = await desfechosDoCorpo(stream([SSE.metodoInexistente, 'data: {"id":2,"resu'], true));
    expect(d.get("1")).toEqual({ erro: true, classe: "contrato" });
    expect(d.has("2")).toBe(false);
  });

  it("caracteres multibyte partidos entre dois chunks não corrompem o texto", async () => {
    // "não encontrado" com o ã cortado ao meio pelo limite do chunk.
    const enc = new TextEncoder();
    const corpo = 'data: {"jsonrpc":"2.0","id":6,"error":{"code":-32000,"message":"Ano não encontrado"}}\n\n';
    const bytes = enc.encode(corpo);
    const corte = corpo.indexOf("não") + 1 + 1; // no meio do ã (2 bytes)
    const s = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, corte));
        controller.enqueue(bytes.slice(corte));
        controller.close();
      },
    });
    expect((await desfechosDoCorpo(s)).get("6")).toEqual({ erro: true, classe: "nao_encontrado" });
  });
});

describe("resolveDesfecho — o critério de RESERVA", () => {
  const lido = new Map<string, Desfecho>([["1", { erro: true, classe: "contrato" }]]);

  it("o que o envelope disse vale sobre o HTTP", () => {
    expect(resolveDesfecho("1", lido, false)).toEqual({ erro: true, classe: "contrato" });
  });

  it("sem leitura, vale o HTTP do container — e a classe fica VAZIA, nunca inventada", () => {
    expect(resolveDesfecho("2", lido, true)).toEqual({ erro: true, classe: "" });
    expect(resolveDesfecho("2", lido, false)).toEqual({ erro: false, classe: "" });
  });

  it("notificação (sem id) nunca casa: vale o HTTP", () => {
    expect(resolveDesfecho("", lido, false)).toEqual({ erro: false, classe: "" });
  });
});

/**
 * O CIRCUITO FECHADO: pedido JSON-RPC de verdade + corpo de resposta de verdade,
 * em stream, até a linha que iria para o Analytics Engine. É o teste que prova
 * o conserto de 24/09/2026 — antes dele, `blobs[1]` era "ok" nos três primeiros
 * casos, porque o único critério era o HTTP do container, e ele era 200.
 */
describe("a linha que iria para o Analytics Engine", () => {
  const TAG: RequestTag = { self: true, country: "BR", asOrg: "Cloudflare", sessao: "s1" };

  interface DataPoint {
    indexes?: string[];
    blobs?: string[];
    doubles?: number[];
  }

  function coletor(): { pontos: DataPoint[]; ds: AnalyticsEngineDataset } {
    const pontos: DataPoint[] = [];
    return {
      pontos,
      ds: { writeDataPoint: (p?: unknown) => void pontos.push(p as DataPoint) } as AnalyticsEngineDataset,
    };
  }

  function corpo(texto: string): ReadableStream<Uint8Array> {
    const bytes = new TextEncoder().encode(texto);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        // Em dois pedaços, como o stream real chega.
        controller.enqueue(bytes.slice(0, Math.floor(bytes.length / 2)));
        controller.enqueue(bytes.slice(Math.floor(bytes.length / 2)));
        controller.close();
      },
    });
  }

  /**
   * Repete o que o Worker faz em src/index.ts, sem as APIs do runtime: lê o
   * envelope do corpo teado e manda para `recordProtocolMethods` com o recibo
   * do hook — que é a reconciliação de verdade.
   */
  async function linhas(
    pedido: unknown,
    resposta: string,
    statusHttp = 200,
    gravados = new Map<string, number>(),
  ): Promise<DataPoint[]> {
    const desfechos = await desfechosDoCorpo(corpo(resposta));
    const { pontos, ds } = coletor();
    recordProtocolMethods(ds, TAG, pedido, statusHttp, desfechos, gravados);
    return pontos;
  }

  /** Uma linha só, e falha o teste se não for exatamente uma. */
  async function umaLinha(pedido: unknown, resposta: string, statusHttp = 200): Promise<DataPoint> {
    const pontos = await linhas(pedido, resposta, statusHttp);
    expect(pontos).toHaveLength(1);
    return pontos[0] as DataPoint;
  }

  const chamada = (nome: string, args: unknown = {}, id: unknown = 1) => ({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: nome, arguments: args },
  });

  it("recusa de esquema, HTTP 200: error + classe contrato (antes NÃO HAVIA LINHA)", async () => {
    // Este é o item `mcp:recusa-de-esquema-invisivel`. Antes de 24/09/2026 a
    // reconciliação era por status (`if (status < 400) continue`) e esta chamada
    // não gerava linha nenhuma: nem como chamada, nem como erro.
    const linha = await umaLinha(chamada("cid10_lookup", { query: 12345 }), SSE.recusaDeEsquema);
    expect(linha.blobs?.[0]).toBe("cid10_lookup");
    expect(linha.blobs?.[1]).toBe("error");
    expect(linha.blobs?.[6]).toBe("contrato");
    expect(linha.doubles?.[0]).toBe(1);
  });

  it("ferramenta que não existe, HTTP 200: error + classe contrato (antes NÃO HAVIA LINHA)", async () => {
    const linha = await umaLinha(chamada("nao_existe"), SSE.toolInexistente);
    expect(linha.blobs?.[0]).toBe("nao_existe");
    expect(linha.blobs?.[1]).toBe("error");
    expect(linha.blobs?.[6]).toBe("contrato");
  });

  it("método que não existe, HTTP 200: error + classe contrato (antes era ok)", async () => {
    const linha = await umaLinha({ jsonrpc: "2.0", id: 1, method: "metodo/que/nao/existe" }, SSE.metodoInexistente);
    expect(linha.blobs?.[0]).toBe("metodo/que/nao/existe");
    expect(linha.blobs?.[1]).toBe("error");
    expect(linha.blobs?.[6]).toBe("contrato");
  });

  it("ausência respondida como dado segue ok e SEM classe", async () => {
    const linha = await umaLinha(chamada("cid10_lookup", { query: "zzzqqq" }), SSE.erroMole);
    expect(linha.blobs?.[1]).toBe("ok");
    expect(linha.blobs?.[6]).toBe("");
    expect(linha.doubles?.[0]).toBe(0);
  });

  it("chamada que o hook JÁ GRAVOU não gera linha aqui: a reconciliação fecha", async () => {
    // O outro lado da moeda, e o que impede que o conserto conte duas vezes.
    const pontos = await linhas(
      chamada("icd11_search", {}, 7),
      SSE.sucesso,
      200,
      new Map([["icd11_search", 1]]),
    );
    expect(pontos).toEqual([]);
  });

  it("chamada válida sem recibo segue ok, e o resto da linha não muda", async () => {
    const linha = await umaLinha(chamada("loinc_search", {}, 7), SSE.sucesso);
    expect(linha.blobs?.[1]).toBe("ok");
    expect(linha.blobs?.[3]).toBe("self");
    expect(linha.blobs?.[4]).toBe("BR");
    expect(linha.blobs?.[5]).toBe("Cloudflare");
    expect(linha.blobs?.[8]).toBe("s1");
  });

  it("lote: cada mensagem recebe o desfecho DELA, não o do vizinho", async () => {
    const pontos = await linhas(
      [chamada("icd11_search", {}, 1), chamada("nao_existe", {}, 2)],
      'data: [{"jsonrpc":"2.0","id":1,"result":{}},{"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"Tool nao_existe not found"}}]\n\n',
    );
    expect(pontos.map((p) => [p.blobs?.[0], p.blobs?.[1], p.blobs?.[6]])).toEqual([
      ["icd11_search", "ok", ""],
      ["nao_existe", "error", "contrato"],
    ]);
  });

  it("corpo ilegível com HTTP 5xx: continua error pelo critério de reserva, sem classe", async () => {
    const linha = await umaLinha(chamada("icd11_search"), "Internal Server Error", 502);
    expect(linha.blobs?.[1]).toBe("error");
    expect(linha.blobs?.[6]).toBe("");
  });

  it("notificação não tem resposta: fica com o HTTP, como sempre foi", async () => {
    const linha = await umaLinha({ jsonrpc: "2.0", method: "notifications/initialized" }, SSE.sucesso);
    expect(linha.blobs?.[0]).toBe("notifications/initialized");
    expect(linha.blobs?.[1]).toBe("ok");
  });
});
