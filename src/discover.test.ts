/**
 * O anúncio de `server/discover` (src/discover.ts).
 *
 * Duas coisas precisam continuar verdadeiras, e nenhuma delas é uma literal
 * escrita aqui:
 *
 *   1. o anúncio contém a revisão que o servidor NEGOCIA de fato — era o achado
 *      do mcpscore: ele oferecia só a moderna e atendia a de 2025 calado;
 *   2. o anúncio não inventa nada: toda revisão anunciada é uma que o SDK
 *      declara suportar.
 *
 * O patch mexe em um método interno do SDK. O modo de falha que ele tem de
 * evitar é o SILÊNCIO — SDK renomeia o método, o patch não aplica e o anúncio
 * volta ao antigo sem ninguém ver. Por isso o módulo falha ao construir, e o
 * teste abaixo verifica justamente que o anúncio MUDOU em relação ao padrão do
 * SDK.
 */

import { describe, expect, it } from "vitest";
import { McpServer, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/server";

import { announceServedVersions, maisNovaPrimeiro } from "./discover.js";
import { createServer } from "./register.js";

/** Chama o anúncio pela mesma porta que o handler do SDK usa. */
const anuncio = (server: McpServer): { supportedVersions: string[] } =>
  (server.server as unknown as { _ondiscover(): { supportedVersions: string[] } })._ondiscover();

describe("maisNovaPrimeiro", () => {
  it("ordena revisões datadas da mais nova para a mais antiga, sem repetir", () => {
    expect(maisNovaPrimeiro(["2025-06-18", "2026-07-28", "2025-06-18", "2024-11-05"])).toEqual([
      "2026-07-28",
      "2025-06-18",
      "2024-11-05",
    ]);
  });
});

describe("server/discover do servidor real", () => {
  it("anuncia a revisão que o servidor negocia, e não só as modernas", () => {
    const { supportedVersions } = anuncio(createServer());
    // 2025-11-25 é a revisão que o mcpscore negociou com este servidor em
    // 29/08/2026, e que o anúncio omitia.
    expect(supportedVersions).toContain("2025-11-25");
    expect(supportedVersions.length).toBeGreaterThan(1);
  });

  it("não perde a moderna: a revisão do próprio server/discover está na lista", () => {
    // A regressão que a primeira versão do patch teve: capturar
    // `_supportedProtocolVersions` cedo demais deixava de fora a 2026-07-28,
    // que o SDK acrescenta depois — e a regra do auditor passava assim mesmo,
    // porque ela só confere a revisão negociada.
    const server = createServer();
    const antes = anuncio(server).supportedVersions;
    expect(antes).toContain("2025-11-25");
    // Simula o que a entrada HTTP do SDK faz a cada request: acrescentar as
    // revisões modernas servidas à lista da instância.
    const low = server.server as unknown as { _supportedProtocolVersions: string[] };
    low._supportedProtocolVersions = [...low._supportedProtocolVersions, "2026-07-28"];
    const depois = anuncio(server).supportedVersions;
    expect(depois).toContain("2026-07-28");
    expect(depois).toContain("2025-11-25");
    expect(depois[0]).toBe("2026-07-28");
  });

  it("não inventa revisão: tudo que anuncia, o SDK declara suportar", () => {
    const { supportedVersions } = anuncio(createServer());
    for (const v of supportedVersions) {
      expect(SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).toContain(v);
    }
  });

  it("o anúncio é MAIOR que o padrão do SDK — se empatar, o patch virou silêncio", () => {
    const semPatch = anuncio(new McpServer({ name: "controle", version: "0.0.0" }));
    const comPatch = anuncio(createServer());
    expect(comPatch.supportedVersions.length).toBeGreaterThan(semPatch.supportedVersions.length);
  });

  it("capacidades e instruções continuam vindo do SDK, não do patch", () => {
    const resultado = anuncio(createServer()) as unknown as Record<string, unknown>;
    expect(resultado.capabilities).toBeTypeOf("object");
    expect(resultado.instructions).toBeTypeOf("string");
  });
});

describe("a guarda contra mudança do SDK", () => {
  it("objeto sem _ondiscover faz o patch falhar alto, não passar batido", () => {
    const falso = { server: {} } as unknown as McpServer;
    expect(() => announceServedVersions(falso)).toThrow(/_ondiscover/);
  });

  it("lista de versões com forma inesperada também é erro", () => {
    const falso = {
      server: { _ondiscover: () => ({}), _supportedProtocolVersions: "2026-07-28" },
    } as unknown as McpServer;
    expect(() => announceServedVersions(falso)).toThrow(/_supportedProtocolVersions/);
  });
});
