/**
 * Landing page na raiz — pública. A URL raiz do Worker aparece no User-Agent
 * das chamadas upstream do portfólio, então precisa resolver para algo legível
 * por humanos: identificação do serviço + contato. Em inglês — o produto é
 * English-facing (padrão ilo/uis, não o pt-BR do ibge).
 */

import { SERVER_CONFIG } from "./config.js";

export function landingHtml(): string {
  const c = SERVER_CONFIG;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${c.title}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 42rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.6; }
  code { background: #eee; padding: 0.1rem 0.35rem; border-radius: 4px; }
  @media (prefers-color-scheme: dark) { body { background: #111; color: #ddd; } code { background: #333; } }
</style>
</head>
<body>
<h1>${c.title}</h1>
<p>${c.description}</p>
<p><a href="https://modelcontextprotocol.io">MCP</a> server (Streamable HTTP). Endpoints:</p>
<ul>
  <li><code>${c.mcpRoute}</code> — MCP endpoint</li>
  <li><code>/health</code> — liveness</li>
  <li><code>/status</code> — version and current build</li>
  <li><code>/metrics</code> — aggregated usage statistics (per tool, daily)</li>
  <li><code>/stats</code> — public tool-call counter (since 2026-05-13); <code>/stats/badge</code> for shields.io</li>
</ul>
<p>Source &amp; docs: <a href="${c.websiteUrl}">${c.websiteUrl}</a></p>
<p>Contact: <a href="mailto:${c.contactEmail}">${c.contactEmail}</a></p>
</body>
</html>`;
}

export function landingResponse(): Response {
  return new Response(landingHtml(), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
