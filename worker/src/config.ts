/**
 * Identidade e tunáveis do Worker medical-terminologies-mcp — instância do
 * template de hosting da Fase 0 (mcp-br-commons/templates/cloudflare-worker).
 * Os demais módulos leem daqui.
 *
 * A versão vem do build do pacote pai (dist/worker-lib.js ← package.json), a
 * única fonte de verdade de versão do repo.
 */

import { SERVER_INFO } from "../../dist/worker-lib.js";

export const SERVER_CONFIG = {
  /** Nome curto do servidor (handshake MCP, /status, landing). */
  name: "medical-terminologies-mcp",
  /** Versão do servidor — única fonte: package.json do pacote pai. */
  version: SERVER_INFO.version,
  /** Título de exibição (landing page). */
  // Mesmo texto do `server.json` — o que o MCP Registry publica e os
  // diretórios copiam. Divergir faria handshake e ficha mostrarem nomes
  // diferentes do mesmo produto.
  title: "Medical Terminologies MCP",
  /** Uma frase: o que o servidor serve e de qual fonte (produto English-facing). */
  description:
    "Unified MCP server for seven medical terminologies — ICD-11, SNOMED CT, LOINC, " +
    "RxNorm, MeSH, ATC and the Brazilian CID-10 — with the authoritative WHO " +
    "ICD-10→ICD-11 mapping. Live data from WHO and NLM APIs.",
  /**
   * Contato exibido na landing page. A URL raiz do Worker é o que sysadmins
   * upstream veem — precisa resolver para identificação humana + contato.
   */
  contactEmail: "sbissoli76@gmail.com",
  /**
   * Site do servidor no handshake (`serverInfo.websiteUrl`). É o DOMÍNIO
   * PRÓPRIO, não o repositório: é o que o `server.json` declara.
   */
  websiteUrl: "https://medical.sidneybissoli.com",

  /**
   * Ícones do handshake. Declarados AQUI, e não importados de
   * `dist/worker-lib.js`, porque o bundle é JavaScript e o `allowJs` do
   * tsconfig infere `theme: string` — a união `"dark" | "light"` que o SDK
   * exige não sobrevive ao esbuild. A duplicação é deliberada e vigiada:
   * `tests/serverinfo-sync.test.ts` compara estes valores com o `server.json`.
   */
  icons: [
    {
      src: "https://raw.githubusercontent.com/SidneyBissoli/medical-terminologies-mcp/main/assets/icon-dark.png",
      mimeType: "image/png",
      sizes: ["512x512"],
      theme: "dark",
    },
    {
      src: "https://raw.githubusercontent.com/SidneyBissoli/medical-terminologies-mcp/main/assets/icon-light.png",
      mimeType: "image/png",
      sizes: ["512x512"],
      theme: "light",
    },
  ] as { src: string; mimeType: string; sizes: string[]; theme: "dark" | "light" }[],
  /** Rota do endpoint MCP (Streamable HTTP). */
  mcpRoute: "/mcp",
  /**
   * Hostnames aceitos no header Host. A lista SUBSTITUI os defaults do
   * createMcpHandler (localhost e *.workers.dev) — por isso inclui também o
   * hostname workers.dev legado e os de dev local, além do domínio próprio.
   */
  extraAllowedHostnames: [
    "medical.sidneybissoli.com",
    "medical-terminologies-mcp.sidneybissoli.workers.dev",
    "localhost",
    "127.0.0.1",
  ] as string[],
} as const;

/**
 * Rate limit de entrada por cliente (IP), aplicado às rotas não-públicas.
 * Token bucket em memória por isolate: proteção contra abuso acidental/burst,
 * não um limite global exato (recicla com o isolate; instâncias em POPs
 * distintos não somam). Para limite global rígido, mover a contagem para um
 * Durable Object.
 */
export const RATE_LIMIT = {
  /** Burst máximo por cliente. */
  clientBurst: 20,
  /** Reposição de tokens por segundo por cliente. */
  clientRefillPerSec: 5,
  /** Teto de buckets rastreados por isolate (evicção FIFO ao estourar). */
  maxClientBuckets: 1000,
} as const;

/**
 * Texto da LANDING PAGE — a única superfície própria do produto, e por isso a
 * única que responde por ele numa busca. Até 2026-08-31 a página tinha oito
 * linhas de corpo, sem `meta description`, sem og:, sem dado estruturado e sem
 * link para o repositório: não havia o que indexar.
 *
 * `lang` segue o PÚBLICO do produto, não a língua do código. O bloco
 * `emOutroIdioma` não é rodapé de cortesia: é seção com resumo e exemplos
 * próprios, porque é texto indexável.
 */
export const LANDING = {
  lang: "en" as "pt-BR" | "en",
  resumo:
    "MCP server for ICD-11, LOINC, RxNorm, MeSH, ATC and the Brazilian CID-10, with " +
    "the authoritative WHO ICD-10 to ICD-11 mapping. 31 tools, live from WHO and NLM.",
  exemplos: [
    "“What’s the ICD-11 code for type 2 diabetes?”",
    "“Map ICD-10 code E11 to ICD-11.”",
    "“What does LOINC 2339-0 measure?”",
  ] as readonly string[],
  destaques: [
    "One provenance block per source on every response — source, canonical URL, data vintage, real extraction instant and licence.",
    "Official translations only: pt-BR labels come from WHO and NLM themselves, never from machine translation.",
    "The Brazilian CID-10 (DataSUS V2008) ships bundled — no HTTP call, no rate limit.",
    "Batch-validate up to 100 codes across six terminologies in a single call.",
  ] as readonly string[],
  repoUrl: "https://github.com/SidneyBissoli/medical-terminologies-mcp",
  npmUrl: "https://www.npmjs.com/package/medical-terminologies-mcp",
  docsUrl:
    "https://github.com/SidneyBissoli/medical-terminologies-mcp/blob/main/docs/artigo-cid10-e-cid11-no-sus.pt-BR.md",
  emOutroIdioma: {
    lang: "pt-BR" as "pt-BR" | "en",
    resumo:
      "Em português: acesso programático à CID-10 do DataSUS (V2008, a que o SUS usa " +
      "operacionalmente), embutida e sem chamada de rede, mais os rótulos oficiais em " +
      "português da ICD-11 da OMS e do MeSH — nunca tradução de máquina.",
    exemplos: [
      "“Qual o código CID-10 para infarto agudo do miocárdio?”",
      "“Liste os 22 capítulos da CID-10.”",
    ] as readonly string[],
  },
} as const;
