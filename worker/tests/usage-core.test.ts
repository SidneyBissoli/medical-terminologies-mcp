import { describe, expect, it } from "vitest";
import { buildSnapshot, dayKeyUtc, type UsageRow } from "../src/usage-core.js";

describe("dayKeyUtc", () => {
  it("gera YYYY-MM-DD em UTC", () => {
    expect(dayKeyUtc(new Date("2026-08-06T23:59:59-03:00"))).toBe("2026-08-07");
    expect(dayKeyUtc(new Date("2026-08-06T00:00:00Z"))).toBe("2026-08-06");
  });
});

describe("buildSnapshot", () => {
  const now = new Date("2026-08-06T12:00:00Z");

  it("vazio → totais vazios e since null", () => {
    const snap = buildSnapshot([], now);
    expect(snap.totals).toEqual({});
    expect(snap.perTool).toEqual({});
    expect(snap.perDay).toEqual({});
    expect(snap.since).toBeNull();
    expect(snap.ts).toBe(now.toISOString());
  });

  it("agrega totais, perTool e perDay", () => {
    const rows: UsageRow[] = [
      { day: "2026-08-05", kind: "request", name: "/mcp", n: 10 },
      { day: "2026-08-06", kind: "request", name: "/mcp", n: 5 },
      { day: "2026-08-06", kind: "tool_call", name: "exemplo_buscar_catalogo", n: 7 },
      { day: "2026-08-06", kind: "tool_error", name: "exemplo_buscar_catalogo", n: 2 },
      { day: "2026-08-06", kind: "rate_limited", name: "/mcp", n: 1 },
    ];
    const snap = buildSnapshot(rows, now);
    expect(snap.totals).toEqual({ request: 15, tool_call: 7, tool_error: 2, rate_limited: 1 });
    expect(snap.perTool).toEqual({ exemplo_buscar_catalogo: { calls: 7, errors: 2 } });
    expect(snap.perDay["2026-08-05"]).toEqual({ request: 10 });
    expect(snap.perDay["2026-08-06"]).toEqual({
      request: 5,
      tool_call: 7,
      tool_error: 2,
      rate_limited: 1,
    });
    expect(snap.since).toBe("2026-08-05");
  });
});
