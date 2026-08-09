import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { buildServer } from "../src/server.js";
import type { UsageKind } from "../src/usage-core.js";

/**
 * Superfície e instrumentação do Worker: o buildServer reutiliza o registerAll
 * do pacote pai (dist/worker-lib.js), então aqui só se verifica que a
 * superfície chega inteira e que o hook de uso conta tool_call/tool_error.
 * Sem rede: as chamadas usam cid10_* (dataset bundled, roda in-process).
 */

function recorder() {
  const events: Array<{ kind: UsageKind; name?: string | undefined }> = [];
  return { events, record: (kind: UsageKind, name?: string) => events.push({ kind, name }) };
}

async function connect(server: McpServer) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "worker-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("buildServer (worker)", () => {
  it("expõe a superfície completa do pacote pai (31 tools, 4 resources, 3 prompts)", async () => {
    const client = await connect(buildServer());
    const { tools } = await client.listTools();
    const { resources } = await client.listResources();
    const { prompts } = await client.listPrompts();
    // 31 = superfície default (SNOMED gated off — sem ENABLE_SNOMED_TOOLS aqui).
    expect(tools).toHaveLength(31);
    expect(resources).toHaveLength(4);
    expect(prompts).toHaveLength(3);
    await client.close();
  });

  it("registra tool_call em chamada bem-sucedida", async () => {
    const { events, record } = recorder();
    const client = await connect(buildServer(record));
    await client.callTool({ name: "cid10_search", arguments: { query: "diabetes" } });
    expect(events).toContainEqual({ kind: "tool_call", name: "cid10_search" });
    expect(events.filter((e) => e.kind === "tool_error")).toHaveLength(0);
    await client.close();
  });

  it("registra tool_call + tool_error quando o handler devolve isError", async () => {
    const { events, record } = recorder();
    const client = await connect(buildServer(record));
    // args inválidos → Zod no handler → isError pedagógico (sem throw)
    const result = await client.callTool({ name: "cid10_search", arguments: {} });
    expect(result.isError).toBe(true);
    expect(events).toContainEqual({ kind: "tool_call", name: "cid10_search" });
    expect(events).toContainEqual({ kind: "tool_error", name: "cid10_search" });
    await client.close();
  });
});
