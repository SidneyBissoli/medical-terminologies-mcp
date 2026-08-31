/**
 * A landing page carrega, de fato, o que a torna encontrável.
 *
 * POR QUE ESTE ARQUIVO EXISTE. Até 2026-08-31 esta página tinha oito linhas de
 * corpo: título, a `description` do handshake e uma lista de endpoints. Sem
 * `meta description`, sem og:, sem dado estruturado, sem link para o
 * repositório ou para o pacote, e — nos servidores de dado brasileiro — com o
 * texto todo em inglês. É o único endereço do produto que não pertence a
 * terceiro, e não havia o que indexar nele. O monitor GEO mediu a consequência:
 * 32 consultas de buscador em português acharam ZERO produtos do portfólio.
 *
 * O que este teste guarda não é a aparência, é a presença: uma página pode
 * perder a `meta description` num refactor de template sem que nada quebre, sem
 * que nenhum outro teste reprove, e sem que ninguém veja — o mesmo silêncio que
 * deixou a contagem de ferramentas apodrecer em prosa. Nada aqui pina literal:
 * tudo é comparado com o `LANDING` e o `SERVER_CONFIG` que a página consome
 * ([[verificacao-deriva-da-fonte]]).
 */

import { describe, expect, it } from "vitest";

import { landingHtml } from "../src/landing.js";
import { LANDING, SERVER_CONFIG } from "../src/config.js";

const html = landingHtml();

/** O mesmo escape que a página aplica — o texto no HTML é o escapado. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

describe("landing page — superfície de descoberta", () => {
  it("declara o idioma principal do produto", () => {
    expect(html).toContain(`<html lang="${LANDING.lang}">`);
  });

  it("tem meta description, e é o resumo do produto", () => {
    expect(html).toContain(`<meta name="description" content="${esc(LANDING.resumo)}">`);
  });

  it("tem canonical e og: apontando para o domínio próprio", () => {
    expect(html).toContain(`<link rel="canonical" href="${SERVER_CONFIG.websiteUrl}/">`);
    expect(html).toContain(`<meta property="og:url" content="${SERVER_CONFIG.websiteUrl}/">`);
    expect(html).toContain(`<meta property="og:description" content="${esc(LANDING.resumo)}">`);
  });

  it("publica dados estruturados válidos, coerentes com a configuração", () => {
    // `m?.[1]` e nao `m![1]`: com noUncheckedIndexedAccess o grupo capturado e
    // `string | undefined`, e o `tsc` do CI reprova o nao-nulo direto.
    const bruto = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)?.[1];
    expect(bruto, "landing sem bloco JSON-LD").toBeTruthy();
    const dados = JSON.parse(bruto as string) as Record<string, unknown>;
    expect(dados["@type"]).toBe("SoftwareApplication");
    expect(dados.name).toBe(SERVER_CONFIG.title);
    expect(dados.description).toBe(LANDING.resumo);
    expect(dados.url).toBe(SERVER_CONFIG.websiteUrl);
    expect(dados.codeRepository).toBe(LANDING.repoUrl);
  });

  it("mostra as perguntas que o produto responde", () => {
    expect(LANDING.exemplos.length, "landing sem exemplo nenhum").toBeGreaterThan(0);
    for (const exemplo of LANDING.exemplos) {
      expect(html, `exemplo ausente da página: ${exemplo}`).toContain(esc(exemplo));
    }
  });

  it("mostra o que o produto faz de diferente", () => {
    expect(LANDING.destaques.length, "landing sem destaque nenhum").toBeGreaterThan(0);
    for (const destaque of LANDING.destaques) {
      expect(html, `destaque ausente da página: ${destaque}`).toContain(esc(destaque));
    }
  });

  it("leva a quem chega para o repositório e para o endpoint", () => {
    expect(html).toContain(`href="${LANDING.repoUrl}"`);
    expect(html).toContain(SERVER_CONFIG.mcpRoute);
    expect(html).toContain(`mailto:${SERVER_CONFIG.contactEmail}`);
  });

  it("traz o produto no SEGUNDO idioma, com resumo e exemplos próprios", () => {
    // É a metade que faltava: sem ela, metade do público chega e não entende, e
    // metade do texto indexável não existe.
    const outro = LANDING.emOutroIdioma;
    expect(outro.lang).not.toBe(LANDING.lang);
    expect(html).toContain(`lang="${outro.lang}"`);
    expect(html).toContain(esc(outro.resumo));
    expect(outro.exemplos.length, "segundo idioma sem exemplo nenhum").toBeGreaterThan(0);
    for (const exemplo of outro.exemplos) {
      expect(html, `exemplo ausente do segundo idioma: ${exemplo}`).toContain(esc(exemplo));
    }
  });
});
