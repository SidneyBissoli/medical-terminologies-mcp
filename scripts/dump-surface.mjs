#!/usr/bin/env node
/**
 * Captura um dump NORMALIZADO da superfície MCP (tools + resources + prompts)
 * para provar que uma mudança não a moveu — ou medir exatamente o quanto moveu.
 *
 * Transplantado de bcb-br-mcp/scripts/dump-surface.mjs (a implementação de
 * referência do portfólio). Diferença deliberada: NÃO há modo `--source` aqui —
 * no bcb ele lia o catálogo (`TOOL_DEFINITIONS`) que o worker servia à mão;
 * neste repo o worker reutiliza o `registerAll` do build do pacote pai
 * (worker/src/server.ts importa dist/worker-lib.js), então stdio e worker
 * partilham a superfície POR CONSTRUÇÃO e as superfícies que podem divergir
 * são só duas: o fonte local e o que está DEPLOYADO.
 *
 * Modos:
 *   node scripts/dump-surface.mjs --stdio            spawna dist/index.js e fala JSON-RPC por stdio
 *   node scripts/dump-surface.mjs --url <endpoint>   POST JSON-RPC num endpoint hospedado/local
 *
 * Sempre escreve em stdout; redirecione para baselines/ para guardar artefato:
 *   node scripts/dump-surface.mjs --stdio > baselines/surface-stdio-<versao>.json
 *   node scripts/dump-surface.mjs --url https://medical.sidneybissoli.com/mcp > baselines/surface-http-prod-<versao>.json
 *
 * Normalização: chaves ordenadas recursivamente, tools/resources/prompts
 * ordenados por name/uri, versão do servidor DROPADA (mudaria a cada release e
 * sujaria todo diff — /status e package.json são onde versão se confere).
 */

import { spawn } from "node:child_process";

// ==================== normalização ====================

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(k => [k, sortDeep(value[k])])
    );
  }
  return value;
}

function byKey(list, key) {
  return [...(list ?? [])].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
}

function normalizeSurface({ tools, resources, prompts, serverInfo }) {
  return sortDeep({
    serverName: serverInfo?.name ?? null,
    toolCount: (tools ?? []).length,
    tools: byKey(tools, "name"),
    resources: byKey(resources, "uri"),
    prompts: byKey(prompts, "name")
  });
}

// ==================== transporte stdio ====================

async function captureStdio(entry) {
  const child = spawn(process.execPath, [entry], { stdio: ["pipe", "pipe", "inherit"] });

  let buffer = "";
  const pending = new Map();

  child.stdout.on("data", chunk => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // não é JSON-RPC (logging avulso)
      }
      const resolve = pending.get(msg.id);
      if (resolve) {
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });

  let nextId = 1;
  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`timeout em ${method}`));
      }, 20000);
    });

  try {
    const init = await send("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "dump-surface", version: "1.0.0" }
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

    const [tools, resources, prompts] = await Promise.all([
      send("tools/list", {}),
      send("resources/list", {}).catch(() => ({ result: { resources: [] } })),
      send("prompts/list", {}).catch(() => ({ result: { prompts: [] } }))
    ]);

    return normalizeSurface({
      tools: tools.result?.tools,
      resources: resources.result?.resources,
      prompts: prompts.result?.prompts,
      serverInfo: init.result?.serverInfo
    });
  } finally {
    child.kill();
  }
}

// ==================== transporte HTTP ====================

async function captureHttp(url) {
  let id = 1;
  const rpc = async (method, params) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, params })
    });
    const text = await res.text();
    // Streamable HTTP pode responder como SSE; nesse caso, a última linha data:.
    if (text.startsWith("event:") || text.includes("\ndata:")) {
      const line = text
        .split("\n")
        .filter(l => l.startsWith("data:"))
        .pop();
      return JSON.parse(line.slice(5).trim());
    }
    return JSON.parse(text);
  };

  const init = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "dump-surface", version: "1.0.0" }
  });
  const tools = await rpc("tools/list", {});
  const resources = await rpc("resources/list", {}).catch(() => ({ result: { resources: [] } }));
  const prompts = await rpc("prompts/list", {}).catch(() => ({ result: { prompts: [] } }));

  return normalizeSurface({
    tools: tools.result?.tools,
    resources: resources.result?.resources,
    prompts: prompts.result?.prompts,
    serverInfo: init.result?.serverInfo
  });
}

// ==================== main ====================

const args = process.argv.slice(2);
const urlIndex = args.indexOf("--url");

let surface;
if (args.includes("--stdio")) {
  surface = await captureStdio("dist/index.js");
} else if (urlIndex >= 0) {
  surface = await captureHttp(args[urlIndex + 1]);
} else {
  console.error("uso: dump-surface.mjs --stdio | --url <endpoint>");
  process.exit(2);
}

process.stdout.write(`${JSON.stringify(surface, null, 2)}\n`);
