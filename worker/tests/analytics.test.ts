/**
 * Telemetria no Analytics Engine (src/analytics.ts): marcação da requisição
 * (país/AS/self) e coalescência do par tool_call/tool_error numa linha só.
 */

import { describe, expect, it } from "vitest";

import { SELF_HEADER, tagRequest, withAnalytics, type RequestTag } from "../src/analytics.js";
import type { RecordUsage, UsageKind } from "../src/usage-core.js";

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

function makeRequest(headers: Record<string, string> = {}, cf?: Record<string, unknown>): Request {
  const req = new Request("https://example.com/mcp", { headers });
  if (cf) Object.defineProperty(req, "cf", { value: cf });
  return req;
}

const TAG: RequestTag = { self: false, country: "BR", asOrg: "Claro NXT" };

/** Espera os microtasks pendentes (flush do "ok") rodarem. */
const microtasks = () => Promise.resolve();

describe("tagRequest", () => {
  it("extrai país e organização do AS de request.cf", () => {
    const tag = tagRequest(makeRequest({}, { country: "US", asOrganization: "Anthropic" }));
    expect(tag).toEqual({ self: false, country: "US", asOrg: "Anthropic" });
  });

  it("sem request.cf (dev local), país e AS ficam vazios", () => {
    expect(tagRequest(makeRequest())).toEqual({ self: false, country: "", asOrg: "" });
  });

  it("marca self somente quando o header bate com o secret", () => {
    expect(tagRequest(makeRequest({ [SELF_HEADER]: "s3cr3t" }), "s3cr3t").self).toBe(true);
    expect(tagRequest(makeRequest({ [SELF_HEADER]: "errado" }), "s3cr3t").self).toBe(false);
    expect(tagRequest(makeRequest(), "s3cr3t").self).toBe(false);
  });

  it("sem secret configurado, nunca marca self", () => {
    expect(tagRequest(makeRequest({ [SELF_HEADER]: "qualquer" })).self).toBe(false);
  });
});

describe("withAnalytics", () => {
  it("sem binding, devolve o registrador original intacto", () => {
    const record: RecordUsage = () => {};
    expect(withAnalytics(record, undefined, TAG)).toBe(record);
  });

  it("tool_call sem tool_error vira UMA linha ok após o microtask", async () => {
    const { points, dataset } = fakeDataset();
    const record = withAnalytics(() => {}, dataset, TAG);
    record("tool_call", "ibge_estados");
    expect(points).toHaveLength(0); // ainda bufferizada
    await microtasks();
    expect(points).toHaveLength(1);
    expect(points[0]!).toEqual({
      indexes: ["ibge_estados"],
      blobs: ["ibge_estados", "ok", "", "", "BR", "Claro NXT"],
      doubles: [0],
    });
  });

  it("par tool_call+tool_error síncrono vira UMA linha error", async () => {
    const { points, dataset } = fakeDataset();
    const record = withAnalytics(() => {}, dataset, TAG);
    record("tool_call", "ibge_sidra");
    record("tool_error", "ibge_sidra");
    await microtasks();
    expect(points).toHaveLength(1);
    expect(points[0]!.blobs?.[1]).toBe("error");
    expect(points[0]!.doubles).toEqual([1]);
  });

  it("chamadas sucessivas (ok, error, ok) geram uma linha cada", async () => {
    const { points, dataset } = fakeDataset();
    const record = withAnalytics(() => {}, dataset, TAG);
    record("tool_call", "a");
    await microtasks();
    record("tool_call", "b");
    record("tool_error", "b");
    record("tool_call", "c");
    await microtasks();
    expect(points.map((p) => [p.blobs?.[0], p.blobs?.[1]])).toEqual([
      ["a", "ok"],
      ["b", "error"],
      ["c", "ok"],
    ]);
  });

  it("grava self em blob4 quando a requisição é do dono", async () => {
    const { points, dataset } = fakeDataset();
    const record = withAnalytics(() => {}, dataset, { self: true, country: "US", asOrg: "Anthropic" });
    record("tool_call", "ibge_estados");
    await microtasks();
    expect(points[0]!.blobs).toEqual(["ibge_estados", "ok", "", "self", "US", "Anthropic"]);
  });

  it("repassa todos os eventos ao registrador original", () => {
    const seen: [UsageKind, string | undefined][] = [];
    const { dataset } = fakeDataset();
    const record = withAnalytics((kind, name) => seen.push([kind, name]), dataset, TAG);
    record("request", "/mcp");
    record("tool_call", "x");
    record("tool_error", "x");
    expect(seen).toEqual([
      ["request", "/mcp"],
      ["tool_call", "x"],
      ["tool_error", "x"],
    ]);
  });

  it("falha do writeDataPoint não derruba nem o registro de uso", async () => {
    const boom = {
      writeDataPoint: () => {
        throw new Error("AE indisponível");
      },
    } as AnalyticsEngineDataset;
    const seen: [UsageKind, string | undefined][] = [];
    const record = withAnalytics((kind, name) => seen.push([kind, name]), boom, TAG);
    record("tool_call", "x");
    await microtasks();
    expect(seen).toEqual([["tool_call", "x"]]);
  });
});
