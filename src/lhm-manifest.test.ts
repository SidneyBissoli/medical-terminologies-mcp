/**
 * lhm.plugin.json — a ficha do LobeHub — é DERIVADA da superfície real do
 * servidor, nunca mantida à mão.
 *
 * POR QUE ISTO EXISTE (25/09/2026). O LobeHub não relê o repositório nem o
 * npm: a ficha só muda quando `lhm plugin update` publica o manifesto. Em
 * 02/09/2026 a versão do manifesto entrou no espelho do sync-version.mjs, mas
 * NADA prendia os blocos tools/resources/prompts: em 25/09 os cinco manifestos
 * commitados do portfólio estavam com a superfície velha (as mudanças de
 * vocabulário de 22/09 não tinham sido regeneradas) e as cinco fichas
 * publicadas estavam de 1 a 4 minors atrás do npm. Nada quebrava; a ficha só
 * mentia em silêncio.
 *
 * O teste não pina nome nem contagem: compara o arquivo com o `tools/list`,
 * `resources/list` e `prompts/list` do servidor real, e a identidade com o
 * server.json e o package.json. Quem mantém a sincronia é
 * scripts/gen-lhm-manifest.mjs (`npm run build && npm run manifest:lhm`);
 * quem publica é `npx -y @lobehub/market-cli plugin update --dir .`, passo da
 * receita de release.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createServer } from "./register.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leJson = (f: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(raiz, f), "utf8")) as Record<string, unknown>;

type Nomeado = { name: string };
type Endereco = { uri: string };
const porNome = <T extends Nomeado>(lista: T[]): T[] =>
  [...lista].sort((a, b) => a.name.localeCompare(b.name));
const porUri = <T extends Endereco>(lista: T[]): T[] =>
  [...lista].sort((a, b) => a.uri.localeCompare(b.uri));
/** O que é publicado, não a representação em memória (campos `undefined` somem). */
const publicado = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const manifesto = leJson("lhm.plugin.json") as {
  identifier: string;
  version: string;
  cloudEndpoint?: string;
  description: string;
  tools: Nomeado[];
  resources: Endereco[];
  prompts: Nomeado[];
};

let client: Client;

beforeAll(async () => {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "lhm-manifest", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client.close();
});

describe("lhm.plugin.json espelha a superfície servida", () => {
  it("tools: as mesmas do tools/list, com descrição e esquemas iguais", async () => {
    const { tools } = await client.listTools();
    expect(porNome(manifesto.tools)).toEqual(porNome(publicado(tools)));
  });

  it("resources: os mesmos do resources/list", async () => {
    const caps = client.getServerCapabilities() ?? {};
    const resources = caps.resources ? (await client.listResources()).resources : [];
    expect(porUri(manifesto.resources)).toEqual(porUri(publicado(resources)));
  });

  it("prompts: os mesmos do prompts/list", async () => {
    const caps = client.getServerCapabilities() ?? {};
    const prompts = caps.prompts ? (await client.listPrompts()).prompts : [];
    expect(porNome(manifesto.prompts)).toEqual(porNome(publicado(prompts)));
  });
});

describe("lhm.plugin.json carrega a identidade do repositório", () => {
  const registro = leJson("server.json") as { remotes?: Array<{ url: string }> };
  const pacote = leJson("package.json") as { version: string };

  it("o identificador é o da conta no LobeHub", () => {
    expect(manifesto.identifier).toBe("sidneybissoli-medical-terminologies-mcp");
  });

  it("a versão é a do package.json", () => {
    expect(manifesto.version).toBe(pacote.version);
  });

  it("o endpoint hospedado, quando declarado, é o remote do server.json", () => {
    if (manifesto.cloudEndpoint === undefined) return;
    expect(manifesto.cloudEndpoint).toBe(registro.remotes?.[0]?.url);
  });

  it("a descrição não anuncia contagem de ferramentas", () => {
    expect(manifesto.description).not.toMatch(/\d+\s+(?:tools|ferramentas)\b/i);
  });
});
