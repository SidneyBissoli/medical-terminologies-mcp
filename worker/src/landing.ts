/**
 * Landing page na raiz — pública, e a ÚNICA superfície própria do produto.
 *
 * Ela tem dois trabalhos, e por muito tempo só fez o primeiro:
 *
 * 1. **Identificação.** A URL raiz do Worker aparece no User-Agent das chamadas
 *    upstream, então precisa resolver para algo legível por humanos: o que é o
 *    serviço, quem opera, como falar com ele. É o sysadmin da origem que chega
 *    por aqui.
 * 2. **Descoberta.** É o único endereço do produto que não é de terceiro — não é
 *    o npm, não é o GitHub, não é ficha de diretório. Em 2026-08-31 esta página
 *    tinha oito linhas de corpo, nenhuma `meta description`, nenhum og:, nenhum
 *    dado estruturado e nenhum link para o repositório ou para o pacote: quem
 *    chegasse pela busca não tinha o que ler, e quem indexasse não tinha o que
 *    indexar. Era o buraco medido pelo monitor GEO — 32 consultas em português
 *    acharam zero produtos do portfólio.
 *
 * O TEXTO É DA INSTÂNCIA, não deste arquivo: `LANDING` no `config.ts` traz o
 * resumo, os exemplos e os links, e o idioma principal segue o público do
 * produto (pt-BR nos brasileiros, en nos internacionais). O SEGUNDO idioma não é
 * rodapé de cortesia: é seção com resumo e exemplos próprios, porque é texto
 * indexável — e a lacuna medida pelo monitor GEO era justamente a ausência dele.
 */

import { SERVER_CONFIG, LANDING } from "./config.js";

/** Escapa texto de configuração para interpolação segura em HTML. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Rótulos das duas línguas — a página não tem framework, e não precisa. */
const T = {
  "pt-BR": {
    perguntas: "Perguntas que ele responde",
    comoUsar: "Como usar",
    comoUsarTexto: (rota: string, site: string) =>
      `Aponte qualquer cliente MCP para <code>${esc(site)}${esc(rota)}</code> (Streamable HTTP). ` +
      `Não é preciso instalar nada.`,
    endpoints: "Endpoints",
    links: "Links",
    contato: "Contato",
    repo: "Código-fonte no GitHub",
    pacote: "Pacote no npm",
    docs: "Documentação",
    protocolo: "Protocolo",
    tambem: "Also in English",
  },
  en: {
    perguntas: "Questions it answers",
    comoUsar: "How to use it",
    comoUsarTexto: (rota: string, site: string) =>
      `Point any MCP client at <code>${esc(site)}${esc(rota)}</code> (Streamable HTTP). ` +
      `Nothing to install.`,
    endpoints: "Endpoints",
    links: "Links",
    contato: "Contact",
    repo: "Source on GitHub",
    pacote: "Package on npm",
    docs: "Documentation",
    protocolo: "Protocol",
    tambem: "Também em português",
  },
} as const;

export function landingHtml(): string {
  const c = SERVER_CONFIG;
  const l = LANDING;
  const t = T[l.lang];
  const site = c.websiteUrl;

  /**
   * Dados estruturados. `SoftwareApplication` é o tipo que descreve o que isto
   * é — um programa que se instala/conecta —, e é o que dá ao buscador nome,
   * descrição, licença e preço sem depender de ele inferir do texto.
   */
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: c.title,
    description: l.resumo,
    url: site,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Any",
    inLanguage: l.lang,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    license: "https://opensource.org/licenses/MIT",
    author: { "@type": "Person", name: "Sidney Bissoli" },
    codeRepository: l.repoUrl,
  };

  const listaLinks = [
    `<li><a href="${esc(l.repoUrl)}">${t.repo}</a></li>`,
    l.npmUrl ? `<li><a href="${esc(l.npmUrl)}">${t.pacote}</a></li>` : "",
    l.docsUrl ? `<li><a href="${esc(l.docsUrl)}">${t.docs}</a></li>` : "",
    `<li><a href="https://modelcontextprotocol.io">${t.protocolo}: Model Context Protocol</a></li>`,
  ]
    .filter(Boolean)
    .join("\n  ");

  return `<!doctype html>
<html lang="${l.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(c.title)}</title>
<meta name="description" content="${esc(l.resumo)}">
<link rel="canonical" href="${esc(site)}/">
<link rel="icon" href="/icon.png" type="image/png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(c.title)}">
<meta property="og:title" content="${esc(c.title)}">
<meta property="og:description" content="${esc(l.resumo)}">
<meta property="og:url" content="${esc(site)}/">
<meta property="og:image" content="${esc(site)}/icon.png">
<meta property="og:locale" content="${l.lang === "pt-BR" ? "pt_BR" : "en_US"}">
<meta name="twitter:card" content="summary">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.6; margin: 0; padding: 2rem 1.25rem; color: CanvasText; background: Canvas;
  }
  main { max-width: 46rem; margin: 0 auto; }
  h1 { font-size: 1.9rem; line-height: 1.2; margin: 0 0 .5rem; }
  h2 { font-size: 1.15rem; margin-top: 2rem; }
  code { background: color-mix(in srgb, CanvasText 10%, Canvas 90%); padding: .1rem .35rem; border-radius: 4px; }
  ul { padding-left: 1.2rem; }
  .lead { font-size: 1.1rem; }
  .muted { color: color-mix(in srgb, CanvasText 70%, Canvas 30%); }
  .outro { margin-top: 2.5rem; padding-top: 1rem; border-top: 1px solid color-mix(in srgb, CanvasText 20%, Canvas 80%); }
</style>
</head>
<body>
<main>
<h1>${esc(c.title)}</h1>
<p class="lead">${esc(l.resumo)}</p>

<h2>${t.perguntas}</h2>
<ul>
  ${l.exemplos.map((e) => `<li>${esc(e)}</li>`).join("\n  ")}
</ul>

<h2>${t.comoUsar}</h2>
<p>${t.comoUsarTexto(c.mcpRoute, site)}</p>
<ul>
  ${l.destaques.map((d) => `<li>${esc(d)}</li>`).join("\n  ")}
</ul>

<h2>${t.endpoints}</h2>
<ul>
  <li><code>${esc(c.mcpRoute)}</code> — endpoint MCP (Streamable HTTP)</li>
  <li><code>/health</code> — liveness</li>
  <li><code>/status</code> — ${l.lang === "pt-BR" ? "versão e build corrente" : "version and current build"}</li>
  <li><code>/metrics</code> — ${l.lang === "pt-BR" ? "estatísticas de uso agregadas" : "aggregated usage stats"}</li>
</ul>

<h2>${t.links}</h2>
<ul>
  ${listaLinks}
</ul>

<p class="muted">${t.contato}: <a href="mailto:${esc(c.contactEmail)}">${esc(c.contactEmail)}</a></p>

<section class="outro" lang="${l.emOutroIdioma.lang}">
<h2>${t.tambem}</h2>
<p>${esc(l.emOutroIdioma.resumo)}</p>
<ul>
  ${l.emOutroIdioma.exemplos.map((e) => `<li>${esc(e)}</li>`).join("\n  ")}
</ul>
</section>
</main>
</body>
</html>`;
}

export function landingResponse(): Response {
  return new Response(landingHtml(), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
