/**
 * A identidade do handshake é a MESMA nos dois transportes e no manifesto.
 *
 * POR QUE ESTE ARQUIVO EXISTE. Este repositório constrói o `McpServer` em DOIS
 * lugares — `src/server.ts` na raiz (stdio) e `worker/src/server.ts` (HTTP) — e
 * nada ligava os dois. Em 2026-08-30 as correções de conformidade foram feitas
 * só na raiz: o stdio foi de 137/148 para 146/148 e produção ficou em 169/173,
 * porque `title` e `icons` nunca chegaram ao Worker. O deploy saiu, o CI passou
 * e o número não subiu — o defeito era invisível de dentro.
 *
 * A terceira ponta é o `server.json`: é o que o MCP Registry publica e o que os
 * diretórios copiam. Handshake e ficha mostrando nomes ou ícones diferentes do
 * mesmo produto é a mesma classe de divergência, um andar acima.
 *
 * Nada aqui pina literal: o teste COMPARA as três fontes entre si.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { SERVER_CONFIG } from "../src/config.js";

const raizWorker = join(dirname(fileURLToPath(import.meta.url)), "..");
const raiz = join(raizWorker, "..");
const leia = (f: string) => readFileSync(join(raiz, f), "utf8");

interface Icone {
  src?: string;
  mimeType?: string;
  sizes?: string[];
}
const manifesto = JSON.parse(leia("server.json")) as {
  name?: string;
  title?: string;
  websiteUrl?: string;
  icons?: Icone[];
};

describe("identidade do handshake, manifesto e Worker", () => {
  it("o `title` do Worker é o do server.json", () => {
    expect(manifesto.title, "server.json sem title").toBeTruthy();
    expect(SERVER_CONFIG.title).toBe(manifesto.title);
  });

  it("o `websiteUrl` do Worker é o do server.json", () => {
    expect(manifesto.websiteUrl, "server.json sem websiteUrl").toBeTruthy();
    expect(SERVER_CONFIG.websiteUrl).toBe(manifesto.websiteUrl);
  });

  it("os ícones que o Worker anuncia são os do server.json", () => {
    const doManifesto = manifesto.icons ?? [];
    expect(doManifesto.length, "server.json sem icons — são 5 pontos nos diretórios").toBeGreaterThan(0);
    // Compara o CONJUNTO, não a ordem: o que não pode é o handshake anunciar
    // uma imagem que a ficha não anuncia, ou o contrário.
    const chave = (i: { src?: string; theme?: string }) => `${i.theme ?? ""}|${i.src ?? ""}`;
    expect(SERVER_CONFIG.icons.map(chave).sort()).toEqual(doManifesto.map(chave).sort());
  });

  it("a identidade do stdio é a mesma do Worker", () => {
    // Lido do FONTE da raiz, não importado: o pacote da raiz é ESM com
    // resolução própria e importá-lo daqui arrastaria o registro inteiro de
    // tools para dentro do teste do Worker. O que importa é que os dois textos
    // sejam o mesmo, e isso o texto responde.
    const servidorRaiz = leia("src/server-core.ts");
    for (const [rotulo, valor] of [
      ["title", SERVER_CONFIG.title],
      ["websiteUrl", SERVER_CONFIG.websiteUrl],
    ] as const) {
      // Aspas simples ou duplas: o arquivo da raiz segue o estilo dele, e a
      // asserção é sobre o TEXTO declarado, não sobre como ele é citado.
      expect(
        servidorRaiz.includes(`"${valor}"`) || servidorRaiz.includes(`'${valor}'`),
        `src/server-core.ts não declara o mesmo ${rotulo} do Worker (${valor})`,
      ).toBe(true);
    }
  });
});
