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
  title: "medical-terminologies-mcp — medical terminologies via MCP",
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
  /** Repositório público (serverInfo.websiteUrl + landing). */
  websiteUrl: "https://github.com/SidneyBissoli/medical-terminologies-mcp",
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
