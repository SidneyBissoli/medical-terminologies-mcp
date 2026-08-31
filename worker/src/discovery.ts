/**
 * As três coisas que um rastreador procura antes de decidir se vale a pena
 * visitar um domínio: `robots.txt`, `sitemap.xml` e a chave do IndexNow.
 *
 * POR QUE ESTE ARQUIVO EXISTE. Em 31/08/2026 a landing foi reescrita para ser
 * indexável — meta description, og:, JSON-LD, texto de verdade nos dois
 * idiomas. E aí a pergunta certa apareceu: indexável por quem? Medido no mesmo
 * dia, `sitemap.xml` respondia **404** nos quatro domínios do portfólio, e o
 * `robots.txt` servido era o bloco de *content signals* que a Cloudflare injeta
 * — 1.248 bytes que são só COMENTÁRIO, sem uma única diretiva ativa: nenhum
 * `Sitemap:`, nenhum `Allow`. Não bloqueia nada, e também não convida nada. Os
 * links de entrada para o domínio são finos (o `homepage` do GitHub, o npm, as
 * fichas de diretório), então esperar rastreamento espontâneo era esperar por
 * algo que podia não acontecer — e, pior, ler o silêncio como resposta.
 *
 * O IndexNow é a peça que não depende de conta em painel de buscador: publica-se
 * uma chave num arquivo do próprio domínio e avisa-se por HTTP quando uma URL
 * muda. Bing, Yandex, Seznam e Naver honram o protocolo. A chave é PÚBLICA por
 * desenho — ela prova posse do domínio justamente por estar servida nele, então
 * versioná-la não é vazamento.
 *
 * O sitemap tem UMA URL: a raiz. É o que este domínio serve de conteúdo — os
 * artigos moram no GitHub. Isso é pouco, e é honesto: um sitemap não pode
 * listar URL de outro host. Servir os artigos aqui é o passo que tornaria este
 * arquivo valer mais do que a linha `Sitemap:`.
 */

import { SERVER_CONFIG } from "./config.js";

/** Quando a superfície mudou pela última vez — vira o `lastmod` do sitemap. */
const ULTIMA_MUDANCA = "2026-08-31";

function texto(corpo: string, tipo = "text/plain; charset=utf-8"): Response {
  return new Response(corpo, {
    status: 200,
    headers: { "Content-Type": tipo, "Cache-Control": "public, max-age=3600" },
  });
}

/**
 * `robots.txt` PRÓPRIO. Ele diz duas coisas que o injetado não dizia: que o
 * rastreamento é liberado, e onde está o sitemap. As rotas de máquina ficam
 * fora do índice — `/mcp` é JSON-RPC e as demais são sondas operacionais; não
 * são conteúdo e só sujariam o resultado de busca.
 */
export function robotsTxt(): string {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /mcp",
    "Disallow: /health",
    "Disallow: /status",
    "Disallow: /metrics",
    "",
    `Sitemap: ${SERVER_CONFIG.websiteUrl}/sitemap.xml`,
    "",
  ].join("\n");
}

export function sitemapXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SERVER_CONFIG.websiteUrl}/</loc>
    <lastmod>${ULTIMA_MUDANCA}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
}

/**
 * Responde as rotas de descoberta, ou `null` se o caminho não for uma delas.
 * Chamada ANTES da auth: um rastreador não tem credencial, e um `robots.txt`
 * atrás de Bearer é o mesmo que não ter robots.txt.
 */
export function discoveryResponseForPath(pathname: string): Response | null {
  if (pathname === "/robots.txt") return texto(robotsTxt());
  if (pathname === "/sitemap.xml") return texto(sitemapXml(), "application/xml; charset=utf-8");
  // O arquivo de chave do IndexNow: o conteúdo é a própria chave, e é assim que
  // o buscador confirma que quem avisou controla o domínio.
  if (pathname === `/${SERVER_CONFIG.indexNowKey}.txt`) return texto(SERVER_CONFIG.indexNowKey);
  return null;
}
