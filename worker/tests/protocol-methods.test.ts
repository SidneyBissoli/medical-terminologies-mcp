/**
 * Métodos de PROTOCOLO na telemetria (src/analytics.ts: protocolNamesFromBody
 * e recordProtocolMethods). Até 2026-09-16 só o sih-br-mcp os gravava; a
 * frota inteira precisa gravar igual para o painel comparar o funil de sessão
 * (initialize → tools/call) entre servidores.
 */

import { describe, expect, it } from "vitest";

import { protocolNamesFromBody, recordProtocolMethods, type RequestTag } from "../src/analytics.js";

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

const TAG: RequestTag = { self: false, country: "BR", asOrg: "Claro NXT" };
const rpc = (method: string, params?: unknown, id: number | null = 1) => ({ jsonrpc: "2.0", id, method, params });

describe("protocolNamesFromBody", () => {
  it("aperto de mão inteiro: initialize, notificação e tools/list, um nome cada", () => {
    expect(protocolNamesFromBody(rpc("initialize", { protocolVersion: "2025-11-25" }), 200)).toEqual(["initialize"]);
    expect(protocolNamesFromBody({ jsonrpc: "2.0", method: "notifications/initialized" }, 202)).toEqual([
      "notifications/initialized",
    ]);
    expect(protocolNamesFromBody(rpc("tools/list"), 200)).toEqual(["tools/list"]);
  });

  it("método que o servidor não conhece entra do mesmo jeito (é o sinal de conformidade)", () => {
    expect(protocolNamesFromBody(rpc("server/discover"), 200)).toEqual(["server/discover"]);
  });

  it("tools/call com HTTP < 400 fica de fora: o hook de tools já gravou", () => {
    expect(protocolNamesFromBody(rpc("tools/call", { name: "tool_qualquer", arguments: {} }), 200)).toEqual([]);
  });

  it("tools/call recusada pelo transporte (HTTP ≥ 400) entra pelo nome da tool", () => {
    expect(protocolNamesFromBody(rpc("tools/call", { name: "tool_qualquer", arguments: {} }), 406)).toEqual([
      "tool_qualquer",
    ]);
    expect(protocolNamesFromBody(rpc("tools/call", {}), 400)).toEqual(["tools/call"]);
  });

  it("lote JSON-RPC: um nome por item, na ordem", () => {
    const lote = [rpc("initialize"), { jsonrpc: "2.0", method: "notifications/initialized" }, rpc("tools/list")];
    expect(protocolNamesFromBody(lote, 200)).toEqual(["initialize", "notifications/initialized", "tools/list"]);
  });

  it("resposta do cliente, corpo inválido ou method vazio → nada", () => {
    expect(protocolNamesFromBody({ jsonrpc: "2.0", id: 1, result: {} }, 200)).toEqual([]);
    expect(protocolNamesFromBody(undefined, 200)).toEqual([]);
    expect(protocolNamesFromBody("texto", 200)).toEqual([]);
    expect(protocolNamesFromBody({ method: "" }, 200)).toEqual([]);
    expect(protocolNamesFromBody({ method: 42 }, 200)).toEqual([]);
  });
});

describe("recordProtocolMethods", () => {
  it("grava o método no lugar da tool, no MESMO esquema de blobs do hook", () => {
    const { points, dataset } = fakeDataset();
    expect(recordProtocolMethods(dataset, TAG, rpc("initialize"), 200)).toEqual(["initialize"]);
    expect(points).toEqual([
      {
        indexes: ["initialize"],
        blobs: ["initialize", "ok", "", "", "BR", "Claro NXT", "", ""],
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

  it("marca self em blob4 quando a requisição é do dono", () => {
    const { points, dataset } = fakeDataset();
    recordProtocolMethods(dataset, { self: true, country: "US", asOrg: "Anthropic" }, rpc("tools/list"), 200);
    expect(points[0]!.blobs).toEqual(["tools/list", "ok", "", "self", "US", "Anthropic", "", ""]);
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

  it("NENHUM blob carrega valor de argumento, nem no lote", () => {
    const { points, dataset } = fakeDataset();
    const lote = [rpc("initialize", { clientInfo: { name: "segredo-do-cliente" } }), rpc("tools/list", { cursor: "abc" })];
    recordProtocolMethods(dataset, TAG, lote, 200);
    const tudo = points.flatMap((p) => p.blobs ?? []).join("|");
    expect(tudo).not.toContain("segredo");
    expect(tudo).not.toContain("abc");
  });
});
