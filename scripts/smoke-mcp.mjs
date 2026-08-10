/**
 * Manual smoke of the MCP surface (Fase 0 portfolio pattern, ported from
 * ibge-br-mcp): initialize → tools/list → real calls on both bundled and
 * live-upstream tools, plus the pedagogical-error path.
 *
 * The script talks to the SERVER (production Worker or local STDIO), never
 * to WHO/NLM directly — upstream handling (rate limit, retry, cache) lives
 * in the server.
 *
 * Usage:
 *   node scripts/smoke-mcp.mjs                        # HTTP against production
 *   node scripts/smoke-mcp.mjs http://localhost:8787  # HTTP against another base
 *   node scripts/smoke-mcp.mjs --stdio                # spawn dist/index.js (requires npm run build)
 */

import { spawn } from "node:child_process";

const STDIO = process.argv[2] === "--stdio";
const BASE = STDIO ? null : (process.argv[2] ?? "https://medical.sidneybissoli.com");
let nextId = 1;

// --- HTTP transport (Streamable HTTP) ---------------------------------------
let sessionId = null;
async function rpcHttp(method, params, isNotification = false) {
  const body = { jsonrpc: "2.0", method, params };
  if (!isNotification) body.id = nextId++;
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
  sessionId ??= res.headers.get("mcp-session-id");
  if (isNotification) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status} ${text.slice(0, 300)}`);
  // Streamable HTTP may answer as SSE; extract the data: payload(s)
  const payloads =
    text.startsWith("event:") || text.includes("\ndata:") || text.startsWith("data:")
      ? text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim())
      : [text];
  const msg = JSON.parse(payloads[payloads.length - 1]);
  if (msg.error) throw new Error(`${method}: ${JSON.stringify(msg.error).slice(0, 400)}`);
  return msg.result;
}

// --- STDIO transport (newline-delimited JSON against dist/index.js) ---------
let child = null;
const pending = new Map();
function startStdio() {
  child = spawn(process.execPath, ["dist/index.js"], { stdio: ["pipe", "pipe", "inherit"] });
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error).slice(0, 400)));
        else resolve(msg.result);
      }
    }
  });
}
function rpcStdio(method, params, isNotification = false) {
  const body = { jsonrpc: "2.0", method, params };
  if (isNotification) {
    child.stdin.write(JSON.stringify(body) + "\n");
    return Promise.resolve(null);
  }
  const id = nextId++;
  body.id = id;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify(body) + "\n");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`${method}: timeout (60s)`));
      }
    }, 60_000).unref();
  });
}

const rpc = STDIO ? rpcStdio : rpcHttp;
if (STDIO) startStdio();

function fail(msg) {
  console.error(`SMOKE FAILED: ${msg}`);
  process.exit(1);
}

const PROV_META_KEY = "com.sidneybissoli.medical/provenance";

/** Provenance gate (v1.8.0): every success carries the three channels. */
function checkProvenance(label, result, { multi = false, sourceContains } = {}) {
  const prov = result.structuredContent?.provenance;
  if (!prov) fail(`${label}: structuredContent.provenance missing`);
  const blocks = Array.isArray(prov) ? prov : [prov];
  if (multi && !Array.isArray(prov)) fail(`${label}: expected an ARRAY of provenance blocks`);
  for (const b of blocks) {
    if (!b.source || !b.source_url || !b.retrieved_at || !b.citation)
      fail(`${label}: incomplete provenance block ${JSON.stringify(b).slice(0, 200)}`);
    if (b.license === undefined) fail(`${label}: provenance block without license key`);
  }
  if (sourceContains && !blocks.some((b) => b.source.includes(sourceContains)))
    fail(`${label}: no block with source containing "${sourceContains}"`);
  const attribution = result.structuredContent?.attribution;
  if (!Array.isArray(attribution) || attribution.length === 0)
    fail(`${label}: attribution list missing/empty`);
  if (!result._meta || result._meta[PROV_META_KEY] === undefined)
    fail(`${label}: _meta mirror missing (${PROV_META_KEY})`);
  const text = (result.content ?? []).map((c) => c.text).join("\n");
  if (!text.includes("Source: ") || !text.includes("License: "))
    fail(`${label}: text footer missing`);
}

// --- Script ------------------------------------------------------------------
const init = await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0.0.0" },
});
console.log("initialize:", init.serverInfo);
if (init.serverInfo.name !== "medical-terminologies-mcp") fail("unexpected serverInfo.name");

await rpc("notifications/initialized", {}, true).catch(() => {});

const { tools } = await rpc("tools/list", {});
console.log(`tools/list: ${tools.length} tools`);
// 31 = default surface (SNOMED gated off). Local runs with
// ENABLE_SNOMED_TOOLS=true legitimately see 37.
if (tools.length !== 31 && tools.length !== 37)
  fail(`expected 31 (default) or 37 (SNOMED on) tools, got ${tools.length}`);
const noOutputSchema = tools.filter((t) => !t.outputSchema);
if (noOutputSchema.length > 0)
  fail(`tools without outputSchema: ${noOutputSchema.map((t) => t.name).join(", ")}`);
const badAnnotations = tools.filter((t) => t.annotations?.readOnlyHint !== true);
if (badAnnotations.length > 0)
  fail(`tools without readOnlyHint: ${badAnnotations.map((t) => t.name).join(", ")}`);
console.log("outputSchema + READ_ONLY annotations: ok on all", tools.length);

const { prompts } = await rpc("prompts/list", {});
if (prompts.length !== 3) fail(`expected 3 prompts, got ${prompts.length}`);
const { resources } = await rpc("resources/list", {});
if (resources.length !== 4) fail(`expected 4 resources, got ${resources.length}`);
console.log("prompts: 3, resources: 4");

// 1) Bundled dataset — CID-10 (in-process, no upstream)
const cid10 = await rpc("tools/call", {
  name: "cid10_search",
  arguments: { query: "diabetes" },
});
if (cid10.isError) fail("cid10_search returned error");
if (!cid10.structuredContent?.hits?.length) fail("cid10_search: no structured hits");
checkProvenance("cid10_search", cid10, { sourceContains: "DataSUS" });
console.log("\ncid10_search 'diabetes':", cid10.structuredContent.total_count, "matches (provenance ok)");

// 2) Bundled authoritative crosswalk — the 4th most used tool (docs/00)
const map = await rpc("tools/call", {
  name: "map_icd10_to_icd11",
  arguments: { icd10_code: "E10" },
});
if (map.isError) fail("map_icd10_to_icd11 returned error");
if (!map.structuredContent) fail("map_icd10_to_icd11: structuredContent missing");
checkProvenance("map_icd10_to_icd11", map, { sourceContains: "transition tables" });
if (!map.structuredContent.provenance.data_vintage)
  fail("map_icd10_to_icd11: bundled dataset must expose data_vintage");
console.log(
  "map_icd10_to_icd11 E10 →",
  map.structuredContent.primary?.code ?? "(null mapping)",
  "(provenance ok, vintage",
  map.structuredContent.provenance.data_vintage + ")",
);

// 3) Live upstream — RxNorm via NLM (top usage axis: drug)
const rx = await rpc("tools/call", {
  name: "rxnorm_search",
  arguments: { query: "metformin" },
});
if (rx.isError) fail("rxnorm_search returned error (NLM upstream reachable?)");
if (!rx.structuredContent) fail("rxnorm_search: structuredContent missing");
checkProvenance("rxnorm_search", rx, { sourceContains: "RxNav" });
console.log("rxnorm_search 'metformin': ok (provenance ok)");

// 3b) Multi-source provenance — one block PER source (license segregation)
const eq = await rpc("tools/call", {
  name: "find_equivalent",
  arguments: { term: "aspirin", target_terminologies: ["rxnorm", "mesh"], limit: 3 },
});
if (eq.isError) fail("find_equivalent returned error");
checkProvenance("find_equivalent", eq, { multi: true, sourceContains: "RxNav" });
const eqBlocks = eq.structuredContent.provenance;
if (eqBlocks.length !== 2) fail(`find_equivalent: expected 2 blocks, got ${eqBlocks.length}`);
console.log("find_equivalent 'aspirin' (rxnorm+mesh): 2 provenance blocks ok");

// 4) Pedagogical error — handler-level Zod validation, not a protocol error
const bad = await rpc("tools/call", { name: "cid10_search", arguments: {} });
if (!bad.isError) fail("cid10_search without query should return isError");
const errText = bad.content?.[0]?.text ?? "";
if (!errText.includes("Validation error")) fail(`unexpected error text: ${errText.slice(0, 120)}`);
console.log("pedagogical validation error: ok");

// 5) HTTP-only routes (hosted template + legacy StatsCounter)
if (!STDIO) {
  const health = await (await fetch(`${BASE}/health`)).json();
  if (health.status !== "ok") fail("/health not ok");
  const status = await (await fetch(`${BASE}/status`)).json();
  if (status.name !== "medical-terminologies-mcp") fail("/status wrong name");
  const stats = await (await fetch(`${BASE}/stats`)).json();
  if (typeof stats.total_invocations !== "number") fail("/stats malformed");
  const badge = await (await fetch(`${BASE}/stats/badge`)).json();
  if (badge.schemaVersion !== 1 || badge.label !== "tool calls") fail("/stats/badge malformed");
  const metrics = await (await fetch(`${BASE}/metrics`)).json();
  console.log(
    `\nroutes: /health ok | /status ${status.version}${status.deploy ? ` (deploy ${status.deploy.timestamp})` : ""} | /stats total=${stats.total_invocations} | badge='${badge.message}' | /metrics ${metrics.totals ? "ok" : "warn"}`,
  );
}

console.log("\nSMOKE OK");
if (STDIO) child.kill();
process.exit(0);
