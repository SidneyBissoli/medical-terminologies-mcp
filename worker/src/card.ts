/**
 * Static (per-deploy) server card for registry scanners (e.g. Smithery) that read
 * `/.well-known/mcp/server-card.json` instead of connecting to `/mcp`. Built once
 * per isolate by introspecting the real `registerAll` surface via an in-memory
 * transport, so the advertised tools/resources/prompts never drift from /mcp.
 */

import { InMemoryTransport } from "@modelcontextprotocol/server";

import { SERVER_CONFIG } from "./config.js";
import { buildServer } from "./server.js";

let serverCardCache: string | undefined;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonRpcResult = any;

export async function getServerCard(): Promise<string> {
  if (serverCardCache) return serverCardCache;

  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  // Talk to the server with raw JSON-RPC over the in-memory transport instead of
  // the SDK Client: the Client compiles tool outputSchemas with Ajv (via
  // `new Function`), which the Cloudflare Workers runtime forbids. The server side
  // of `*/list` does no such codegen, so raw requests are safe here.
  const pending = new Map<number, (msg: JsonRpcResult) => void>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientTransport.onmessage = (msg: any) => {
    if (msg && typeof msg.id === "number" && pending.has(msg.id)) {
      pending.get(msg.id)!(msg);
      pending.delete(msg.id);
    }
  };
  await clientTransport.start();

  let nextId = 1;
  const request = (method: string, params?: unknown): Promise<JsonRpcResult> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, (msg) =>
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void clientTransport.send({ jsonrpc: "2.0", id, method, params } as any);
    });

  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "server-card-builder", version: SERVER_CONFIG.version },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  void clientTransport.send({ jsonrpc: "2.0", method: "notifications/initialized" } as any);

  const tools = (await request("tools/list")).tools;
  let resources: unknown[] = [];
  let prompts: unknown[] = [];
  try {
    resources = (await request("resources/list")).resources;
  } catch {
    /* server may not advertise resources */
  }
  try {
    prompts = (await request("prompts/list")).prompts;
  } catch {
    /* server may not advertise prompts */
  }
  await clientTransport.close();

  serverCardCache = JSON.stringify({
    name: SERVER_CONFIG.name,
    version: SERVER_CONFIG.version,
    websiteUrl: SERVER_CONFIG.websiteUrl,
    protocolVersion: init.protocolVersion,
    capabilities: init.capabilities,
    instructions: init.instructions,
    tools,
    resources,
    prompts,
  });
  return serverCardCache;
}
