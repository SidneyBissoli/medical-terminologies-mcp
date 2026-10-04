/**
 * O server card (`/.well-known/mcp/server-card.json`) que a Smithery lê quando
 * a varredura do `/mcp` não completa.
 *
 * Até 04/10/2026 ele saía de um `worker/src/card.ts` copiado entre servidores,
 * com `name`/`version` soltos na raiz — fora da forma documentada pela Smithery
 * (`serverInfo: { name, version }`). Agora é gerado por
 * `@sbissoli/mcp-surface/card`, e este teste prova as três coisas que importam:
 * a forma, que o card É a superfície travada (mesmo sha256 da seção
 * `declarada`), e que `authentication` diz o que a borda MEDIU (`semToken`).
 *
 * Nada aqui pina literal: versão, sha e autenticação vêm do package.json e do
 * surface.lock.json.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { impressaoDigital, lerTrava, normalizarSuperficie } from "@sbissoli/mcp-surface";
import { superficieDoCard } from "@sbissoli/mcp-surface/card";
import { describe, expect, it } from "vitest";

import worker from "../src/index.js";
import type { Env } from "../src/types.js";

// `.href`: o URL das workers-types não é o do node:url para o compilador.
const raiz = fileURLToPath(new URL("../../", import.meta.url).href);
const caminhoTrava = `${raiz}surface.lock.json`;
const versao = (JSON.parse(readFileSync(`${raiz}package.json`, "utf8")) as { version: string }).version;

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

async function pedirCard(): Promise<{ res: Response; card: Record<string, unknown> }> {
  const res = await worker.fetch(
    new Request("https://medical.sidneybissoli.com/.well-known/mcp/server-card.json"),
    {} as Env,
    ctx,
  );
  return { res, card: (await res.json()) as Record<string, unknown> };
}

describe("GET /.well-known/mcp/server-card.json", () => {
  it("responde 200 JSON com serverInfo.name e serverInfo.version do package.json", async () => {
    const { res, card } = await pedirCard();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const serverInfo = card["serverInfo"] as { name?: unknown; version?: unknown } | undefined;
    expect(typeof serverInfo?.name).toBe("string");
    expect(serverInfo!.name).not.toBe("");
    expect(serverInfo!.version).toBe(versao);
  });

  it("é a MESMA superfície declarada no surface.lock.json", async () => {
    const declarada = lerTrava(caminhoTrava).declarada;
    expect(declarada, "rode `npm run surface:lock` na raiz").toBeDefined();
    const { card } = await pedirCard();
    expect(impressaoDigital(normalizarSuperficie(superficieDoCard(card)))).toBe(declarada!.sha256);
  });

  it("authentication.required segue a seção semToken da trava", async () => {
    // Em produção (sem API_KEY), POST /mcp responde tools/list sem token: o
    // card tem de dizer que NÃO exige credencial. Lido da trava, não pinado.
    const semToken = lerTrava(caminhoTrava).semToken?.conteudo as
      | Record<string, Record<string, Record<string, boolean>>>
      | undefined;
    const abertoSemToken = semToken?.["apiKeyAusente"]?.["POST /mcp"]?.["tools/list"];
    expect(abertoSemToken, "trava sem semToken medido").toBe(true);
    const { card } = await pedirCard();
    expect(card["authentication"]).toEqual({ required: false });
  });
});
