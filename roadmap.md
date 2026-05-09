# Plano de divulgação — medical-terminologies-mcp

> Documento operacional. Plano de 60 dias, custo zero, esforço-alvo
> 2-4 h/semana. Escrito em 2026-05-09 contra o estado real do
> repositório (v1.1.0, 27 tools, 21 default + 6 SNOMED-gated).
>
> Este documento é o roteiro; os textos prontos para copy-paste estão
> nos apêndices A e B. Drafts em inglês são idiomáticos, não traduzidos.

---

## Diagnóstico inicial

### O que o MCP faz hoje (lido do código, não inferido)

Servidor MCP que expõe **27 ferramentas distribuídas em 5 terminologias
médicas internacionais**. Por padrão, **21 ferramentas ficam ativas**;
as 6 dependentes de SNOMED CT são *gated* atrás de
`ENABLE_SNOMED_TOOLS=true` porque o endpoint público histórico da
IHTSDO (`browser.ihtsdotools.org`) foi desativado e retorna HTTP 410
desde 2026-05.

Inventário real, lido de `src/tools/`:

**ICD-11 (WHO) — 5 tools, requer OAuth gratuito da WHO:**
- `icd11_search` — busca textual por condição/sintoma
- `icd11_lookup` — detalhes de entidade por código ou URI
- `icd11_hierarchy` — pais/filhos na hierarquia (release 2024-01 default,
  configurável via `WHO_ICD11_RELEASE_ID`)
- `icd11_chapters` — listagem dos 28 capítulos
- `icd11_postcoordination` — eixos de pós-coordenação para códigos compostos

**LOINC (NLM Clinical Tables) — 4 tools, sem auth:**
- `loinc_search` — busca por exames laboratoriais e observações clínicas
- `loinc_details` — atributos completos (component, property, system, scale, method, class)
- `loinc_answers` — listas de respostas para itens de questionário
- `loinc_panels` — estrutura de painéis e formulários

**RxNorm (NLM) — 5 tools, sem auth:**
- `rxnorm_search` — busca por nome (com fallback de aproximação fonética)
- `rxnorm_concept` — detalhes do conceito por RxCUI, com `include_related` opcional
- `rxnorm_ingredients` — princípios ativos
- `rxnorm_classes` — classes terapêuticas/farmacológicas com fonte (ATC, EPC, MoA, etc.)
- `rxnorm_ndc` — mapeamento RxCUI ↔ NDC bidirecional

**MeSH (NLM Linked Data) — 4 tools, sem auth:**
- `mesh_search` — busca por descritores (`exact` | `contains` | `starts_with`)
- `mesh_descriptor` — detalhes completos: scope note, tree numbers, conceitos, qualifiers
- `mesh_tree` — localização hierárquica agrupada por categoria (A-N, V, Z)
- `mesh_qualifiers` — qualifiers permitidos com label populado (parallel lookup)

**SNOMED CT (Snowstorm) — 5 tools, gated, requer license IHTSDO + Snowstorm self-hosted:**
- `snomed_search`, `snomed_concept`, `snomed_hierarchy`,
  `snomed_descriptions`, `snomed_ecl` (queries em ECL)

**Crosswalk — 4 tools (3 default + 1 SNOMED-gated):**
- `map_icd10_to_icd11` — busca textual no índice ICD-11. **A descrição
  da tool é honesta sobre não ser mapeamento autoritativo** (aponta para
  WHO transition tables como fonte oficial).
- `map_loinc_to_snomed` — *guidance only*. Retorna detalhes do LOINC +
  orientação sobre UMLS, RELMA e LOINC SNOMED CT Expression Association
  (mapping real não é livre via API).
- `find_equivalent` — busca o mesmo termo em todas as 5 terminologias
  em paralelo, com `source_terminology` (excluir) e `target_terminologies`
  (limitar) funcionais.
- `map_snomed_to_icd10` — gated com SNOMED. Retorna guidance sobre
  refset 447562003.

### Diferenciais competitivos reais

Estes são pontos técnicos efetivamente presentes no código que
diferenciam o servidor de outros MCPs de saúde:

1. **5 terminologias unificadas em um único servidor.** A maior parte
   dos MCPs de saúde existentes cobre uma terminologia. Aqui
   `find_equivalent` permite uma só chamada para buscar o mesmo
   conceito em todas.
2. **`structuredContent` + `outputSchema` em 24 das 27 tools.** Pelo
   spec MCP de 2024-11-05, isso entrega objetos tipados ao lado do
   markdown, permitindo composição programática. Maioria dos MCPs
   ainda só retorna prosa.
3. **`annotations` declaradas (`readOnlyHint`, `idempotentHint`,
   `openWorldHint`, `destructiveHint: false`).** Permite que clientes
   MCP pulem confirmações e que LLMs invoquem com mais liberdade.
4. **Validação Zod com regex estrita.** LOINC `^\d{1,5}-\d$`, SCTID
   `^\d+$`, MeSH ID `^D\d+$`, RxCUI `^\d+$`, ICD-11 lookup com refine
   `code` ou `uri`. Erros de input retornam mensagem acionável, não
   404 genérico da API upstream.
5. **OAuth2 client_credentials da WHO com cache real de
   `expires_in`** (-60s margem), não TTL fixo.
6. **Token-bucket rate limiter por API** (WHO 5/s, NLM 10/s, RxNorm
   20/s), retry com backoff exponencial + jitter de ±25%, distinção
   entre erros de rede e HTTP retryáveis.
7. **128 testes Vitest cobrindo schemas e utils.** CI em PR e push,
   matriz Node 20 e 22, Dependabot configurado.
8. **Disclaimer SNOMED automático em todas as outputs** quando as
   tools estão habilitadas — postura correta dada a licença IHTSDO.
9. **Honestidade nas crosswalk tools.** A descrição de
   `map_icd10_to_icd11` declara que é busca textual, não mapeamento.
   `map_loinc_to_snomed` declara explicitamente que não faz o mapping.
   Isso é raro e tecnicamente correto.

### Lacunas que comprometem a divulgação (sem suavizar)

São fraquezas reais. Algumas são *blockers* específicos de canal de
distribuição.

1. **Sem Streamable HTTP transport.** O servidor só fala stdio. Isso
   **bloqueia Smithery.ai, Cloudflare Workers, LobeHub, MCP hosted
   directories**. Conforme `improvements.md`, o projeto irmão `bcb-br-mcp`
   tem ~501 dl/mês com distribuição multi-canal vs. ~160 dl/mês deste
   pacote em npm-only — diferença que provavelmente reflete canal mais
   que qualidade. **O item de maior alavancagem do roadmap inteiro é
   este, e ele exige ~3-4 h de trabalho técnico antes da divulgação
   começar a ter teto alto.** Phase 1 abaixo trata isso explicitamente.

2. **README sem demo visual.** Nenhum GIF, screenshot, output de
   exemplo. A página do npm é o canal principal de descoberta e hoje é
   só texto descritivo. Para um pacote que tem outputs ricos
   (tabelas markdown, listas hierárquicas), isso é desperdício.

3. **WHO ICD-11 exige credenciais de OAuth (gratuitas).** Não é
   barreira séria (5 min em https://icd.who.int/icdapi), mas o
   "primeiro contato impressivo" (busca de doença) fica atrás de um
   passo de cadastro. **As demos do post longo devem priorizar as 13
   tools zero-config (LOINC + RxNorm + MeSH) antes de mostrar ICD-11.**

4. **`server.json` declara version `1.0.2`, mas `package.json` está em
   `1.1.0`.** Bug real, descoberto agora. O MCP Registry mostra a
   versão antiga. Corrigir antes da divulgação. Também o `server.json`
   não declara `WHO_ICD11_RELEASE_ID`, `ENABLE_SNOMED_TOOLS`,
   `SNOMED_BASE_URL`, `SNOMED_LANGUAGE`, `LOG_LEVEL` — todas as env
   vars opcionais introduzidas em 1.1.0.

5. **Nenhum exemplo de output real no README.** Só descrição das tools.
   Adicionar 2-3 outputs reais (tabela de busca LOINC, tabela de
   ingredientes RxNorm, hierarquia ICD-11) tem retorno
   desproporcionalmente alto pelo esforço (15 min).

6. **Sem hosted demo.** Sem `claude-mcp-demo.com/medical-terminologies`
   ou similar. Para conversão "li o post → quero testar", o usuário
   tem que: instalar Node, npm install global, configurar Claude Desktop,
   obter credenciais WHO. Atrito real.

7. **Sem video de 30s mostrando o servidor em uso.** YouTube/Loom é
   barato e converte. Não fazer não é blocker, mas é dinheiro na mesa.

### Métrica baseline

| Métrica | Estado em 2026-05-09 |
|---------|----------------------|
| npm downloads/mês | ~160 (orgânico, sem divulgação) |
| GitHub stars | A verificar antes de começar |
| Glama.ai | Não listado |
| Smithery.ai | Não listado (e bloqueado por falta de HTTP transport) |
| mcpservers.org | Não listado |
| MCP Registry oficial | Listado em 1.0.2 (desatualizado) |
| awesome-mcp-servers | Não listado |
| Issues no GitHub | A verificar |
| Forks | A verificar |

**Antes de começar Phase 1, registrar o baseline exato em
`metrics-baseline.txt` para comparação em 60 dias.**

---

## Fase 1 — Quick wins (semana 1)

Ordem importa: as duas primeiras ações destravam tudo o que vem depois.

### 1.1 — Sincronizar `server.json` com `package.json` 1.1.0

- **O que:** atualizar `version` no `server.json` para `1.1.0`,
  adicionar as env vars opcionais (`WHO_ICD11_RELEASE_ID`,
  `ENABLE_SNOMED_TOOLS`, `SNOMED_BASE_URL`, `SNOMED_LANGUAGE`,
  `LOG_LEVEL`), republicar no MCP Registry com `mcp-publisher publish`.
- **Onde executar:** localmente, depois `git push` + workflow de release.
- **Esforço:** ~30 min.
- **Pré-requisitos:** acesso ao token de publicação no MCP Registry
  (já existe, está em `.mcpregistry_*_token` gitignored).
- **Sucesso:** página do MCP Registry mostra 1.1.0 e as env vars novas;
  `npx mcp-publisher get io.github.SidneyBissoli/medical-terminologies-mcp`
  retorna 1.1.0.
- **Por que primeiro:** todas as ações de divulgação apontam para
  páginas que devem refletir o estado atual. Submeter Glama com link
  para um Registry desatualizado prejudica credibilidade.

### 1.2 — Adicionar Streamable HTTP transport

- **O que:** instanciar `StreamableHTTPServerTransport` do
  `@modelcontextprotocol/sdk` como segundo modo, ativado por flag CLI
  (`--http --port 3000`). Default continua stdio. Adicionar
  `transport: { type: "streamable-http" }` ao `server.json` como
  pacote alternativo.
- **Onde executar:** localmente; novo arquivo `src/transports/http.ts`,
  modificações em `src/index.ts`.
- **Esforço:** ~3-4 h. Inclui teste com MCP Inspector via `--transport
  streamable-http`.
- **Pré-requisitos:** nenhum.
- **Sucesso:** `node dist/index.js --http --port 3000` sobe o servidor;
  Inspector conecta via HTTP; CHANGELOG atualizado para 1.2.0.
- **Por que aqui:** **isto é o que destrava Smithery, Cloudflare Workers,
  e a maioria dos hosted MCP catalogs em fases seguintes.** Sem isso,
  o teto de adoção fica em ~500 dl/mês (o caso `bcb-br-mcp`). Tratar
  como pré-requisito de divulgação, não como sprint técnico separado.
- **Nota de sequenciamento:** a Phase 2 (conteúdo) e a Phase 3
  (comunidade) podem rodar em paralelo a partir da semana 2 sem
  esperar Smithery — mas o post longo deve mencionar "also available
  via HTTP transport for hosted use" depois que 1.2 estiver lançado.

### 1.3 — Polir o README com 3 exemplos de output real

- **O que:** abaixo da seção "Available Tools", adicionar uma seção
  "Sample outputs" com 3 blocos: (a) busca LOINC para "procalcitonin"
  mostrando a tabela de resultados; (b) ingredientes do Janumet via
  RxNorm; (c) descritor MeSH para "Primary Health Care" com tree
  numbers. Outputs reais, copiados do MCP Inspector.
- **Onde executar:** localmente, edição de `README.md`.
- **Esforço:** ~30-45 min (incluindo rodar o servidor para colher os
  outputs).
- **Sucesso:** páginas de npm e GitHub mostram outputs reais, não só
  descrição. Verificar visualmente em
  https://www.npmjs.com/package/medical-terminologies-mcp após publish.

### 1.4 — Submeter ao Glama.ai

- **O que:** criar conta em https://glama.ai (se ainda não tiver) e
  submeter o servidor.
- **Onde executar:** https://glama.ai/mcp/servers/add (URL pode ser
  ligeiramente diferente — a navegação a partir da home leva ao formulário
  certo).
- **Esforço:** ~20 min.
- **Pré-requisitos:** conta Glama (Sidney já tem, conforme uso anterior
  com `ibge-br-mcp`); descrição pronta (Apêndice A.2).
- **Sucesso:** servidor aparece em https://glama.ai/mcp/servers com
  badge "Author verified" — replica padrão alcançado em `ibge-br-mcp`.
- **Por que aqui:** Glama indexa rapidamente e tem tráfego direto de
  desenvolvedores procurando MCPs.

### 1.5 — Submeter ao mcpservers.org

- **O que:** criar PR no repositório `mcpservers.org` ou usar formulário
  de submissão se houver.
- **Onde executar:** https://mcpservers.org (verificar formulário/PR
  flow atual).
- **Esforço:** ~20-30 min.
- **Pré-requisitos:** descrição pronta (Apêndice A.3).
- **Sucesso:** servidor listado na categoria Healthcare/Medical.

### 1.6 — PR no awesome-mcp-servers

- **O que:** abrir PR no `https://github.com/punkpeye/awesome-mcp-servers`
  (lista mais ativa) e também em `https://github.com/wong2/awesome-mcp-servers`
  (lista alternativa, mantida).
- **Onde executar:** GitHub fork → branch → PR.
- **Esforço:** ~20 min para o primeiro PR, +10 min para o segundo.
- **Pré-requisitos:** texto do PR pronto (Apêndice A.1).
- **Sucesso:** PR mergeado em pelo menos uma das duas listas.

### Resumo de Phase 1

| # | Ação | Esforço | Dependência |
|---|------|---------|-------------|
| 1.1 | Sync server.json → 1.1.0 | 30 min | Nenhuma |
| 1.2 | Streamable HTTP transport | 3-4 h | Nenhuma (pode rodar em paralelo a 1.1) |
| 1.3 | README com sample outputs | 30-45 min | Nenhuma |
| 1.4 | Submeter Glama.ai | 20 min | 1.1 + 1.3 |
| 1.5 | Submeter mcpservers.org | 20-30 min | 1.1 + 1.3 |
| 1.6 | PR awesome-mcp-servers | 20-30 min | 1.1 + 1.3 |

**Total Phase 1: 5h45min - 7h. Cabe em uma semana de 4h se 1.2 for
adiado para a semana 2.** Recomendado: fazer 1.1, 1.3 e PRs/submissões
na semana 1; 1.2 (HTTP transport) na semana 2 antes do post longo.

---

## Fase 2 — Conteúdo (semanas 2-3)

Três peças: **post longo (Medium/Dev.to)**, **post LinkedIn**, **posts
curtos para Reddit + Mastodon**. Mesmo conteúdo central — três casos
de uso clínicos reais — adaptado por plataforma.

### 2.1 — Post longo para Medium e Dev.to

**Título proposto:** *Five medical terminologies, one MCP server: a
practical walkthrough for clinical and research use*

**Plataforma alvo:** Medium (audiência geral em saúde digital) e
Dev.to (audiência técnica). Mesmo texto; em Medium adicionar imagem
de capa (pode ser screenshot do Inspector mostrando a list of tools);
em Dev.to usar tags `#mcp #healthcare #ai #typescript`.

**Hashtags Medium:** `Medical Coding`, `Health Informatics`, `MCP`,
`Claude AI`, `Open Source`.

**Tags Dev.to:** `mcp`, `healthcare`, `ai`, `typescript`, `opensource`.

**DRAFT COMPLETO** — copy-paste pronto:

---

# Five medical terminologies, one MCP server: a practical walkthrough for clinical and research use

If you've ever asked an LLM to "find the LOINC code for procalcitonin" or "list the active ingredients in Janumet," you've probably watched it confidently invent a code that doesn't exist. Medical terminologies are exactly the kind of structured, frequently-updated reference data that language models are bad at memorizing and good at *looking up* — if you give them the right tool.

`medical-terminologies-mcp` is a Model Context Protocol server that gives any MCP-compatible client (Claude Desktop, Claude Code, Continue, and others) unified access to five major international medical terminologies:

- **ICD-11** (WHO International Classification of Diseases, 11th Revision)
- **LOINC** (Logical Observation Identifiers Names and Codes)
- **RxNorm** (NIH normalized clinical drug names)
- **MeSH** (NLM Medical Subject Headings)
- **SNOMED CT** (Systematized Nomenclature of Medicine, optional, license required)

Twenty-one tools work out of the box with no authentication for LOINC, RxNorm, and MeSH. ICD-11 needs free WHO API credentials (a five-minute signup). SNOMED is gated behind an explicit feature flag and requires an IHTSDO license plus a self-hosted Snowstorm instance — more on why below.

This post walks through three concrete clinical and research workflows where the server earns its place in the toolbelt.

## Setup in 60 seconds

```json
{
  "mcpServers": {
    "medical-terminologies": {
      "command": "npx",
      "args": ["-y", "medical-terminologies-mcp"],
      "env": {
        "WHO_CLIENT_ID": "your-who-id",
        "WHO_CLIENT_SECRET": "your-who-secret"
      }
    }
  }
}
```

Drop that into your Claude Desktop config (`%APPDATA%\Claude\claude_desktop_config.json` on Windows, `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS), restart Claude, and 21 tools appear. WHO credentials are optional — without them the 5 ICD-11 tools throw a clear configuration error and the other 16 work fine.

## Use case 1: sepsis triage — finding the right LOINC for procalcitonin

A clinical scenario. An ED resident is documenting a sepsis workup and needs the LOINC code for serum procalcitonin to attach to the lab order in the EMR. They could open loinc.org, run a search, scroll through results, and copy the code. Or they could ask their LLM-powered scribe.

```
You: What's the LOINC code for procalcitonin in serum?

Claude (calling loinc_search):
## LOINC Search Results for "procalcitonin"
Found 23 total results (showing 10):

1. **33959-8** - Procalcitonin [Mass/volume] in Serum or Plasma
   Component: Procalcitonin | Property: MCnc | Timing: Pt | System: Ser/Plas
   Class: CHEM | Status: ACTIVE
2. **75241-0** - Procalcitonin [Mass/volume] in Body fluid
...
```

The LLM picks `33959-8` and proposes it. The clinician confirms or asks for details:

```
You: Give me the full LOINC details for 33959-8.

Claude (calling loinc_details):
# 33959-8 - Procalcitonin [Mass/volume] in Serum or Plasma

| Attribute | Value |
|-----------|-------|
| Component | Procalcitonin |
| Property  | MCnc |
| Timing    | Pt |
| System    | Ser/Plas |
| Scale Type| Qn |
| Method    | (none) |
| Class     | CHEM |
| Status    | ACTIVE |
```

What this replaces in practice: a 30-second context switch from EMR to a browser tab, every time a clinician needs to pin down a specific code. Multiplied across the day, across a team, that's real time.

The same workflow applies to any biomarker, vital sign, or observation: lactate (`2524-7`), troponin I high-sensitivity (`67151-1`), SpO₂ (`59408-5`). The tool is `loinc_search` for the discovery step, `loinc_details` for the verification step. Both are deterministic API calls against NLM Clinical Tables — the LLM doesn't memorize codes, it looks them up.

## Use case 2: medication reconciliation — breaking down a combination product

A scenario familiar to any inpatient pharmacist or hospitalist: a patient is admitted on Janumet (a brand combo of sitagliptin and metformin), and the team needs to reconcile this against the formulary, check for class-level interactions, and document the active ingredients separately.

```
You: I need to break down Janumet for the admission med rec.
What are the active ingredients and their drug classes?

Claude (calling rxnorm_search, then rxnorm_ingredients, then rxnorm_classes):

Step 1 — search for Janumet:
**860975** - Janumet (sitagliptin 50 MG / metformin hydrochloride 500 MG Oral Tablet)
   Type: SBD | Synonym: sitagliptin/metformin

Step 2 — get the ingredients:
| RxCUI | Name | Type |
|-------|------|------|
| 593411 | sitagliptin | Single Ingredient |
| 6809 | metformin | Single Ingredient |

Step 3 — get classes for each ingredient:
For sitagliptin (593411):
- Dipeptidyl-Peptidase IV Inhibitors (ATC: A10BH)
- Hypoglycemic Agents (MeSH PA: D007004)

For metformin (6809):
- Biguanides (ATC: A10BA)
- Hypoglycemic Agents (MeSH PA: D007004)
```

Three tool calls, structured data, no hallucination risk. The LLM can compose this into a med rec note, flag that both ingredients hit the same MeSH pharmacological action class (hypoglycemic agents — relevant for redundancy review), and surface the ATC codes for any pharmacy system that uses ATC.

What this enables that bare LLMs don't: the chain `brand → ingredients → classes` is a graph traversal across a real database. The model isn't recalling that sitagliptin is a DPP-4 inhibitor; it's *looking it up* in the same source the FDA uses.

## Use case 3: evidence synthesis — building a precise PubMed search with MeSH

A scenario for a researcher running a systematic review on the impact of primary health care interventions on avoidable hospitalizations. The quality of a literature search hinges on hitting the right MeSH descriptors and qualifiers — not on free-text keyword guesswork.

```
You: I'm building a search strategy for a systematic review on
primary health care and avoidable hospitalizations. Help me find
the right MeSH descriptors and applicable qualifiers.

Claude (calling mesh_search):
| MeSH ID | Label |
|---------|-------|
| D011320 | Primary Health Care |
| D006297 | Health Services Accessibility |
| D004472 | Hospitalization |
| D006308 | Health Services Misuse |

You: Get me the tree position and allowed qualifiers for Primary Health Care.

Claude (calling mesh_tree, then mesh_qualifiers):
# Tree Numbers for D011320

### Health Care
- `N04.590.233.727`
- `N02.421.143.827`

# Allowed Qualifiers for D011320

| Qualifier ID | Label |
|--------------|-------|
| Q000208 | ethics |
| Q000379 | methods |
| Q000523 | organization & administration |
| Q000592 | standards |
| Q000656 | trends |
| Q000706 | statistics & numerical data |
| Q000941 | utilization |

*Use qualifiers with descriptors like: "Primary Health Care/utilization"*
```

That last detail — the seven allowed qualifiers, with `/utilization` and `/statistics & numerical data` highlighted — is exactly what a precise PubMed search needs. The model now has enough to draft `("Primary Health Care/utilization"[MeSH] OR "Primary Health Care/statistics & numerical data"[MeSH]) AND "Hospitalization/prevention and control"[MeSH]` and explain why each leg matters.

The use case generalizes: any research informatics workflow that needs controlled vocabulary mapping (PubMed, Cochrane, OVID) benefits from `mesh_search` + `mesh_qualifiers` + `mesh_tree`. For systematic reviews specifically, the qualifier list is the part that's hardest to remember and easiest to get wrong.

## What the server doesn't claim to do

A few things worth being explicit about, because the README is honest about them and the LLM should be too:

- **`map_icd10_to_icd11` is a text search**, not an authoritative ICD-10 → ICD-11 mapping. For clinical coding or billing migration, the WHO transition tables at https://icd.who.int/browse11/Downloads/Download are the source of truth.
- **`map_loinc_to_snomed` returns guidance**, not a mapping. Direct LOINC ↔ SNOMED CT mappings live in UMLS Metathesaurus (license required) or the LOINC SNOMED CT Expression Association files (LOINC license required).
- **SNOMED tools are off by default** because the historical public IHTSDO Snowstorm endpoint was retired (HTTP 410 Gone). Operators with an IHTSDO license and a self-hosted Snowstorm instance flip them on with `ENABLE_SNOMED_TOOLS=true SNOMED_BASE_URL=...`.
- **None of this is a substitute for clinical judgment.** It's a lookup layer for already-known codes, not a diagnostic tool.

## Under the hood, briefly

For developers curious about the engineering: the server is TypeScript on Node 20+, bundled with esbuild, built around a token-bucket rate limiter (5 req/s for WHO, 10 req/s for NLM, 20 req/s for RxNorm) and exponential-backoff retry with ±25% jitter. WHO OAuth tokens are cached using the actual `expires_in` from the API response, not a hardcoded TTL. Twenty-four of twenty-seven tools declare `outputSchema` and return `structuredContent` alongside markdown — so MCP clients that consume structured data get typed objects, not parsed prose. The 128-test Vitest suite gates CI on PR.

It's MIT licensed. The medical terminology content has its own licenses, all linked in the README.

## Try it

- **npm:** https://www.npmjs.com/package/medical-terminologies-mcp
- **GitHub:** https://github.com/SidneyBissoli/medical-terminologies-mcp
- **MCP Registry:** `io.github.SidneyBissoli/medical-terminologies-mcp`

WHO API credentials (free): https://icd.who.int/icdapi.

Issues, PRs, and use-case reports welcome — especially from clinical informatics teams using LLMs in real EMR workflows. There's a real gap between "LLM as scribe" and "LLM with reliable terminology access," and closing it is what this server is for.

---

**End of long-form draft.**

#### Notas de adaptação por plataforma

- **Medium:** adicionar imagem de capa (sugestão: screenshot do MCP
  Inspector mostrando os 21 tools listados, ou um diagrama simples
  das 5 terminologias). Tags: `Medical Coding`, `Health Informatics`,
  `MCP`, `Claude AI`, `Open Source`. Reading time esperado: ~7 min.
- **Dev.to:** publicar com tags `mcp`, `healthcare`, `ai`, `typescript`,
  `opensource`. Adicionar canonical URL apontando para o Medium se
  publicado lá primeiro (ou vice-versa). Dev.to renderiza os blocos
  de código com syntax highlight automático.
- **GitHub Discussions:** crossposting do mesmo texto em
  https://github.com/SidneyBissoli/medical-terminologies-mcp/discussions
  na categoria "Show and tell" — funciona como permanent link e ajuda
  no SEO da página do repo.

### 2.2 — Post LinkedIn (versão profissional, ~700 palavras)

**Plataforma alvo:** LinkedIn personal feed.

**DRAFT COMPLETO** — copy-paste pronto:

---

If you've watched an LLM confidently invent a LOINC or ICD-11 code that doesn't exist, you know the gap I'm trying to close.

Over the past months I've been building `medical-terminologies-mcp`, an open-source Model Context Protocol server that gives Claude (and any other MCP-compatible client) unified access to five major international medical terminologies:

→ ICD-11 (WHO)
→ LOINC (NLM)
→ RxNorm (NIH)
→ MeSH (NLM)
→ SNOMED CT (optional, license-gated)

21 tools work out of the box. The model doesn't memorize codes — it looks them up against the same APIs the WHO and NLM publish for everyone else.

Three concrete examples of what changes when an LLM has reliable terminology access:

🩺 ED triage. A resident asks "what's the LOINC for procalcitonin in serum?" and gets `33959-8` with full attributes (component, property, system, scale, method) — verified against NLM, not invented. Same workflow for any lab, vital sign, or observation.

💊 Medication reconciliation. Janumet → break it down into sitagliptin (RxCUI 593411) and metformin (RxCUI 6809), get the drug classes for each (DPP-4 inhibitor, biguanide), surface ATC codes for the pharmacy system. Three tool calls, zero hallucination.

📚 Systematic reviews. "Primary Health Care" → MeSH D011320, tree position N02.421.143.827, allowed qualifiers including /utilization and /statistics & numerical data. The qualifier list is exactly what makes a precise PubMed search precise.

What's deliberately not in scope:

❌ Authoritative ICD-10 → ICD-11 mapping (the tool is text search; for coding/billing use the WHO transition tables)
❌ LOINC ↔ SNOMED mapping (requires UMLS or LOINC Expression Association files — neither is freely accessible via API)
❌ Clinical decision-making (this is a lookup layer, not a diagnostic tool)

The server is honest about each of these in its tool descriptions. I'd rather it return "this tool does text search, not curated mapping; consult the official transition tables" than pretend to do something it doesn't.

For the engineering-minded: TypeScript on Node 20+, OAuth2 with proper expires_in handling, token-bucket rate limiting (5/10/20 req/s per API), exponential backoff with jitter, structuredContent on 24 of 27 tools, 128-test Vitest suite gating CI. MIT licensed.

If you work in clinical informatics, EMR integration, or health-tech and you're experimenting with LLM agents, I'd genuinely value your feedback — especially on what's missing for the workflows you actually run.

🔗 npm: https://www.npmjs.com/package/medical-terminologies-mcp
🔗 GitHub: https://github.com/SidneyBissoli/medical-terminologies-mcp

#HealthInformatics #ClinicalInformatics #MedicalCoding #LLM #ModelContextProtocol #OpenSource #DigitalHealth #ClaudeAI

---

**End of LinkedIn draft.**

#### Notas de adaptação LinkedIn

- Quebra de parágrafos curta (LinkedIn corta posts com >3 linhas
  contínuas no preview).
- Emojis de bullet, não markdown — LinkedIn não renderiza markdown.
- Hashtags no fim, agrupadas. Misturar específicas (HealthInformatics,
  ClinicalInformatics) com mais amplas (LLM, OpenSource).
- Não incluir "Read more" ou cliffhanger artificial — LinkedIn já
  trunca naturalmente; texto deve ler bem nos primeiros 3 parágrafos.

### 2.3 — Posts curtos para Reddit (3 versões)

**ATENÇÃO:** ler obrigatoriamente o **Apêndice B** antes de postar em
qualquer subreddit. r/medicine tem regras estritas contra
self-promotion; o título e o framing precisam ser cuidadosos.

#### 2.3.a — r/medicalcoding

**Título:** *Open-source MCP server for ICD-11, LOINC, RxNorm, MeSH lookup from LLMs*

**Flair:** "Resources" ou "Tools" (verificar disponíveis).

**Body:**

> I built a small MCP (Model Context Protocol) server that lets LLMs
> like Claude do reliable lookups against ICD-11, LOINC, RxNorm, MeSH,
> and optionally SNOMED CT. It's not a diagnostic or coding-suggestion
> tool — it's a lookup layer that calls the actual NLM and WHO APIs so
> the model stops inventing codes.
>
> Specifically useful if you're experimenting with LLM-assisted chart
> review or trying to keep your team's documentation grounded in real
> codes. 21 tools work without any authentication; ICD-11 needs free
> WHO API credentials.
>
> A few things it deliberately doesn't do:
> - No authoritative ICD-10 → ICD-11 mapping (it's text search; the
>   WHO transition tables are the real source).
> - No LOINC ↔ SNOMED mapping (UMLS or LOINC Expression Association
>   files; neither is freely API-accessible).
> - No SNOMED browser by default — public IHTSDO Snowstorm endpoint
>   was retired; tools gated behind a flag for self-hosted instances.
>
> MIT licensed, npm: https://www.npmjs.com/package/medical-terminologies-mcp
>
> Genuinely interested in feedback from people doing real coding work —
> what's missing? What would make it actually useful in your workflow?

#### 2.3.b — r/medicine

**ATENÇÃO ESPECIAL:** r/medicine tem rule contra self-promotion. Esta
versão é mais cautelosa, framing-first. Postar APENAS se houver flair
"Resource" ou "Other" disponível, e estar pronto para o post ser
removido. Considerar perguntar antes via modmail.

**Título:** *Has anyone tried using MCP servers to ground LLM outputs in real medical terminology APIs?*

**Body:**

> Genuine question, not a sales pitch. There's an emerging pattern in
> the LLM space called Model Context Protocol — a standard way to
> connect language models to external data sources, kind of like a
> universal plugin interface. For medical use, it's interesting because
> it could (in principle) make LLMs much more reliable for terminology
> lookup: instead of the model guessing what the LOINC code for
> procalcitonin is, it makes a real API call to NLM Clinical Tables
> and gets back a verified code.
>
> I built one such server (links below — happy to take it down if this
> crosses self-promotion lines, just let me know) wrapping ICD-11,
> LOINC, RxNorm, MeSH. The interesting question for me is: is this
> actually useful for any of you running LLMs alongside clinical work,
> or is the bottleneck somewhere else entirely (regulatory, EMR
> integration, trust)?
>
> What would actually make this useful in your day-to-day, if anything?
>
> https://github.com/SidneyBissoli/medical-terminologies-mcp

**Flair sugerida:** "Resources" or "Other"; **NÃO** usar flairs
clínicos. Se removido, não recriar.

#### 2.3.c — r/healthIT

**Título:** *Open-source MCP server: unified API access to ICD-11, LOINC, RxNorm, MeSH for LLM agents*

**Flair:** "Open Source" se disponível, senão "Discussion".

**Body:**

> Sharing a project that might be useful if your team is exploring
> LLM agents for clinical or research workflows.
>
> `medical-terminologies-mcp` is a Model Context Protocol server that
> exposes 21 default tools (27 with optional SNOMED) for terminology
> lookup. Built on the standard MCP spec, so it works with Claude
> Desktop, Claude Code, Continue, and other MCP-compatible clients —
> drop in a config snippet, restart the client, the tools appear.
>
> What it does well:
> - Real API calls (no LLM-invented codes)
> - structuredContent + outputSchema on 24/27 tools (typed objects,
>   not just markdown)
> - Token-bucket rate limiting per upstream API
> - WHO OAuth2 with actual expires_in handling
> - 128-test Vitest suite gating CI
>
> What it doesn't do (deliberately):
> - No authoritative cross-terminology mapping (LOINC↔SNOMED needs
>   UMLS license; ICD-10→ICD-11 needs WHO transition tables)
> - No clinical decision support — it's a lookup layer
> - SNOMED gated by default (public IHTSDO endpoint retired; needs
>   self-hosted Snowstorm + IHTSDO license)
>
> MIT, free, no telemetry. Feedback specifically welcome from anyone
> running LLMs alongside production EMR workflows.
>
> https://www.npmjs.com/package/medical-terminologies-mcp
> https://github.com/SidneyBissoli/medical-terminologies-mcp

#### Variantes adicionais para considerar

- **r/HealthInformatics** — texto idêntico ao de r/healthIT funciona;
  comunidade menor mas mais focada.
- **r/Bioinformatics** — só se conseguir framing específico em MeSH +
  pesquisa em literatura científica; não fazer sem ângulo claro.

### 2.4 — Posts Mastodon / Bluesky (3 variantes ≤500 chars)

**Variante A — focado em uso clínico:**

> New: medical-terminologies-mcp — open-source MCP server giving LLMs
> reliable lookup access to ICD-11, LOINC, RxNorm, MeSH, optionally
> SNOMED CT. 21 tools out of the box, no auth needed for LOINC/RxNorm/
> MeSH. The model stops inventing codes and starts looking them up.
>
> https://github.com/SidneyBissoli/medical-terminologies-mcp
>
> #healthinformatics #medicalcoding #mcp #opensource

**Variante B — focado em pesquisa:**

> If you're using LLMs for systematic reviews and tired of made-up
> MeSH terms: medical-terminologies-mcp lets the model do real lookups
> against NLM, get tree numbers, allowed qualifiers, the whole graph.
> Open source, MIT.
>
> https://www.npmjs.com/package/medical-terminologies-mcp
>
> #systematicreview #pubmed #ai4health

**Variante C — focado em devs:**

> Built an MCP server for medical terminologies (ICD-11, LOINC, RxNorm,
> MeSH, SNOMED). TypeScript, Vitest, structuredContent on 24/27 tools,
> token-bucket rate limiting, OAuth handled properly. MIT.
>
> Drop into Claude Desktop, get 21 tools.
>
> https://github.com/SidneyBissoli/medical-terminologies-mcp
>
> #mcp #typescript #healthtech

**Instâncias recomendadas:**
- `academic.social` — perfil acadêmico, audiência de pesquisa
- `fediscience.org` — ciência em geral
- `mastodon.social` — alcance amplo
- (opcional) `infosec.exchange` — variante C funciona aqui pelo ângulo de engenharia

**Crossposting Bluesky:** mesmo conteúdo, mesmas hashtags. Bluesky tem
limite de 300 chars; Variante A precisa cortar — versão Bluesky:

> medical-terminologies-mcp: open-source MCP server giving LLMs
> reliable lookup access to ICD-11, LOINC, RxNorm, MeSH, optionally
> SNOMED. 21 tools, MIT.
>
> github.com/SidneyBissoli/medical-terminologies-mcp
>
> #healthinformatics #mcp #opensource

---

## Fase 3 — Comunidade (semanas 4-6)

Engajamento direto, de menor escala mas com retorno por lead alto.

### 3.1 — Show HN

**Quando:** terça ou quarta-feira, 8-9h EST (manhã US, fim de manhã EU,
fim de tarde BR). Evitar segunda (fim de semana acumulado), sexta
(weekend dump), e qualquer feriado US.

**Título:** *Show HN: Medical-Terminologies-MCP – ICD-11, LOINC, RxNorm, MeSH lookup for LLMs*

**Body:** versão *enxuta* do post longo (200-300 palavras). Ver
Apêndice A.6 para o draft.

**Esforço:** ~30 min para postar; +2-3h disponível para responder
comentários nas primeiras horas (crítico para HN).

**Sucesso:** front page de `Show HN`. Mesmo se ficar só na
`/show` page, costuma trazer 50-200 visitas qualificadas.

**Risco:** HN é cruel com qualquer cheiro de marketing. O título e o
body devem ser técnicos e diretos. Não usar emojis, hashtags, ou
linguagem promocional.

### 3.2 — chat.fhir.org (HL7 community)

**Plataforma:** https://chat.fhir.org (Zulip do HL7).

**Canal:** `#conversations` ou um canal específico de tooling
(`#tooling`, `#implementers` — verificar).

**ATENÇÃO:** chat.fhir.org é uma comunidade de practitioners trabalhando
em implementação FHIR, não um fórum de produto. **NÃO postar
proativamente "olha o que eu fiz".** O canal correto:

- Aguardar uma thread onde alguém pergunta sobre terminology lookup
  ou LLM integration com FHIR.
- Responder com contexto: "I built a small MCP server for terminology
  lookup that might be relevant — handles ICD-11, LOINC, RxNorm, MeSH.
  Not FHIR-native, but the tools are addressable from LLM agents that
  also speak FHIR. Link if useful."
- Se alguém pergunta diretamente, expandir.

**Esforço:** monitorar 15 min/dia por 2 semanas; responder quando
contexto bater.

**Sucesso:** 1-2 menções orgânicas no chat geram tráfego qualificado
para o repo.

### 3.3 — AMIA / Healthcare Informatics LinkedIn groups

**Onde:**
- AMIA Working Groups públicos no LinkedIn (Clinical Informatics,
  Public Health Informatics).
- Grupo "Healthcare Informatics" (LinkedIn).
- Grupo "Health Information Technology Professionals" (LinkedIn).

**O que postar:** o draft LinkedIn (seção 2.2) republicado nos grupos
relevantes. **Sem alterar o texto.** Grupo de LinkedIn aceita
crosspost da própria timeline pessoal, e isso é menos invasivo do que
postar conteúdo separado.

**Esforço:** ~30 min total para 3-4 grupos.

### 3.4 — Email para early adopters identificáveis

**Quem:**

1. **Residentes em Clinical Informatics fellowships** (MIT, Stanford,
   Vanderbilt, Columbia, OHSU, Utah, Pittsburgh, UTHealth).
   Identificáveis pelo programa fellow listing público de cada
   instituição. Email institucional disponível.

2. **Devs que publicaram MCP servers de saúde no GitHub.** Buscar em
   GitHub: `topic:mcp-server health` ou `topic:mcp medical`. Olhar
   issues/READMEs e contatar autores de projetos correlatos para
   trocar feedback (não para spam — para genuine peer exchange).

3. **Autores de blog posts sobre LLM em saúde digital** (Hacker News,
   Towards Data Science, Substack de health-tech). Identificar 5-10
   pessoas com posts recentes (últimos 3 meses) sobre o tema.

**Template de email:** Apêndice A.5.

**Esforço:** ~15 min por email após customização. Meta: 10 emails em
3 semanas.

**Sucesso:** 2-3 respostas qualificadas (feedback real, issue/PR no
GitHub, citação em algum lugar).

**Risco:** ler como spam é fatal. Cada email precisa de uma frase de
abertura específica àquela pessoa (post recente, projeto correlato,
artigo) — sem isso, não enviar.

### 3.5 — Discord de comunidades MCP

**Onde:**
- Anthropic Discord oficial (canal MCP)
- MCP Community Discord (não-oficial, mas ativo — buscar atual)

**O que:** anúncio de release no canal apropriado, + responder
perguntas técnicas que apareçam sobre health-related MCPs.

**Esforço:** 1 post + monitoramento esporádico.

### 3.6 — ResearchGate (opcional, baixa prioridade)

**O que:** criar um "Project" em ResearchGate ligado ao perfil do
Sidney, com descrição do servidor e link para o GitHub. ResearchGate
indexa esses projects no Google Scholar adjacencies, o que pode trazer
tráfego acadêmico marginal.

**Esforço:** ~30 min.

**Sucesso:** difícil de medir. Tratar como "investimento de baixo
custo, retorno improvável mas existente".

### 3.7 — Anthropic MCP Catalog (opcional, baixa probabilidade)

Conforme nota nas memórias: o catálogo oficial da Anthropic prioriza
parcerias comerciais com ferramentas de produtividade, não APIs de
dados públicos. Submeter mesmo assim — o pior cenário é não-resposta;
o melhor é visibilidade desproporcional.

**Como:** procurar por formulário de submissão no site da Anthropic
ou abrir issue no `mcp-servers` repo oficial. **Esforço:** ~20 min.
**Probabilidade de sucesso:** baixa, mas custo trivial.

---

## Fase 4 — Mensuração (contínua)

### Métricas e ferramentas

| Métrica | Fonte | Frequência |
|---------|-------|------------|
| npm downloads/dia/semana/mês | https://npm-stat.com/charts.html?package=medical-terminologies-mcp | Semanal |
| GitHub stars | API GitHub ou shield badge | Semanal |
| GitHub clones (traffic) | https://github.com/SidneyBissoli/medical-terminologies-mcp/graphs/traffic | Semanal |
| Issues + PRs abertos | GitHub | Imediato (notificações) |
| Listagem em Glama | https://glama.ai/api/mcp/v1/servers/SidneyBissoli/medical-terminologies-mcp | One-shot (após 1.4) |
| Listagem em mcpservers.org | grep manual no índice | One-shot |
| awesome-mcp-servers PR | GitHub PR status | One-shot |
| Reddit/HN engagement | upvotes + comments + saved | One-shot por post |
| LinkedIn engagement | impressions, reactions, profile visits | Per post |

### Definição de "funcionou"

Em 60 dias, a divulgação foi bem-sucedida se **pelo menos dois** dos
seguintes acontecerem:

- Downloads npm passam de 160/mês para ≥400/mês sustentado.
- Stars no GitHub crescem ≥30 (de baseline a aferir).
- ≥2 issues ou PRs externos qualificados (pessoa fora do círculo
  imediato do Sidney).
- 1 menção em qualquer veículo terceirizado (blog, newsletter, vídeo,
  outro repo).
- Listing efetivo em ≥3 dos 4 registries (Glama, Smithery, mcpservers.org,
  awesome-mcp-servers).

Se zero dos cinco acontecerem em 60 dias, **revisar diagnóstico** —
provavelmente o gap não é divulgação, é produto (HTTP transport
ausente continua sendo a aposta de maior impacto), ou demanda real é
menor do que estimada.

### Antimétricas

Coisas que **não** medem sucesso:

- LinkedIn likes em post pessoal (vanity metric).
- Mastodon boosts (amplificação ≠ uso).
- Tempo gasto em divulgação (se 30h em 60 dias trazem 2× downloads,
  retorno por hora é ~$0).
- Comentários positivos no Reddit sem clique (compliments are cheap).

---

## Apêndice A — Templates prontos para copy-paste

### A.1 — PR no awesome-mcp-servers

**Título do PR:** *Add medical-terminologies-mcp to Healthcare/Medical*

**Branch:** `add-medical-terminologies-mcp`

**Diff sugerido (formato segue o estilo do repo `punkpeye/awesome-mcp-servers`):**

```markdown
- [SidneyBissoli/medical-terminologies-mcp](https://github.com/SidneyBissoli/medical-terminologies-mcp) 📇 🏠 - Unified MCP server for ICD-11 (WHO), LOINC, RxNorm, MeSH (NLM), and optional SNOMED CT. 21 tools out of the box, structured outputs on 24/27 tools.
```

(Verificar emojis usados pelo repo de destino; `punkpeye/awesome-mcp-servers`
usa 📇 para "official integration", 🏠 para "self-hosted". Ajustar
conforme legenda do README do destino.)

**Body do PR:**

> Adding `medical-terminologies-mcp`, an open-source MCP server I've
> been maintaining that wraps five major medical terminology APIs:
> ICD-11 (WHO), LOINC, RxNorm, MeSH (NLM), and SNOMED CT (optional,
> license-gated).
>
> - 21 tools active by default; 27 with SNOMED enabled.
> - No auth required for LOINC, RxNorm, MeSH; ICD-11 needs free WHO
>   API credentials.
> - structuredContent + outputSchema on 24 of 27 tools.
> - 128-test Vitest suite, CI on PR.
> - MIT licensed.
>
> Listed on the official MCP Registry as
> `io.github.SidneyBissoli/medical-terminologies-mcp`. Currently at
> v1.1.0 with ~160 downloads/month organic.
>
> npm: https://www.npmjs.com/package/medical-terminologies-mcp
> Repo: https://github.com/SidneyBissoli/medical-terminologies-mcp

### A.2 — Submissão Glama.ai

**Nome:** Medical Terminologies MCP

**One-line description:**

> Unified MCP server providing LLMs with reliable lookup access to
> ICD-11, LOINC, RxNorm, MeSH, and (optionally) SNOMED CT.

**Long description (300-500 palavras):**

> `medical-terminologies-mcp` is a Model Context Protocol server that
> exposes 21 ready-to-use tools (27 with SNOMED enabled) wrapping
> five major international medical terminology APIs. Built for LLM
> agents that need reliable, verified terminology lookup instead of
> hallucinated codes.
>
> **Coverage:**
>
> - **ICD-11** (WHO) — 5 tools: search, lookup, hierarchy, chapters,
>   postcoordination axes. Free OAuth credentials required from
>   icd.who.int/icdapi.
> - **LOINC** (NLM Clinical Tables) — 4 tools: search, details,
>   answers, panels. No auth.
> - **RxNorm** (NIH) — 5 tools: search, concept lookup, ingredients,
>   therapeutic classes, NDC mapping. No auth.
> - **MeSH** (NLM Linked Data) — 4 tools: search, descriptor details
>   with scope notes, tree hierarchy, allowed qualifiers. No auth.
> - **SNOMED CT** — 5 tools, gated behind `ENABLE_SNOMED_TOOLS=true`.
>   Requires IHTSDO license and self-hosted Snowstorm. Off by default
>   because the public IHTSDO endpoint was retired in 2026.
> - **Crosswalk** — 4 tools including a cross-terminology search
>   (`find_equivalent`). Crosswalk tool descriptions are explicit
>   about which return real mappings vs. text-search guidance.
>
> **Engineering details:**
>
> - TypeScript, Node 20+, esbuild bundle.
> - Token-bucket rate limiting per API (WHO 5/s, NLM 10/s, RxNorm 20/s).
> - Exponential backoff with ±25% jitter, retry on network errors and
>   408/429/500/502/503/504.
> - WHO OAuth2 with proper `expires_in` cache TTL.
> - `structuredContent` + `outputSchema` on 24 of 27 tools (MCP spec
>   2024-11-05).
> - `annotations` (`readOnlyHint`, `idempotentHint`, `openWorldHint`)
>   declared on every tool.
> - 128 Vitest tests gating CI on PR. Dependabot configured.
>
> **What it deliberately does not do:**
>
> - No authoritative ICD-10 → ICD-11 mapping (`map_icd10_to_icd11`
>   does text search; descriptions are explicit). Use the WHO
>   transition tables for clinical coding.
> - No LOINC ↔ SNOMED mapping (`map_loinc_to_snomed` returns guidance
>   only — UMLS license required for the actual relationships).
> - No clinical decision support. This is a lookup layer.
>
> MIT licensed. The medical terminology content has its own licenses,
> documented in the README.
>
> Active maintenance, ~160 organic monthly downloads from npm at the
> time of submission.

**Categories/tags:** healthcare, medical, terminology, ICD-11, LOINC,
RxNorm, MeSH, SNOMED, NIH, WHO, NLM, clinical-informatics,
medical-coding, public-data.

**Repository URL:** https://github.com/SidneyBissoli/medical-terminologies-mcp

**npm package:** medical-terminologies-mcp

### A.3 — Submissão mcpservers.org

(Formato ajustado ao que o site aceita; se for PR no repo,
adaptar para Markdown.)

**Name:** medical-terminologies-mcp

**Category:** Healthcare

**Description (one paragraph):**

> Unified Model Context Protocol server for five international medical
> terminologies: ICD-11 (WHO), LOINC and MeSH (NLM), RxNorm (NIH),
> and SNOMED CT (optional, license-gated). 21 tools work out of the
> box; ICD-11 requires free WHO API credentials. Structured outputs,
> rate-limiting, retry, and proper OAuth handling. MIT licensed.

**Repository:** https://github.com/SidneyBissoli/medical-terminologies-mcp

**Install:** `npm install -g medical-terminologies-mcp`

**License:** MIT

### A.4 — Submissão Smithery.ai (após 1.2 implementado)

**Nota crítica:** Smithery exige Streamable HTTP transport. **Não
submeter antes de Phase 1.2 estar completa e publicada como 1.2.0 no
npm.**

**Server name:** medical-terminologies

**Display name:** Medical Terminologies (ICD-11, LOINC, RxNorm, MeSH)

**Description:**

> Open-source MCP server providing unified lookup across major medical
> terminologies. ICD-11, LOINC, RxNorm, MeSH out of the box (21 tools);
> SNOMED CT optional with valid IHTSDO license. Real API calls, not
> LLM-invented codes.

**Smithery YAML:** criar `smithery.yaml` na raiz do repo após 1.2:

```yaml
startCommand:
  type: http
  configSchema:
    type: object
    properties:
      whoClientId:
        type: string
        description: WHO ICD-11 API Client ID (optional; required only for ICD-11 tools)
      whoClientSecret:
        type: string
        description: WHO ICD-11 API Client Secret
      whoIcd11ReleaseId:
        type: string
        default: "2024-01"
        description: ICD-11 release ID (e.g. 2024-01, 2025-01)
      enableSnomedTools:
        type: boolean
        default: false
        description: Enable SNOMED CT tools (requires IHTSDO license + self-hosted Snowstorm)
      snomedBaseUrl:
        type: string
        description: Base URL for self-hosted Snowstorm instance
      snomedLanguage:
        type: string
        default: "en"
        description: Accept-Language tag for SNOMED responses
      logLevel:
        type: string
        default: "info"
        enum: [debug, info, warn, error, fatal]
```

(Validar contra a spec Smithery atual antes de commit; o formato pode
ter evoluído.)

### A.5 — Email para early adopters

**Subject (template):** *Quick question on [specific thing they wrote/built]*

**Body (personalizar a frase de abertura, manter o resto):**

> Hi [Name],
>
> [Specific opener tied to something they wrote or built — e.g.,
> "I read your post on running Claude alongside Epic queries last
> month and the part about terminology drift stuck with me." This line
> is mandatory, no exceptions.]
>
> I've been working on a small open-source project — a Model Context
> Protocol server that wraps ICD-11, LOINC, RxNorm, MeSH (and
> optionally SNOMED CT) so LLM agents can look up codes against the
> real APIs instead of inventing them. It's at v1.1.0 with ~160
> monthly downloads, mostly organic.
>
> I'm specifically interested in feedback from people doing real
> clinical or research informatics work — not "is the code clean"
> feedback (the README and repo are the public answer to that), but
> "would this actually be useful in the workflow you run?"
>
> If you have 5 minutes to look at one or two of the use cases in the
> README and tell me what's missing or wrong for your work, I'd be
> genuinely grateful. No expectation, no follow-up if you don't reply.
>
> https://github.com/SidneyBissoli/medical-terminologies-mcp
>
> Thanks for your time.
>
> Sidney Bissoli
> https://github.com/SidneyBissoli

**Notas de uso:**
- A frase de abertura é não-negociável. Sem ela, o email é spam.
- Não enviar mais de um lembrete; sem resposta = sem resposta.
- Não enviar para ≥ 5 pessoas no mesmo dia (evita patterns de spam
  no servidor de email).

### A.6 — Show HN (versão enxuta)

**Título:** *Show HN: Medical-Terminologies-MCP – ICD-11, LOINC, RxNorm, MeSH lookup for LLMs*

**Body:**

> I built an open-source MCP server that gives LLMs reliable lookup
> access to five international medical terminologies: ICD-11 (WHO),
> LOINC, RxNorm, MeSH (all NLM), and optionally SNOMED CT.
>
> 21 tools work without any setup beyond the npx command in the MCP
> client config; ICD-11 needs free WHO API credentials (5-min signup).
> SNOMED is gated behind a flag because the public IHTSDO endpoint
> was retired earlier this year — operators with a license run it
> against a self-hosted Snowstorm instance.
>
> What I tried to get right:
> - structuredContent + outputSchema on 24 of 27 tools, so MCP clients
>   that consume typed data don't have to re-parse markdown.
> - Token-bucket rate limiting per upstream API (WHO 5/s, NLM 10/s,
>   RxNorm 20/s). Retry with exponential backoff and jitter.
> - WHO OAuth2 with actual expires_in handling (not a hardcoded TTL).
> - 128-test Vitest suite gating CI.
> - Honest crosswalk tools — `map_icd10_to_icd11` says explicitly in
>   its description that it does text search, not authoritative
>   mapping. `map_loinc_to_snomed` says it returns guidance, not a
>   mapping, because the real mapping requires UMLS or LOINC
>   Expression Association files.
>
> The use case I keep returning to: an LLM working alongside clinical
> documentation that needs to pin down "the LOINC for procalcitonin
> in serum" gets `33959-8` from the actual NLM API, not whatever the
> model would have invented.
>
> MIT licensed. Repo:
> https://github.com/SidneyBissoli/medical-terminologies-mcp
>
> Feedback specifically welcome on what's missing for clinical
> informatics workflows that actually run in production.

### A.7 — GitHub Discussions / repo announcement

Para crosspost em https://github.com/SidneyBissoli/medical-terminologies-mcp/discussions:

**Categoria:** Show and tell (criar se não existir)

**Título:** *v1.1.0 — what's new and what's coming*

**Body:** versão curta do post longo focando em (a) o que entrou em
1.1.0 (referência ao CHANGELOG), (b) os 3 use cases, (c) o roadmap
visível (HTTP transport, ATC + CID-10 sob avaliação).

---

## Apêndice B — Riscos e o que NÃO fazer

### O que pode queimar reputação

1. **Postar em r/medicine sem ler as rules.** A regra contra
   self-promotion é estrita. Se postar e for removido, o sub-mod pode
   banir reincidentes. Estratégia segura: framing como pergunta
   genuína (variante 2.3.b), oferecer remoção voluntária se cruzar
   linha, **não recriar se removido.**

2. **Spam em chat.fhir.org.** A comunidade HL7 detecta drive-by
   self-promotion em segundos. **Postar apenas em resposta a contexto.**
   Não criar thread "look what I built." Se for postar proativamente,
   fazer no canal `#tooling` ou similar com framing técnico, não
   promocional.

3. **Cold email genérico para AMIA membership.** O AMIA listserv tem
   regras claras. Email genérico = bounce + reputation hit. Use o
   template do A.5 e personalize a frase de abertura **sempre**.

4. **Cross-post em 5 subreddits no mesmo dia.** Reddit admin tools
   detectam isso e marcam como spammer. Espalhar em ≥48h entre cada
   sub.

5. **Linguagem promocional inflada.** "Revolutionary," "Game-changing,"
   "The first-ever" — qualquer dessas frases atrai backlash em HN,
   Reddit, e Mastodon de devs. Os drafts deste roadmap evitam isso
   conscientemente. **Não editar de volta.**

6. **Claim de uso clínico em produção.** O servidor não é certificado
   para uso clínico em produção, e o README diz isso. **Nenhuma peça
   de divulgação deve sugerir o contrário.** "Useful for clinical
   informatics workflows" é OK; "ready for production EHR integration"
   não é.

7. **Inventar capacidades.** Tudo que o roadmap descreve está no
   código verificado. Se em alguma adaptação você sentir vontade de
   acrescentar "and also does X," verifique no `src/tools/` antes.
   Diferenciais reais (structuredContent, annotations, OAuth, rate
   limiting, retry) já são fortes; não há necessidade de inflar.

### Comunidades onde auto-promoção é mal vista

| Comunidade | Tolerância | Como contornar |
|------------|-----------|----------------|
| r/medicine | Muito baixa | Framing como pergunta; oferecer remoção; não pushar |
| r/MedicalSchool | Muito baixa | Não postar; não é o público |
| chat.fhir.org | Baixa para self-promo, alta para resposta técnica | Só em resposta a thread relevante |
| AMIA forums (membership) | Média | Personalização obrigatória; canal específico |
| HN front page | Alta intolerância a marketing-speak | Mas Show HN é o canal certo se o tom for técnico |
| Mastodon academic.social | Média; tolera anúncios honestos | Tom direto, sem hype |
| LinkedIn | Alta tolerância a self-promo | Mas overdose causa unfollow |
| Discord MCP communities | Alta | É o canal; basta seguir as regras do servidor |
| ResearchGate | Média | Project announcement = OK; spam de mensagem direta = não |

### O que NÃO incluir nos posts

- **Métricas vazias.** "1000+ downloads in 24 hours" só funciona depois
  que aconteceu. Não predizer.
- **Comparações diretas com competidores.** Não há um equivalente
  direto no espaço MCP de saúde. Comparar com loinc.org ou icd.who.int
  é absurdo (são fontes upstream). Comparar com competidores
  proprietários (3M, Wolters Kluwer) é fora de escala. Foque no que
  o servidor faz, não em quem ele "supera".
- **Roadmap de features futuras como se fossem entregues.** ATC, CID-10,
  HTTP transport — mencionar como "upcoming" se relevante, nunca como
  "supports."
- **Termos vagos de marketing.** "Comprehensive," "robust,"
  "enterprise-ready," "scalable" — se quiser dizer que tem rate
  limiting, rate limiting de 5 req/s para WHO é o que diz. Se quiser
  dizer que tem testes, "128-test Vitest suite" é o que diz.
- **Comparações de IA.** Não comparar Claude com outros LLMs no
  contexto de uso do servidor — o servidor é client-agnostic.

### Quando parar

Se em 30 dias zero das métricas-alvo se moverem, **parar a divulgação
e diagnosticar produto**. Provavelmente:
- HTTP transport ainda é o gap principal (se 1.2 não foi feito).
- Cobertura de terminologias brasileiras (ATC + CID-10) é o que
  mercado lusófono espera e está ausente.
- Demanda real é menor do que estimada — caso em que o esforço
  marginal de divulgação tem retorno baixo.

Não escalar volume em busca de conversão; escalar qualidade de canal
ou voltar para produto.

---

## Resumo executivo (1 página)

**Estado:** servidor tecnicamente sólido (27 tools, structuredContent,
OAuth, rate limiting, 128 testes, CI), mas em distribuição npm-only
com ~160 dl/mês.

**Maior alavanca de adoção identificada:** Streamable HTTP transport
(~3-4h de trabalho) destrava Smithery, Cloudflare Workers, hosted
catalogs. Sem isso, teto de adoção fica em ~500 dl/mês mesmo com
divulgação ótima.

**Plano de 60 dias:**

| Semana | Foco | Tempo estimado |
|--------|------|----------------|
| 1 | Phase 1.1, 1.3 + submissões registries | 3-4 h |
| 2 | Phase 1.2 (HTTP transport) | 3-4 h |
| 2-3 | Phase 2 (post longo, LinkedIn, Reddit, Mastodon) | 4-6 h |
| 4-6 | Phase 3 (Show HN, HL7, AMIA, emails) | 3-5 h |
| 7-9 | Mensuração + ajuste | 1-2 h |

**Total:** 14-21 h em 60 dias = 2-3 h/semana. Cabe no orçamento.

**Critério de sucesso (60 dias):** ≥2 dos 5 indicadores de Phase 4
acionados. Se zero, replanejar produto, não divulgação.
