/**
 * A metade da impressão digital que só a borda HTTP sabe medir, e a costura
 * que só o Worker tem.
 *
 * 1. O Worker monta o PRÓPRIO `McpServer` (`src/server.ts`), separado do
 *    `createServer` do stdio — corrigir um não corrige o outro, e já aconteceu
 *    no ibge-br-mcp (mcpscore 146/148 no stdio, 169/173 em produção). Aqui se
 *    prova que ele serve EXATAMENTE a superfície travada pela raiz.
 * 2. Quem responde sem credencial, em `/mcp` e na rota privada do dono, com
 *    `API_KEY` ausente (produção) e presente — a seção `semToken` do
 *    `surface.lock.json`, sob a mesma regra: mudou sem subir a versão =
 *    vermelho, e o deploy não roda.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  CABECALHOS_MCP,
  capturarSuperficie,
  comHost,
  conferirSecao,
  corpoDoPedido,
  impressaoDigital,
  ipDaSonda,
  lerTrava,
  medirSemToken,
  sondaSemToken,
} from "@sbissoli/mcp-surface";
import { describe, expect, it } from "vitest";

import { SELF_ROUTE } from "../src/analytics.js";
import worker from "../src/index.js";
import { buildServer } from "../src/server.js";
import type { Env } from "../src/types.js";

// `.href`: o URL das workers-types não é o do node:url para o compilador.
const raiz = fileURLToPath(new URL("../../", import.meta.url).href);
const trava = `${raiz}surface.lock.json`;
const versao = (JSON.parse(readFileSync(`${raiz}package.json`, "utf8")) as { version: string }).version;

const HOST = "medical.sidneybissoli.com";
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const envs: Record<string, Env> = {
  apiKeyAusente: {} as Env,
  apiKeyPresente: { API_KEY: "chave-da-sonda" } as Env,
};

// CID-10 empacotada (src/data/cid10.json): `tools/call` sem ir à rede.
const sonda = sondaSemToken({ name: "cid10_chapters", arguments: {} });

const medirBorda = () =>
  medirSemToken(Object.keys(envs), ["POST /mcp", `POST ${SELF_ROUTE}`], sonda, (config, rota, pedido) =>
    worker.fetch(
      comHost(
        new Request(`https://${HOST}${rota.slice("POST ".length)}`, {
          method: "POST",
          headers: { ...CABECALHOS_MCP, "CF-Connecting-IP": ipDaSonda() },
          body: corpoDoPedido(pedido),
        }),
        HOST,
      ),
      envs[config]!,
      ctx,
    ),
  );

describe("surface.lock.json — borda do Worker", () => {
  it("o servidor do Worker serve a MESMA superfície declarada que o stdio travou", async () => {
    const declarada = lerTrava(trava).declarada;
    expect(declarada, "rode `npm run surface:lock` na raiz").toBeDefined();
    expect(impressaoDigital(await capturarSuperficie(buildServer()))).toBe(declarada!.sha256);
  });

  it("quem responde sem token bate com a trava, ou a versão subiu junto", async () => {
    const m = await medirBorda();
    // Sanidade ANTES de conferir — e, no modo de escrita, antes de GRAVAR: uma
    // sonda quebrada (tudo false, ou tudo true) não pode virar trava. Já
    // aconteceu: com o dublê errado, `npm run surface:lock` gravou tudo false
    // e só o teste seguinte, rodando depois da gravação, reclamou.
    const aberta = m["apiKeyAusente"]?.["POST /mcp"];
    const fechada = m["apiKeyPresente"]?.["POST /mcp"];
    expect(aberta?.["tools/list"], "sonda quebrada: sem API_KEY, tools/list tem de responder").toBe(true);
    expect(aberta?.["tools/call"], "sonda quebrada: sem API_KEY, a tool local tem de responder").toBe(true);
    expect(fechada?.["tools/list"], "sonda quebrada: com API_KEY e sem token, tools/list não pode responder").toBe(false);
    const v = conferirSecao(trava, "semToken", m, versao);
    expect(v.ok, v.mensagem).toBe(true);
  }, 60_000);
});
