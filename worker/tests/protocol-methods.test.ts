/**
 * Métodos de PROTOCOLO na telemetria (src/analytics.ts: protocolNamesFromBody
 * e recordProtocolMethods). Até 2026-09-16 só o sih-br-mcp os gravava; a
 * frota inteira precisa gravar igual para o painel comparar o funil de sessão
 * (initialize → tools/call) entre servidores.
 */

import { describe, expect, it } from "vitest";

import { protocolMessagesFromBody, recordProtocolMethods, type RequestTag } from "../src/analytics.js";
import type { Desfecho } from "../src/envelope.js";

/** Só os nomes, que é o que a maioria dos casos olha. */
const nomes = (body: unknown, gravados?: Map<string, number>): string[] =>
  protocolMessagesFromBody(body, gravados).map((m) => m.nome);

interface DataPoint {
  indexes?: string[];
  blobs?: string[];
  doubles?: number[];
}

function fakeDataset(): { points: DataPoint[]; dataset: AnalyticsEngineDataset } {
  const points: DataPoint[] = [];
  return {
    points,
    dataset: {
      writeDataPoint: (p?: unknown) => {
        points.push(p as DataPoint);
      },
    } as AnalyticsEngineDataset,
  };
}

const TAG: RequestTag = { self: false, country: "BR", asOrg: "Claro NXT", sessao: "" };
const rpc = (method: string, params?: unknown, id: number | null = 1) => ({ jsonrpc: "2.0", id, method, params });

describe("protocolMessagesFromBody", () => {
  it("aperto de mão inteiro: initialize, notificação e tools/list, um nome cada", () => {
    expect(nomes(rpc("initialize", { protocolVersion: "2025-11-25" }))).toEqual(["initialize"]);
    expect(nomes({ jsonrpc: "2.0", method: "notifications/initialized" })).toEqual([
      "notifications/initialized",
    ]);
    expect(nomes(rpc("tools/list"))).toEqual(["tools/list"]);
  });

  it("método que o servidor não conhece entra do mesmo jeito (é o sinal de conformidade)", () => {
    expect(nomes(rpc("server/discover"))).toEqual(["server/discover"]);
  });

  it("o `id` do pedido volta junto: é ele que casa com a resposta no envelope", () => {
    expect(protocolMessagesFromBody(rpc("tools/list", undefined, 7))).toEqual([
      { nome: "tools/list", id: "7" },
    ]);
    expect(protocolMessagesFromBody(rpc("tools/list", undefined, "abc" as unknown as number))).toEqual([
      { nome: "tools/list", id: "abc" },
    ]);
    // Notificação não tem resposta: sem id, cai no critério de reserva (o HTTP).
    expect(protocolMessagesFromBody({ jsonrpc: "2.0", method: "notifications/initialized" })).toEqual([
      { nome: "notifications/initialized", id: "" },
    ]);
  });

  it("tools/call que o hook GRAVOU fica de fora: não se conta duas vezes", () => {
    const gravados = new Map([["tool_qualquer", 1]]);
    expect(nomes(rpc("tools/call", { name: "tool_qualquer", arguments: {} }), gravados)).toEqual([]);
    expect(gravados.get("tool_qualquer")).toBe(0); // o recibo foi consumido
  });

  it("ESTE É O DEFEITO DE 24/09/2026: tools/call com HTTP 200 que o hook NÃO gravou entra", () => {
    // A recusa de esquema do zod é respondida pelo SDK antes do handler: a tool
    // não roda, o hook não acorda, e o HTTP é 200. A reconciliação antiga era
    // `if (status < 400) continue` e engolia exatamente este caso — a chamada
    // não era contada nem como chamada nem como erro.
    expect(nomes(rpc("tools/call", { name: "tool_qualquer", arguments: {} }), new Map())).toEqual([
      "tool_qualquer",
    ]);
    // Sem recibo nenhum (sem binding de Analytics) vale o mesmo.
    expect(nomes(rpc("tools/call", { name: "tool_qualquer", arguments: {} }))).toEqual(["tool_qualquer"]);
  });

  it("lote com a MESMA tool duas vezes, uma gravada e outra não: entra UMA", () => {
    // Por isso o recibo é contagem e não conjunto: um Set suprimiria as duas e
    // a recusa voltaria a ser invisível.
    const lote = [
      rpc("tools/call", { name: "ilo_get_data", arguments: {} }, 1),
      rpc("tools/call", { name: "ilo_get_data", arguments: {} }, 2),
    ];
    expect(nomes(lote, new Map([["ilo_get_data", 1]]))).toEqual(["ilo_get_data"]);
  });

  it("tools/call recusada pelo transporte (HTTP ≥ 400) continua entrando pelo nome da tool", () => {
    expect(nomes(rpc("tools/call", { name: "tool_qualquer", arguments: {} }), new Map())).toEqual([
      "tool_qualquer",
    ]);
    expect(nomes(rpc("tools/call", {}), new Map())).toEqual(["tools/call"]);
  });

  it("lote JSON-RPC: um nome por item, na ordem", () => {
    const lote = [rpc("initialize"), { jsonrpc: "2.0", method: "notifications/initialized" }, rpc("tools/list")];
    expect(nomes(lote)).toEqual(["initialize", "notifications/initialized", "tools/list"]);
  });

  it("resposta do cliente, corpo inválido ou method vazio → nada", () => {
    expect(nomes({ jsonrpc: "2.0", id: 1, result: {} })).toEqual([]);
    expect(nomes(undefined)).toEqual([]);
    expect(nomes("texto")).toEqual([]);
    expect(nomes({ method: "" })).toEqual([]);
    expect(nomes({ method: 42 })).toEqual([]);
  });
});

describe("recordProtocolMethods", () => {
  it("grava o método no lugar da tool, no MESMO esquema de blobs do hook", () => {
    const { points, dataset } = fakeDataset();
    expect(recordProtocolMethods(dataset, TAG, rpc("initialize"), 200)).toEqual(["initialize"]);
    expect(points).toEqual([
      {
        indexes: ["initialize"],
        blobs: ["initialize", "ok", "", "", "BR", "Claro NXT", "", "", "", ""],
        doubles: [0],
      },
    ]);
  });

  it("HTTP ≥ 400 vira desfecho error, e o flag double1 acompanha", () => {
    const { points, dataset } = fakeDataset();
    recordProtocolMethods(dataset, TAG, rpc("initialize"), 403);
    expect(points[0]!.blobs?.[1]).toBe("error");
    expect(points[0]!.doubles).toEqual([1]);
  });

  it("o desfecho vem do ENVELOPE, não do HTTP: recusa de esquema é error/contrato num 200", () => {
    // O caso medido na produção em 24/09/2026 pela rota do dono: HTTP 200,
    // `result.isError: true`, sem código JSON-RPC.
    const { points, dataset } = fakeDataset();
    const desfechos = new Map<string, Desfecho>([["1", { erro: true, classe: "contrato" }]]);
    recordProtocolMethods(
      dataset,
      TAG,
      rpc("tools/call", { name: "ilo_search_indicators", arguments: { query: 12345 } }),
      200,
      desfechos,
      new Map(),
    );
    expect(points).toHaveLength(1);
    expect(points[0]!.blobs?.[0]).toBe("ilo_search_indicators");
    expect(points[0]!.blobs?.[1]).toBe("error");
    expect(points[0]!.blobs?.[6]).toBe("contrato"); // classe do erro, blob7
    expect(points[0]!.doubles).toEqual([1]);
  });

  it("−32603 sai como `defeito`, e não pode ser deduzido de 'não foi gravado'", () => {
    // A dedução preguiçosa ("não gravou, logo contrato") acertaria a recusa de
    // esquema e erraria justamente o caso que é bug NOSSO.
    const { points, dataset } = fakeDataset();
    const desfechos = new Map<string, Desfecho>([["1", { erro: true, classe: "defeito" }]]);
    recordProtocolMethods(dataset, TAG, rpc("tools/list"), 200, desfechos, new Map());
    expect(points[0]!.blobs?.[1]).toBe("error");
    expect(points[0]!.blobs?.[6]).toBe("defeito");
  });

  it("envelope que diz `ok` num HTTP 200 não inventa classe", () => {
    const { points, dataset } = fakeDataset();
    const desfechos = new Map<string, Desfecho>([["1", { erro: false, classe: "" }]]);
    recordProtocolMethods(dataset, TAG, rpc("tools/list"), 200, desfechos, new Map());
    expect(points[0]!.blobs?.[1]).toBe("ok");
    expect(points[0]!.blobs?.[6]).toBe("");
  });

  it("sem envelope lido, vale o HTTP — o critério de reserva, que era o único", () => {
    const { points, dataset } = fakeDataset();
    recordProtocolMethods(dataset, TAG, rpc("tools/list"), 500, new Map(), new Map());
    expect(points[0]!.blobs?.[1]).toBe("error");
    expect(points[0]!.blobs?.[6]).toBe(""); // sem leitura, sem classe: nunca se inventa
  });

  it("marca self em blob4 quando a requisição é do dono", () => {
    const { points, dataset } = fakeDataset();
    recordProtocolMethods(dataset, { self: true, country: "US", asOrg: "Anthropic", sessao: "" }, rpc("tools/list"), 200);
    expect(points[0]!.blobs).toEqual(["tools/list", "ok", "", "self", "US", "Anthropic", "", "", "", ""]);
  });

  it("sem binding ou sem corpo, não grava e devolve vazio", () => {
    const { points, dataset } = fakeDataset();
    expect(recordProtocolMethods(undefined, TAG, rpc("initialize"), 200)).toEqual([]);
    expect(recordProtocolMethods(dataset, TAG, undefined, 200)).toEqual([]);
    expect(points).toHaveLength(0);
  });

  it("falha do writeDataPoint é engolida", () => {
    const boom = {
      writeDataPoint: () => {
        throw new Error("AE indisponível");
      },
    } as AnalyticsEngineDataset;
    expect(() => recordProtocolMethods(boom, TAG, rpc("initialize"), 200)).not.toThrow();
  });

  it("só o NOME do cliente entra do initialize, normalizado e em blob10; nenhum outro valor", () => {
    const { points, dataset } = fakeDataset();
    const lote = [rpc("initialize", { clientInfo: { name: "segredo-do-cliente" } }), rpc("tools/list", { cursor: "abc" })];
    recordProtocolMethods(dataset, TAG, lote, 200);
    const tudo = points.flatMap((p) => p.blobs ?? []).join("|");
    // O nome do cliente é o ÚNICO valor do initialize que entra, e só no blob10,
    // normalizado (ver clientNameFromBody). O resto do corpo não vaza.
    expect(points[0]!.blobs?.[9]).toBe("segredo-do-cliente");
    expect(points[0]!.blobs?.slice(0, 9).join("|")).not.toContain("segredo");
    expect(tudo).not.toContain("abc");
  });
});
