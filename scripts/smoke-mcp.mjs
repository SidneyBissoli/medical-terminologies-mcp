/**
 * Smoke of the MCP surface (Fase 0 portfolio pattern, ported from
 * ibge-br-mcp): initialize → tools/list → real calls on both bundled and
 * live-upstream tools, plus the pedagogical-error path.
 *
 * The script talks to the SERVER (production Worker or local STDIO), never
 * to WHO/NLM directly — upstream handling (rate limit, retry, cache) lives
 * in the server. The one exception is the PROBE (below): a minimal GET
 * straight at a source, only when a tool has just failed.
 *
 * Usage:
 *   node scripts/smoke-mcp.mjs                        # HTTP against production
 *   node scripts/smoke-mcp.mjs http://localhost:8787  # HTTP against another base
 *   node scripts/smoke-mcp.mjs --stdio                # spawn dist/index.js (requires npm run build)
 *   node scripts/smoke-mcp.mjs --sonda                # only asks the sources whether they serve (exit 0/2)
 *
 * A SOURCE THAT IS DOWN IS NOT A BROKEN DEPLOY. Measured on 2026-10-22 in
 * the siblings: bcb failed two re-runs with the SGS answering 502, and ibge
 * went red on "ibge_estados returned error" with the Worker live at the
 * right version and the IBGE refusing connections from part of the clouds.
 * The panel opened "Deploy FAILED" for deploys that had not failed. The
 * smoke only sees what travels on the wire (`isError` + a text; the class
 * of the upstream error does not travel), so the decision belongs to
 * `criarSmoke` from @sbissoli/mcp-live-source: a tool answering `isError`
 * unexpectedly → direct probe of the source(s) that check names → source
 * down = WARNING (`::warning title=Fonte indisponível`, exit 0); source
 * serving = FAILURE with the tool's text (exit 1). A check that THROWS
 * (assertion, HTTP, JSON-RPC) is a deploy defect and goes red without
 * probing; `esperaErro: true` demands the refusal. Tools that read only the
 * bundled datasets (CID-10, ICD-10→ICD-11 tables) declare `sondas: []`: a
 * failure there is ours by construction.
 */

import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { criarSmoke } from "@sbissoli/mcp-live-source";

const args = process.argv.slice(2);
const STDIO = args.includes("--stdio");
const BASE = STDIO ? null : (args.find((a) => !a.startsWith("--")) ?? "https://medical.sidneybissoli.com");

/**
 * The sources the tools of this script consult, one minimal request each
 * against a resource that EXISTS, with a small body. `SMOKE_SONDA_<NAME>`
 * points a probe elsewhere — to prove `--sonda` saying DOWN without waiting
 * for the NLM to fall over. One probe per origin, because they fail
 * independently (measured 2026-05-09: clinicaltables 404 for a week while
 * RxNav and MeSH served):
 *
 * - rxnav          RxNorm + ATC (RxClass), rxnav.nlm.nih.gov
 * - clinicaltables LOINC, clinicaltables.nlm.nih.gov
 * - mesh           MeSH RDF, id.nlm.nih.gov
 * - who-token      the OAuth issuer of the ICD-11 API (icdaccessmanagement.who.int)
 * - who-api        the ICD-11 API itself (id.who.int). Every API resource
 *                  requires a bearer token, and the smoke has none: the
 *                  probe GETs an API path WITHOUT a token and expects the
 *                  401 — a 4xx is the origin standing up and refusing, which
 *                  the package counts as "servindo" (and logs as "de pé, mas
 *                  recusou o pedido mínimo"; that line is expected here).
 *                  Down is a timeout, a network error or a 5xx.
 *
 * CID-10 and the ICD-10→ICD-11 tables are bundled: no probe.
 */
const ehJson = (f) => (corpo) => {
  try {
    return f(JSON.parse(corpo));
  } catch {
    return false;
  }
};
const smoke = criarSmoke({
  sondas: [
    {
      nome: "rxnav",
      url: process.env.SMOKE_SONDA_RXNAV ?? "https://rxnav.nlm.nih.gov/REST/version.json",
      aceita: ehJson((j) => typeof j?.version === "string"),
    },
    {
      nome: "clinicaltables",
      url:
        process.env.SMOKE_SONDA_CLINICALTABLES ??
        "https://clinicaltables.nlm.nih.gov/api/loinc_items/v3/search?terms=glucose&maxList=1",
      aceita: ehJson((j) => Array.isArray(j) && typeof j[0] === "number" && j[0] > 0),
    },
    {
      nome: "mesh",
      url: process.env.SMOKE_SONDA_MESH ?? "https://id.nlm.nih.gov/mesh/D003920.json",
      aceita: ehJson((j) => j?.["@id"] === "http://id.nlm.nih.gov/mesh/D003920"),
    },
    {
      nome: "who-token",
      url: process.env.SMOKE_SONDA_WHO_TOKEN ?? "https://icdaccessmanagement.who.int/.well-known/openid-configuration",
      aceita: ehJson((j) => j?.token_endpoint === "https://icdaccessmanagement.who.int/connect/token"),
    },
    {
      nome: "who-api",
      url: process.env.SMOKE_SONDA_WHO_API ?? "https://id.who.int/icd/entity",
      cabecalhos: { Accept: "application/json", "API-Version": "v2" },
    },
  ],
});

// Exiting in the same tick in which the fetch socket closes crashes Node 24
// on Windows ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)", rc 127
// instead of the requested code). A short breath fixes it; measured on bcb
// on 2026-10-22.
let child = null; // the STDIO child process, when there is one
async function sair(codigo) {
  if (child) child.kill();
  await new Promise((r) => setTimeout(r, 200));
  process.exit(codigo);
}

if (args.includes("--sonda")) {
  const estados = await smoke.sondar();
  await sair(estados.every((e) => e.veredito === "servindo") ? 0 : 2);
}

/**
 * O smoke fala pela ROTA DE USO PRÓPRIO, e isso não é detalhe de estilo.
 *
 * Ele exercita caminhos de erro DE PROPÓSITO, para afirmar que a ferramenta
 * recusa o que tem de recusar. Pela rota pública essas recusas entram na
 * telemetria indistinguíveis de gente batendo numa porta emperrada — e
 * entravam: medido em 11/09/2026, os DOIS primeiros itens da fila de urgências
 * do painel eram este arquivo. No `ilo_get_data`, 30 dos 36 erros da janela
 * vinham das redes da Azure, que são os runners do GitHub Actions, e os outros
 * 6 da máquina do dono: nenhum de terceiro.
 *
 * O desconto de varredura do monitor não pega isto. Ele procura rajada de
 * catálogo e assinatura de sessão repetida, e um smoke é uma sessão pequena e
 * arrumada; pior, a repetição depende da CADÊNCIA DE DEPLOY, então ele era
 * detectado nas semanas movimentadas e passava batido nas calmas. Detecção que
 * depende de quantas vezes publicamos não é critério. Quem sabe que este
 * tráfego é nosso é este arquivo, então é ele que se identifica.
 *
 * A cobertura da rota pública não se perde: `confereRotaPublica()` abre um
 * handshake contra a rota pública antes do roteiro. `initialize` é método de
 * protocolo e o painel os exclui, então sai de graça na telemetria.
 */
const ROTA_MCP = STDIO ? null : (process.env.SMOKE_MCP_ROUTE ?? "/mcp/uso-proprio");
let nextId = 1;

// --- HTTP transport (Streamable HTTP) ---------------------------------------
let sessionId = null;
async function rpcHttp(method, params, isNotification = false) {
  const body = { jsonrpc: "2.0", method, params };
  if (!isNotification) body.id = nextId++;
  const res = await fetch(`${BASE}${ROTA_MCP}`, {
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

/** Script assertion: throws, and `verificar` records it as a deploy defect. */
function exigir(condicao, msg) {
  if (!condicao) throw new Error(msg);
}

/** A check the rest depends on: if it failed, conclude and exit now. */
async function ouPara(resultado) {
  if (resultado !== undefined) return resultado;
  const resumo = smoke.concluir();
  await sair(resumo.codigoDeSaida);
}

/**
 * A multi-source tool answered WITHOUT the block of a source: that source
 * errored (a source that fails gets no block — crosswalk.ts). On the wire
 * that is a success, so the package would not probe; this synthetic
 * `isError` hands it the decision — the probes of the sources that check
 * names say whether the missing block is an outage (warning) or ours (red).
 */
function faltaFonte(label, blocos, esperados) {
  const fontes = (Array.isArray(blocos) ? blocos : []).map((b) => b.source).join(", ") || "none";
  return {
    isError: true,
    content: [{ type: "text", text: `${label}: expected ${esperados} provenance blocks, got ${blocos?.length ?? 0} (${fontes}) — a source gave no block` }],
  };
}

const PROV_META_KEY = "com.sidneybissoli.medical/provenance";

/** Provenance gate (v1.8.0): every success carries the three channels. */
function checkProvenance(label, result, { multi = false, sourceContains, contractText = false } = {}) {
  const prov = result.structuredContent?.provenance;
  exigir(prov, `${label}: structuredContent.provenance missing`);
  const blocks = Array.isArray(prov) ? prov : [prov];
  exigir(!multi || Array.isArray(prov), `${label}: expected an ARRAY of provenance blocks`);
  for (const b of blocks) {
    exigir(b.source && b.source_url && b.retrieved_at && b.citation, `${label}: incomplete provenance block ${JSON.stringify(b).slice(0, 200)}`);
    exigir(b.license !== undefined, `${label}: provenance block without license key`);
  }
  exigir(!sourceContains || blocks.some((b) => b.source.includes(sourceContains)), `${label}: no block with source containing "${sourceContains}"`);
  const attribution = result.structuredContent?.attribution;
  exigir(Array.isArray(attribution) && attribution.length > 0, `${label}: attribution list missing/empty`);
  exigir(result._meta && result._meta[PROV_META_KEY] !== undefined, `${label}: _meta mirror missing (${PROV_META_KEY})`);
  const text = (result.content ?? []).map((c) => c.text).join("\n");
  if (contractText) {
    // Deep Research pair: content[0].text is the JSON of the object, nothing
    // else (ChatGPT parses it) — provenance travels in the other two channels.
    exigir((result.content ?? []).length === 1, `${label}: contract text must be ONE block`);
    exigir(!("provenance" in JSON.parse(text)), `${label}: contract text carries provenance keys`);
  } else {
    exigir(text.includes("Source: ") && text.includes("License: "), `${label}: text footer missing`);
  }
}

// --- Script ------------------------------------------------------------------

/** Handshake against the PUBLIC route, so a break only there does not go unnoticed. */
async function confereRotaPublica() {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "smoke-rota-publica", version: "0.0.0" },
      },
    }),
  });
  const texto = await res.text();
  exigir(res.ok, `rota pública /mcp: HTTP ${res.status} ${texto.slice(0, 200)}`);
  const linha = texto.includes("data:")
    ? texto.split("\n").find((l) => l.startsWith("data:"))?.slice(5).trim()
    : texto;
  const nome = JSON.parse(linha)?.result?.serverInfo?.name;
  exigir(nome, `rota pública /mcp sem serverInfo (${texto.slice(0, 200)})`);
  return nome;
}

/**
 * CONTRATO DE SESSÃO (desde 2026-09-17). O Worker emite `Mcp-Session-Id` no
 * initialize para a telemetria ligar as mensagens de um aperto de mão; o
 * handler é stateless e IGNORA o cabeçalho que o cliente devolve. Este teste
 * existe porque isso depende do modo stateless do SDK e do `agents`: um
 * upgrade que passasse a validar sessão quebraria todo cliente que devolve o
 * id — e quebraria aqui, no deploy, antes de virar incidente. O DELETE é 405
 * nos sete servidores (servidor sem sessão não encerra sessão).
 */
async function contratoDeSessao(endpoint) {
  const cab = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  const init = await fetch(endpoint, {
    method: "POST", headers: cab,
    body: JSON.stringify({ jsonrpc: "2.0", id: 91, method: "initialize", params: {
      protocolVersion: "2025-06-18", capabilities: {},
      clientInfo: { name: "smoke-contrato-sessao", version: "0.0.0" } } })
  });
  await init.text();
  const sid = init.headers.get("mcp-session-id") ?? "";
  exigir(/^[A-Za-z0-9._~-]{1,64}$/.test(sid), `initialize sem Mcp-Session-Id legível (${JSON.stringify(sid)})`);
  const lista = await fetch(endpoint, {
    method: "POST", headers: { ...cab, "mcp-session-id": "contrato-inexistente-" + Date.now() },
    body: JSON.stringify({ jsonrpc: "2.0", id: 92, method: "tools/list", params: {} })
  });
  await lista.text();
  exigir(lista.status === 200, `tools/list com id desconhecido respondeu HTTP ${lista.status} (o handler stateless tem de ignorar o cabeçalho)`);
  const del = await fetch(endpoint, { method: "DELETE", headers: { "mcp-session-id": sid } });
  await del.text();
  exigir(del.status === 405, `DELETE respondeu HTTP ${del.status}, esperado 405 (servidor sem sessão)`);
  return "id emitido no initialize, id desconhecido ignorado, DELETE 405";
}

if (!STDIO && ROTA_MCP !== "/mcp") await ouPara(await smoke.verificar("rota pública /mcp", confereRotaPublica, { detalhe: (n) => n }));
if (!STDIO) await ouPara(await smoke.verificar("contrato de sessão", () => contratoDeSessao(`${BASE}${ROTA_MCP}`), { detalhe: (d) => d }));

await ouPara(
  await smoke.verificar(
    "initialize",
    async () => {
      const init = await rpc("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "smoke", version: "0.0.0" },
      });
      exigir(init.serverInfo?.name === "medical-terminologies-mcp", `unexpected serverInfo.name: ${init.serverInfo?.name}`);
      await rpc("notifications/initialized", {}, true).catch(() => {});
      return init;
    },
    { detalhe: (init) => `${init.serverInfo.name} ${init.serverInfo.version}` },
  ),
);

// The expected count is NOT a literal: it comes from the most recent surface
// baseline (baselines/surface-stdio-<version>.json —
// see baselines/README.md). A surface change without a recaptured baseline
// turns the smoke red, which is the deal. (Until 1.18.x a run with
// ENABLE_SNOMED_TOOLS=true legitimately saw 6 more; SNOMED was retired in 2.0.0.)
const versionOf = (name) => name.match(/(\d+)\.(\d+)\.(\d+)/).slice(1).map(Number);
const latestBaseline = readdirSync("baselines")
  .filter((f) => /^surface-stdio-\d+\.\d+\.\d+\.json$/.test(f))
  .sort((a, b) => {
    const [va, vb] = [versionOf(a), versionOf(b)];
    return va[0] - vb[0] || va[1] - vb[1] || va[2] - vb[2];
  })
  .at(-1);

await ouPara(
  await smoke.verificar(
    "tools/list",
    async () => {
      exigir(latestBaseline, "no baselines/surface-stdio-*.json to derive the tool count from");
      const expected = JSON.parse(readFileSync(`baselines/${latestBaseline}`, "utf8")).toolCount;
      const { tools } = await rpc("tools/list", {});
      exigir(tools.length === expected, `expected ${expected} tools (baseline ${latestBaseline}), got ${tools.length}`);
      const noOutputSchema = tools.filter((t) => !t.outputSchema);
      exigir(noOutputSchema.length === 0, `tools without outputSchema: ${noOutputSchema.map((t) => t.name).join(", ")}`);
      const badAnnotations = tools.filter((t) => t.annotations?.readOnlyHint !== true);
      exigir(badAnnotations.length === 0, `tools without readOnlyHint: ${badAnnotations.map((t) => t.name).join(", ")}`);
      return tools;
    },
    { detalhe: (tools) => `${tools.length} tools (baseline ${latestBaseline}), outputSchema + readOnlyHint ok on all` },
  ),
);

await smoke.verificar(
  "prompts/list + resources/list",
  async () => {
    const { prompts } = await rpc("prompts/list", {});
    exigir(prompts.length === 3, `expected 3 prompts, got ${prompts.length}`);
    const { resources } = await rpc("resources/list", {});
    exigir(resources.length === 4, `expected 4 resources, got ${resources.length}`);
    return { prompts: prompts.length, resources: resources.length };
  },
  { detalhe: (r) => `prompts: ${r.prompts}, resources: ${r.resources}` },
);

const chamar = (name, args) => rpc("tools/call", { name, arguments: args });

// 1) Bundled dataset — CID-10 (in-process, no upstream): a failure is ours.
await smoke.verificar(
  "cid10_search 'diabetes' (bundled)",
  async () => {
    const cid10 = await chamar("cid10_search", { query: "diabetes" });
    if (cid10.isError) return cid10;
    exigir(cid10.structuredContent?.hits?.length, "cid10_search: no structured hits");
    checkProvenance("cid10_search", cid10, { sourceContains: "DataSUS" });
    return cid10;
  },
  { sondas: [], detalhe: (r) => `${r.structuredContent.total_count} matches (provenance ok)` },
);

// 2) Bundled authoritative crosswalk — the 4th most used tool (docs/00)
await smoke.verificar(
  "map_icd10_to_icd11 E10 (bundled)",
  async () => {
    const map = await chamar("map_icd10_to_icd11", { icd10_code: "E10" });
    if (map.isError) return map;
    exigir(map.structuredContent, "map_icd10_to_icd11: structuredContent missing");
    checkProvenance("map_icd10_to_icd11", map, { sourceContains: "transition tables" });
    exigir(map.structuredContent.provenance.data_vintage, "map_icd10_to_icd11: bundled dataset must expose data_vintage");
    return map;
  },
  {
    sondas: [],
    detalhe: (m) => `E10 → ${m.structuredContent.primary?.code ?? "(null mapping)"} (provenance ok, vintage ${m.structuredContent.provenance.data_vintage})`,
  },
);

// 3) Live upstream — RxNorm via NLM (top usage axis: drug)
await smoke.verificar(
  "rxnorm_search 'metformin' (RxNav)",
  async () => {
    const rx = await chamar("rxnorm_search", { query: "metformin" });
    if (rx.isError) return rx;
    exigir(rx.structuredContent, "rxnorm_search: structuredContent missing");
    checkProvenance("rxnorm_search", rx, { sourceContains: "RxNav" });
    return rx;
  },
  { sondas: ["rxnav"], detalhe: () => "provenance ok" },
);

// 3b) Multi-source provenance — one block PER source (license segregation).
// A source that errors gets no block, and the tool still answers: fewer
// blocks than sources is handed to the package as an error (see faltaFonte).
await smoke.verificar(
  "find_equivalent 'aspirin' rxnorm+mesh (2 provenance blocks)",
  async () => {
    const eq = await chamar("find_equivalent", { term: "aspirin", target_terminologies: ["rxnorm", "mesh"], limit: 3 });
    if (eq.isError) return eq;
    const blocos = eq.structuredContent?.provenance;
    if (Array.isArray(blocos) && blocos.length !== 2) return faltaFonte("find_equivalent", blocos, 2);
    checkProvenance("find_equivalent", eq, { multi: true, sourceContains: "RxNav" });
    return eq;
  },
  { sondas: ["rxnav", "mesh"], detalhe: () => "2 provenance blocks ok" },
);

// 3c) ChatGPT Deep Research contract — search → fetch with the returned id.
// `search` fans out to the live upstreams and ranks with the local CID-10
// index (a source that fails is left out, never an error); `fetch` renders
// through the terminology's lookup tool, so its source is the id's prefix.
// The text of both is the JSON of the object (the contract), provenance in
// the other two channels.
const busca = await smoke.verificar(
  "search 'diabetes' (Deep Research)",
  async () => {
    const search = await chamar("search", { query: "diabetes" });
    if (search.isError) return search;
    const found = search.structuredContent?.results ?? [];
    exigir(found.length > 0, "search 'diabetes': no results");
    exigir(!found.some((r) => !r.id || !r.title || !r.url), "search: result without id/title/url");
    exigir(JSON.parse(search.content?.[0]?.text ?? "{}").results?.length === found.length, "search: content[0].text is not the JSON of the object");
    checkProvenance("search", search, { multi: true, sourceContains: "DataSUS", contractText: true });
    return { search, found };
  },
  { detalhe: (b) => `${b.found.length} results | [0] = ${b.found[0].id} | ${b.search.structuredContent.provenance.length} provenance blocks` },
);

const SONDAS_POR_PREFIXO = { "icd11:": ["who-token", "who-api"], "loinc:": ["clinicaltables"], "rxnorm:": ["rxnav"], "mesh:": ["mesh"] };
if (busca === undefined) {
  smoke.naoMedida("fetch (Deep Research)", "depends on the id that search would return");
} else {
  const id = busca.found[0].id;
  const sondas = Object.entries(SONDAS_POR_PREFIXO).find(([p]) => id.startsWith(p))?.[1] ?? []; // cid10:/version: are bundled
  await smoke.verificar(
    "fetch (Deep Research)",
    async () => {
      const doc = await chamar("fetch", { id });
      if (doc.isError) return doc;
      exigir(doc.structuredContent?.id === id && doc.structuredContent?.text && doc.structuredContent?.url, "fetch: document without id/text/url");
      checkProvenance("fetch", doc, { contractText: true });
      return doc;
    },
    { sondas, detalhe: (d) => `${id} | text ${d.structuredContent.text.length} chars | url ${d.structuredContent.url}` },
  );
}

await smoke.verificar(
  "fetch of an unknown id → isError",
  () => chamar("fetch", { id: "nope:1" }),
  { esperaErro: true, detalhe: (e) => (e.content?.[0]?.text ?? "").replaceAll(/\s+/g, " ").slice(0, 80) },
);

// 4) Pedagogical error — handler-level Zod validation, not a protocol error.
// The refusal is the right answer; its text still has to be the validation one.
await smoke.verificar(
  "cid10_search without query → validation isError",
  async () => {
    const bad = await chamar("cid10_search", {});
    if (!bad.isError) return bad;
    const errText = bad.content?.[0]?.text ?? "";
    exigir(errText.includes("Validation error"), `unexpected error text: ${errText.slice(0, 120)}`);
    return bad;
  },
  { esperaErro: true, detalhe: (e) => (e.content?.[0]?.text ?? "").replaceAll(/\s+/g, " ").slice(0, 80) },
);

// 5) HTTP-only routes (hosted template + legacy StatsCounter)
if (!STDIO) {
  await smoke.verificar(
    "routes /health /status /stats /stats/badge /metrics",
    async () => {
      const health = await (await fetch(`${BASE}/health`)).json();
      exigir(health.status === "ok", "/health not ok");
      const status = await (await fetch(`${BASE}/status`)).json();
      exigir(status.name === "medical-terminologies-mcp", "/status wrong name");
      const stats = await (await fetch(`${BASE}/stats`)).json();
      exigir(typeof stats.total_invocations === "number", "/stats malformed");
      const badge = await (await fetch(`${BASE}/stats/badge`)).json();
      exigir(badge.schemaVersion === 1 && badge.label === "tool calls", "/stats/badge malformed");
      const metrics = await (await fetch(`${BASE}/metrics`)).json();
      return `/health ok | /status ${status.version}${status.deploy ? ` (deploy ${status.deploy.timestamp})` : ""} | /stats total=${stats.total_invocations} | badge='${badge.message}' | /metrics ${metrics.totals ? "ok" : "warn"}`;
    },
    { detalhe: (d) => d },
  );
}

const resumo = smoke.concluir();
console.log(resumo.codigoDeSaida === 0 ? (resumo.naoMedidas.length > 0 ? "\nSMOKE OK with source warning" : "\nSMOKE OK") : "\nSMOKE FAILED");
await sair(resumo.codigoDeSaida);
