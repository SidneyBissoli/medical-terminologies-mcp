/**
 * Sessão e cliente na telemetria (blobs 9 e 10, src/analytics.ts).
 *
 * O id nasce no servidor, no `initialize`, e volta pelo cabeçalho nas demais
 * requisições; o handler é stateless e não valida o cabeçalho (conferido em
 * 16/09/2026 nos sete servidores), então o que estes casos protegem é o
 * contrato do lado do Worker: emitir só no initialize, ler só o que parece
 * id, gravar o cliente só na linha do initialize, e nunca texto livre.
 */

import { describe, expect, it } from "vitest";

import {
  clientNameFromBody,
  isInitialize,
  normalizeClientName,
  recordProtocolMethods,
  SESSION_HEADER,
  sessionFromRequest,
  tagRequest,
  withAnalytics,
  withSessionHeader,
} from "../src/analytics.js";

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

const init = (name: unknown = "claude-ai") => ({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name, version: "1.0" } },
});
const list = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };
const req = (headers: Record<string, string> = {}) => new Request("https://example.com/mcp", { method: "POST", headers });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("sessionFromRequest", () => {
  it("initialize: sorteia um UUID v4 novo, mesmo que o cliente tenha mandado um id", () => {
    const s = sessionFromRequest(req({ [SESSION_HEADER]: "velha-123" }), init());
    expect(s.nova).toBe(true);
    expect(s.id).toMatch(UUID);
  });

  it("dois initialize não repetem o id", () => {
    expect(sessionFromRequest(req(), init()).id).not.toBe(sessionFromRequest(req(), init()).id);
  });

  it("lote com initialize conta como initialize", () => {
    expect(sessionFromRequest(req(), [list, init()]).nova).toBe(true);
  });

  it("fora do initialize: lê o id que o cliente devolveu", () => {
    const s = sessionFromRequest(req({ [SESSION_HEADER]: "6f1c2a3e-9b7d-4c1e-8a2f-0123456789ab" }), list);
    expect(s).toEqual({ id: "6f1c2a3e-9b7d-4c1e-8a2f-0123456789ab", nova: false });
  });

  it("sem cabeçalho, ou cabeçalho que não parece id, a sessão é vazia", () => {
    expect(sessionFromRequest(req(), list).id).toBe("");
    expect(sessionFromRequest(req({ [SESSION_HEADER]: "tem espaço" }), list).id).toBe("");
    expect(sessionFromRequest(req({ [SESSION_HEADER]: "x".repeat(65) }), list).id).toBe("");
    expect(sessionFromRequest(req({ [SESSION_HEADER]: "<script>" }), list).id).toBe("");
  });

  it("corpo que não é JSON não é initialize", () => {
    expect(isInitialize(undefined)).toBe(false);
    expect(isInitialize("texto")).toBe(false);
    expect(sessionFromRequest(req(), undefined).nova).toBe(false);
  });
});

describe("withSessionHeader", () => {
  it("põe o cabeçalho só quando a sessão nasceu aqui, preservando status e corpo", async () => {
    const original = new Response("corpo", { status: 200, headers: { "Content-Type": "text/event-stream" } });
    const r = withSessionHeader(original, { id: "abc", nova: true });
    expect(r.headers.get(SESSION_HEADER)).toBe("abc");
    expect(r.headers.get("Content-Type")).toBe("text/event-stream");
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("corpo");
  });

  it("não toca a resposta fora do initialize", () => {
    const original = new Response("x", { status: 202 });
    expect(withSessionHeader(original, { id: "abc", nova: false })).toBe(original);
    expect(withSessionHeader(original, { id: "", nova: true })).toBe(original);
  });
});

describe("cliente", () => {
  it("normaliza: minúsculas, vocabulário fechado, espaços colapsados, 40 caracteres", () => {
    expect(normalizeClientName("Claude Code")).toBe("claude code");
    expect(normalizeClientName("  mcp-inspector\t(dev)  ")).toBe("mcp-inspector dev");
    expect(normalizeClientName("<b>x</b>; DROP TABLE")).toBe("b x /b drop table");
    expect(normalizeClientName("a".repeat(80))).toHaveLength(40);
    expect(normalizeClientName(42)).toBe("");
    expect(normalizeClientName(undefined)).toBe("");
  });

  it("vem do initialize e só dele", () => {
    expect(clientNameFromBody(init("claude-ai"))).toBe("claude-ai");
    expect(clientNameFromBody([list, init("Cursor")])).toBe("cursor");
    expect(clientNameFromBody(list)).toBe("");
    expect(clientNameFromBody(init(null))).toBe("");
    expect(clientNameFromBody(undefined)).toBe("");
  });
});

describe("blobs 9 e 10", () => {
  const microtasks = () => Promise.resolve();

  it("tagRequest carrega a sessão; sem ela, vazio", () => {
    expect(tagRequest(req(), undefined, "s-1").sessao).toBe("s-1");
    expect(tagRequest(req()).sessao).toBe("");
  });

  it("chamada de ferramenta grava a sessão em blob9 e cliente vazio em blob10", async () => {
    const { points, dataset } = fakeDataset();
    const record = withAnalytics(() => {}, dataset, tagRequest(req(), undefined, "s-1"));
    record("tool_call", "tool_qualquer");
    await microtasks();
    expect(points[0]!.blobs?.[8]).toBe("s-1");
    expect(points[0]!.blobs?.[9]).toBe("");
    expect(points[0]!.blobs).toHaveLength(10);
  });

  it("a linha do initialize grava sessão E cliente; tools/list só a sessão", () => {
    const { points, dataset } = fakeDataset();
    const tag = tagRequest(req(), undefined, "s-2");
    recordProtocolMethods(dataset, tag, [init("Claude Code"), list], 200);
    expect(points.map((p) => [p.blobs?.[0], p.blobs?.[8], p.blobs?.[9]])).toEqual([
      ["initialize", "s-2", "claude code"],
      ["tools/list", "s-2", ""],
    ]);
  });

  it("NENHUM blob carrega o que o cliente mandou de texto livre", () => {
    const { points, dataset } = fakeDataset();
    recordProtocolMethods(dataset, tagRequest(req(), undefined, "s-3"), init("<img src=x onerror=alert(1)>"), 200);
    const tudo = (points[0]!.blobs ?? []).join("|");
    expect(tudo).not.toContain("<");
    expect(tudo).not.toContain("=");
  });
});
