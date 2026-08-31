# Medical Terminologies MCP Server

[![npm version](https://img.shields.io/npm/v/medical-terminologies-mcp.svg)](https://www.npmjs.com/package/medical-terminologies-mcp)
[![npm downloads](https://img.shields.io/npm/dm/medical-terminologies-mcp.svg)](https://www.npmjs.com/package/medical-terminologies-mcp)
[![node](https://img.shields.io/node/v/medical-terminologies-mcp)](https://www.npmjs.com/package/medical-terminologies-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-blue)](https://registry.modelcontextprotocol.io)
[![LobeHub](https://lobehub.com/badge/mcp/sidneybissoli-medical-terminologies-mcp)](https://lobehub.com/mcp/sidneybissoli-medical-terminologies-mcp)
[![smithery badge](https://smithery.ai/badge/sidneybissoli/medical-terminologies-mcp)](https://smithery.ai/servers/sidneybissoli/medical-terminologies-mcp)
[![Glama MCP server](https://glama.ai/mcp/servers/SidneyBissoli/medical-terminologies-mcp/badges/score.svg)](https://glama.ai/mcp/servers/SidneyBissoli/medical-terminologies-mcp)
[![Available on CodeGuilds](https://img.shields.io/badge/Available_on-CodeGuilds-6366f1)](https://codeguilds.dev/packages/medical-terminologies-mcp)
[![GitHub stars](https://img.shields.io/github/stars/SidneyBissoli/medical-terminologies-mcp?style=flat&logo=github)](https://github.com/SidneyBissoli/medical-terminologies-mcp)
[![GitHub Sponsors](https://img.shields.io/github/sponsors/SidneyBissoli?logo=githubsponsors&label=Sponsor&color=db61a2)](https://github.com/sponsors/SidneyBissoli)
[![tool calls](https://img.shields.io/endpoint?url=https%3A%2F%2Fmedical.sidneybissoli.com%2Fstats%2Fbadge)](https://medical.sidneybissoli.com/stats)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue.svg)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Um servidor Model Context Protocol (MCP) que dá acesso unificado às grandes terminologias médicas do mundo:

- **ICD-11** — Classificação Internacional de Doenças (OMS)
- **SNOMED CT** — Systematized Nomenclature of Medicine *(opcional; exige Snowstorm auto-hospedado)*
- **LOINC** — Logical Observation Identifiers Names and Codes
- **RxNorm** — nomes normalizados de medicamentos clínicos (NIH)
- **MeSH** — Medical Subject Headings (NLM)
- **ATC** — classificação Anatomical Therapeutic Chemical (Centro Colaborador da OMS, servida via NLM RxClass)
- **CID-10** — tradução brasileira da ICD-10 (DataSUS V2008, embutida)

🇺🇸 [Read in English](README.md)

## Veja na prática

Pergunte ao seu assistente:

- *"Qual o código ICD-11 do diabetes tipo 2?"* → `icd11_search`
- *"Mapeie o código ICD-10 E11 para ICD-11."* → `map_icd10_to_icd11`
- *"O que o LOINC 2339-0 mede?"* → `loinc_details`
- *"Qual o código CID-10 para infarto agudo do miocárdio?"* → `cid10_search`

As respostas vêm de fontes oficiais (OMS, NLM, NIH, DataSUS) — códigos e mapeamentos reais, não chutes do treino.

## Funcionalidades

- 31 ferramentas por padrão (37 com o SNOMED habilitado) para consulta de terminologia médica
- 3 **Prompts** MCP que orquestram chamadas de ferramenta em fluxos nomeados (`find-medical-code`, `drug-info`, `cid10-portuguese-lookup`) — os clientes exibem isso como ação de um clique para o usuário
- 4 **Recursos** MCP de conteúdo de referência em processo (`info://server`, `info://cid10/chapters`, `info://licenses`, `info://stats`) — leitura em menos de um milissegundo (exceto `info://stats`, que vai até o Durable Object StatsCounter no endpoint hospedado)
- Várias terminologias num servidor só
- Busca e mapeamento entre terminologias
- **Procedência em toda resposta** (desde a v1.8.0): todo resultado bem-sucedido carrega um bloco de procedência legível por máquina — fonte, URL canônica, vintage do dado, instante real da extração (resposta vinda do cache preserva o instante da busca original), citação pronta para uso e licença — em `structuredContent.provenance` + `attribution`, espelhado em `_meta` sob `com.sidneybissoli.medical/*`, com um rodapé de texto compacto para clientes só-texto. Respostas de várias fontes (`find_equivalent`, `validate_codes`) carregam um bloco por fonte; campos de ranking calculados no servidor vêm marcados como derivados
- Cache embutido, para desempenho
- Limite de taxa, para respeitar os limites das APIs de origem
- Respostas detalhadas, com formatação rica
- Dois transportes: **stdio** (padrão; para Claude Desktop e clientes de IDE) e **Streamable HTTP** (o Worker hospedado na Cloudflare em `https://medical.sidneybissoli.com/mcp`, ou a sua própria instância de `worker/`)

📖 **Artigo:** [CID-10, CID-11 e o que muda para quem trabalha com dados do SUS](docs/artigo-cid10-e-cid11-no-sus.pt-BR.md) — a estrutura da V2008 em números, o que as tabelas de transição da OMS são e o que elas não são, e as licenças que diferem entre as fontes.

## Para quem é isto?

Este servidor **não** é ferramenta de decisão em assistência clínica — quem atende tem assistentes especializados para isso (UpToDate AI, OpenEvidence, ferramentas integradas ao prontuário). O público real é de pesquisadores, analistas de saúde pública, desenvolvedores de informática clínica e educadores que precisam de acesso programático a dados terminológicos oficiais.

| Se você é... | Comece por | Por quê |
|--------------|------------|---------|
| **Pesquisador biomédico / bibliógrafo** | `mesh_search`, `mesh_descriptor`, `mesh_tree` | O MeSH é o vocabulário de indexação do PubMed; os números de árvore permitem percorrer a hierarquia controlada programaticamente |
| **Analista de saúde pública (Brasil / SUS)** | `cid10_search`, `cid10_chapters`, `atc_classify` | A CID-10 V2008 é o padrão operacional brasileiro; a ATC casa bem com os dados de prescrição do DataSUS |
| **Analista de saúde pública (internacional)** | `icd11_search`, `icd11_lookup`, `icd11_chapters` | A ICD-11 da OMS é a revisão internacional vigente; capítulos e hierarquia sustentam classificação em pipeline |
| **Desenvolvedor de informática clínica** | `loinc_search`, `loinc_details`, `find_equivalent` | LOINC para interoperabilidade de exames/observações; busca entre terminologias para esboçar mapeamentos novos |
| **Educador / autor de currículo** | `mesh_descriptor`, `icd11_lookup`, `rxnorm_search` | Definições oficiais, números de árvore e tipos de termo de medicamento que você usa direto em exercícios autocorrigidos |

## Experimente a instância hospedada (sem instalar)

Há um deploy público em Cloudflare Workers rodando em:

```
https://medical.sidneybissoli.com/mcp
```

Conecte pelo MCP Inspector ou por qualquer cliente MCP de Streamable HTTP:

```bash
npx @modelcontextprotocol/inspector --transport streamable-http \
  --server-url https://medical.sidneybissoli.com/mcp
```

Ou instale pelo Smithery, que faz proxy do mesmo endpoint pelo gateway deles:

```bash
npx -y smithery mcp add sidneybissoli/medical-terminologies-mcp
```

A instância hospedada já tem as credenciais da OMS configuradas, então todas as 31 ferramentas padrão funcionam sem nenhuma configuração da sua parte. Para o seu próprio deploy (rede corporativa, outra região, credenciais próprias da OMS), veja as seções [Instalação](#instalação) e [Hospedado em Cloudflare Workers](#hospedado-em-cloudflare-workers-primário) abaixo.

## Instalação

### Instalação global (recomendada)

```bash
npm install -g medical-terminologies-mcp
```

### Instalação local

```bash
npm install medical-terminologies-mcp
```

## Configuração

### Claude Desktop

Acrescente ao arquivo de configuração do Claude Desktop:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "medical-terminologies": {
      "command": "npx",
      "args": ["-y", "medical-terminologies-mcp"],
      "env": {
        "WHO_CLIENT_ID": "seu-who-client-id",
        "WHO_CLIENT_SECRET": "seu-who-client-secret"
      }
    }
  }
}
```

### Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `WHO_CLIENT_ID` | Sim¹ | Client ID da API ICD da OMS |
| `WHO_CLIENT_SECRET` | Sim¹ | Client Secret da API ICD da OMS |
| `WHO_ICD11_RELEASE_ID` | Não | Release da ICD-11 a consultar (ex.: `2024-01`, `2025-01`). Padrão `2024-01`. |
| `ENABLE_SNOMED_TOOLS` | Não² | Defina como `true` para registrar as 6 ferramentas que dependem do SNOMED. Desligado por padrão. |
| `SNOMED_BASE_URL` | Não² | URL base de uma instância Snowstorm, ex.: `https://meu-snowstorm.exemplo.com/snowstorm/snomed-ct`. |
| `SNOMED_LANGUAGE` | Não² | Tag(s) `Accept-Language` para as respostas do SNOMED, ex.: `pt`, `pt-BR`, `es`. Padrão `en`. Valores de tag única passam adiante de forma confiável; valores compostos com pesos q (ex.: `pt-BR,en;q=0.8`) dependem de como a sua instância Snowstorm trata o `Accept-Language` — a semântica de fallback pode variar. Teste contra o seu deploy específico se for depender de fallback ponderado. |
| `LOG_LEVEL` | Não | Nível de log do pino (`debug`, `info`, `warn`, `error`, `fatal`). Padrão `info`. |

¹ Obrigatória para as ferramentas de ICD-11. Credenciais em: https://icd.who.int/icdapi.

² Veja [Configuração do SNOMED CT (avançado)](#configuração-do-snomed-ct-avançado) abaixo. LOINC, RxNorm e MeSH não precisam de configuração nenhuma.

### Transporte HTTP (hospedado)

O servidor roda em stdio por padrão — é o que o Claude Desktop e os clientes de IDE esperam. O transporte Streamable HTTP é servido pelo Worker da Cloudflare em `worker/` (uma instância do template de hospedagem da Fase 0 do mantenedor). A flag `--http` da entrada Node foi removida na v1.6.0 — se você precisa de um endpoint HTTP local, rode o Worker localmente:

```bash
npm ci && cd worker && npm ci
npm run dev     # wrangler dev em http://localhost:8787
# Inspector via HTTP
npx @modelcontextprotocol/inspector --transport streamable-http --server-url http://localhost:8787/mcp
```

Endpoints hospedados (produção e local, iguais):

- `POST /mcp` — JSON-RPC sobre Streamable HTTP (o protocolo MCP). Modo stateless: cada requisição é independente.
- `GET /health` — sonda de liveness, devolve `{ status, name, version, tool_count, uptime_s }`.
- `GET /status` — versão + metadados do deploy. `GET /metrics` — uso agregado por ferramenta.
- `GET /stats` e `GET /stats/badge` — contador público de chamadas de ferramenta (desde 2026-05-13) e o badge shields.io dele.
- `GET /.well-known/mcp/server-card.json` — server card estático para os scanners de registro.
- O CORS é permissivo (`*`), para que clientes de navegador (a UI web do MCP Inspector, por exemplo) conectem direto.

### Hospedado em Cloudflare Workers (primário)

O deploy de produção é o Worker da Cloudflare em `worker/`, configuração em `worker/wrangler.jsonc`, deploy no CI em `.github/workflows/deploy-worker.yml` (roda sozinho a cada push na `main`).

Para publicar a sua própria instância:

```bash
npm ci && npm run build:worker-lib
cd worker && npm ci
npx wrangler login         # uma vez só, fluxo pelo navegador
npx wrangler deploy        # publica em <nome>.<conta>.workers.dev
# Defina os segredos da ICD-11 para aquelas 5 ferramentas funcionarem:
npx wrangler secret put WHO_CLIENT_ID
npx wrangler secret put WHO_CLIENT_SECRET
```

Atenção: `worker/wrangler.jsonc` fixa o `account_id` e a rota de domínio próprio do mantenedor — remova ou substitua os dois no seu deploy.

Por que Workers: zero cold start na borda, US$5/mês fixos para 10M de requisições (o plano gratuito cobre até 100 mil req/dia) e nenhuma VM para dimensionar ou reiniciar. O template já traz limite de taxa por IP e um Durable Object de estatísticas de uso; o cache e o limitador voltados à origem são por isolate (a Fase 11.9, Estágio 2 do PROGRESS.md acompanha a evolução para KV/DO).

### Listar no Smithery

Depois que o seu Worker estiver no ar, registre a URL no Smithery:

1. Acesse https://smithery.ai → **Publish → MCP** (ou `https://smithery.ai/new`).
2. Escolha o caminho de submissão por **URL** (o Smithery descontinuou a hospedagem em contêiner em 2024 — URL é o fluxo suportado hoje).
3. Cole `https://<seu-worker>.workers.dev/mcp`. O gateway do Smithery varre a conformidade e faz proxy do tráfego.

## Ferramentas disponíveis (31 por padrão, 37 com o SNOMED habilitado)

### Conteúdo oficial em português (pt-BR)

O servidor nunca traduz conteúdo terminológico por máquina — mas várias fontes publicam traduções oficiais, e as ferramentas as expõem:

- **A CID-10 é nativamente em português**: `cid10_search` / `cid10_lookup` / `cid10_chapter(s)` servem o conjunto DataSUS V2008 (a CID-10 que o SUS usa operacionalmente).
- **ICD-11 em português oficial**: passe `language: "pt"` para `icd11_search` / `icd11_lookup` e busque e leia os rótulos da linearização oficial pt-BR da OMS.
- **MeSH**: passe `language: "pt"` para `mesh_search` / `mesh_descriptor` e peça as traduções oficiais da NLM onde elas existem.
- **SNOMED CT** (quando habilitado): `language` pede as descrições carregadas na sua edição do Snowstorm (por exemplo, o refset pt-BR de uma extensão nacional).

Se a fonte não tem tradução oficial para uma entrada, você recebe o idioma de origem — nunca uma tradução de máquina.

### Ferramentas ICD-11 (5)

| Ferramenta | Descrição | Exemplo |
|------------|-----------|---------|
| `icd11_search` | Busca na ICD-11 por termo | `query: "diabetes mellitus"` |
| `icd11_lookup` | Detalhes da entidade por código/URI | `code: "5A11"` |
| `icd11_hierarchy` | Navega as relações pai/filho | `code: "5A11"` |
| `icd11_chapters` | Lista todos os capítulos da ICD-11 | - |
| `icd11_postcoordination` | Devolve os eixos de pós-coordenação | `code: "5A11"` |

### Ferramentas LOINC (4)

| Ferramenta | Descrição | Exemplo |
|------------|-----------|---------|
| `loinc_search` | Busca exames laboratoriais e observações | `query: "glucose"` |
| `loinc_details` | Detalhes completos de um código LOINC | `loinc_num: "2339-0"` |
| `loinc_answers` | Lista de respostas para questionários | `loinc_num: "44249-1"` |
| `loinc_panels` | Estrutura de painel/formulário | `loinc_num: "24331-1"` |

### Ferramentas RxNorm (5)

| Ferramenta | Descrição | Exemplo |
|------------|-----------|---------|
| `rxnorm_search` | Busca medicamentos por nome | `query: "metformin"` |
| `rxnorm_concept` | Detalhes do conceito do medicamento | `rxcui: "6809"` |
| `rxnorm_ingredients` | Princípios ativos | `rxcui: "6809"` |
| `rxnorm_classes` | Classes terapêuticas | `rxcui: "6809"` |
| `rxnorm_ndc` | Mapeia entre RxCUI e NDC | `rxcui: "6809"` |

### Ferramentas MeSH (4)

| Ferramenta | Descrição | Exemplo |
|------------|-----------|---------|
| `mesh_search` | Busca descritores MeSH | `query: "hypertension"` |
| `mesh_descriptor` | Detalhes do descritor | `mesh_id: "D006973"` |
| `mesh_tree` | Posição na hierarquia de árvore | `mesh_id: "D006973"` |
| `mesh_qualifiers` | Qualificadores permitidos | `mesh_id: "D006973"` |

### Ferramentas SNOMED CT (5, desligadas por padrão)

Só são registradas com `ENABLE_SNOMED_TOOLS=true`. Veja [Configuração do SNOMED CT (avançado)](#configuração-do-snomed-ct-avançado).

| Ferramenta | Descrição | Exemplo |
|------------|-----------|---------|
| `snomed_search` | Busca conceitos por termo | `query: "myocardial infarction"` |
| `snomed_concept` | Detalhes do conceito por SCTID | `sctid: "22298006"` |
| `snomed_hierarchy` | Conceitos pai/filho | `sctid: "22298006"` |
| `snomed_descriptions` | Todas as descrições | `sctid: "22298006"` |
| `snomed_ecl` | Executa consultas ECL | `ecl: "<< 73211009"` |

### Ferramentas de mapeamento entre terminologias (5 — `map_snomed_to_icd10` exige SNOMED)

| Ferramenta | Descrição | Exemplo |
|------------|-----------|---------|
| `map_icd10_to_icd11` | Mapeamento oficial ICD-10 → ICD-11 pelas tabelas de transição da OMS embutidas; devolve código primário + capítulo + URIs e as alternativas documentadas pela OMS | `icd10_code: "E11"` |
| `map_snomed_to_icd10` | Orientação SNOMED CT → ICD-10 (só com `ENABLE_SNOMED_TOOLS=true`) | `sctid: "73211009"` |
| `map_loinc_to_snomed` | Orientação LOINC ↔ SNOMED | `loinc_code: "2339-0"` |
| `validate_codes` | Valida em lote até 100 códigos em ICD-11, LOINC, RxNorm, MeSH, ATC, CID-10 (e SNOMED quando habilitado); devolve válido/inválido + nome de exibição por código | `codes: [{terminology:"icd11",code:"5A11"}, …]` |
| `find_equivalent` | Busca unificada e ranqueada entre terminologias: `match_score`/`rank` calculados no servidor por candidato, mais `groups` de títulos lexicalmente idênticos entre terminologias; o ramo do SNOMED é pulado quando as ferramentas SNOMED estão desligadas | `term: "diabetes"` |

### Ferramentas ATC (3)

Classificação Anatomical Therapeutic Chemical da OMS, servida pelo NLM RxClass (grátis, sem autenticação). A base do próprio WHOCC exige assinatura paga, mas o RxClass envelopa os mesmos pares código/nome.

| Ferramenta | Descrição | Exemplo |
|------------|-----------|---------|
| `atc_classify` | Nome do medicamento → código(s) ATC | `drug_name: "metformin"` |
| `atc_lookup` | Código ATC (nível 1-4) → nome + tipo de nível | `atc_code: "A10BA"` |
| `atc_members` | Classe ATC → medicamentos membros | `atc_code: "A10BA"` |

### Ferramentas CID-10 (4)

Tradução brasileira da ICD-10 (DataSUS V2008). Vem embutida como conjunto estático — nenhuma chamada HTTP. O SUS usa a CID-10 V2008 operacionalmente; para a ICD-11 internacional (a revisão vigente da OMS), use as ferramentas de ICD-11 acima.

| Ferramenta | Descrição | Exemplo |
|------------|-----------|---------|
| `cid10_search` | Busca textual em português (ignora acentos) | `query: "diabetes"` |
| `cid10_lookup` | Código → nome oficial em português | `code: "I21"` ou `"A00.1"` |
| `cid10_chapters` | Lista os 22 capítulos da CID-10 | - |
| `cid10_chapter` | Detalhe do capítulo com os grupos que o compõem | `num: 9` |

### Ferramentas de versionamento (2)

Mostram contra qual versão de cada terminologia este servidor consulta hoje — útil ao rodar validação em lote contra uma release fixada, ou ao investigar uma consulta que passou a não achar nada depois de uma atualização na origem.

| Ferramenta | Descrição | Exemplo |
|------------|-----------|---------|
| `terminology_versions` | Lista as 8 terminologias suportadas com versão atual, data de publicação, publicador, URL de origem e cadência de atualização | - |
| `terminology_diff` | Informa que dados de diferença existem entre duas versões de uma terminologia (estatísticas reais entre revisões para ICD-10 → ICD-11; orientação nos demais casos) | `terminology: "icd10-icd11"` |

## Exemplos de saída

As amostras abaixo são a saída formatada que as ferramentas de fato produzem — o corpo de texto do `CallToolResult`. As ferramentas também devolvem um objeto `structuredContent` compatível com o `outputSchema` de cada uma, para consumo programático.

### `loinc_search` — query: "glucose", max_results: 3

```markdown
## LOINC Search Results for "glucose"

Found 1024 total results (showing 3):

1. **74790-7** - Glucose challenge (hydrogen breath test) panel - Exhaled gas
   Component: Glucose challenge panel | Method: -

2. **104708-3** - Deprecated Estimated average glucose [Moles/volume] in Blood
   Component: Estimated average glucose | Property: SCnc

3. **97510-2** - Glucose measurements in range out of Total glucose measurements during reporting period
   Component: Glucose measurements in range/Total glucose measurements | Property: NFr | Method: Calculated
```

O `total_count` (1024) reflete todas as ocorrências no índice do NLM Clinical Tables, não só a página devolvida. Aumente o `max_results` (máximo 50) para ver códigos canônicos como o `2339-0` (glicose [massa/volume] no sangue); o ranking de relevância da API põe painéis e medidas derivadas acima da glicemia simples quando a página é pequena.

### `rxnorm_ingredients` — rxcui: "6809" (metformina)

```markdown
# Ingredients for RxCUI 6809

Found 18 ingredient(s):

| RxCUI | Name | Type |
|-------|------|------|
| 6809 | metformin | Single Ingredient |
| 1007411 | chlorpropamide / metformin | Multiple Ingredient |
| 1043562 | metformin / saxagliptin | Multiple Ingredient |
| 1243019 | linagliptin / metformin | Multiple Ingredient |
| 1486436 | dapagliflozin / metformin | Multiple Ingredient |
| 1545149 | canagliflozin / metformin | Multiple Ingredient |
| 1664314 | empagliflozin / metformin | Multiple Ingredient |
| 729717  | metformin / sitagliptin | Multiple Ingredient |
| ...     | (10 more combinations)   | Multiple Ingredient |
```

Para um RxCUI que é ele mesmo um princípio ativo (TTY=IN), a ferramenta devolve esse princípio mais todo conceito de múltiplos ingredientes (TTY=MIN) que o inclua. Use isso para enumerar as associações construídas em torno de uma substância.

### `mesh_descriptor` — mesh_id: "D006973" (hipertensão)

```markdown
# Hypertension
MeSH ID: D006973

## Scope Note

Persistently high systemic arterial BLOOD PRESSURE. Based on multiple readings (BLOOD PRESSURE DETERMINATION), hypertension is currently defined as when SYSTOLIC PRESSURE is consistently greater than 140 mm Hg or when DIASTOLIC PRESSURE is consistently 90 mm Hg or more.

## Tree Numbers

- C14.907.489

## Concepts

- Hypertension *(preferred)*

## Allowed Qualifiers

35 qualifier(s) allowed. Use mesh_qualifiers for details.
```

A nota de escopo vem do *conceito preferido* do descritor, não do campo de anotação (que é uma nota voltada a quem indexa). Os números de árvore são o caminho navegável dentro da hierarquia controlada do MeSH — `C14.907.489` põe a hipertensão sob Doenças Cardiovasculares → Doenças Vasculares.

## Fluxos comuns

- **Consulta na ICD-11:** `icd11_search` com um termo clínico → escolha o resultado → `icd11_lookup` com o código para o detalhe completo, ou `icd11_hierarchy` para percorrer pais e filhos.
- **Pipeline de medicamento:** `rxnorm_search` por nome comercial ou genérico → `rxnorm_concept` para o registro canônico → `rxnorm_ingredients` e `rxnorm_classes` para a análise seguinte.
- **Esboço de mapeamento entre terminologias:** `find_equivalent` com um termo clínico busca em ICD-11, LOINC, RxNorm, MeSH e (quando habilitado) SNOMED numa chamada só. Use para começar um mapeamento; as ferramentas `map_*` par a par refinam.
- **ICD-10 → ICD-11 (busca textual, não oficial):** `map_icd10_to_icd11` faz busca textual honesta contra a ICD-11 da OMS. As tabelas de transição reais da OMS estão acompanhadas na [Fase 13.1 do PROGRESS.md](./PROGRESS.md).

## Configuração do SNOMED CT (avançado)

As 5 ferramentas SNOMED (`snomed_search`, `snomed_concept`, `snomed_hierarchy`, `snomed_descriptions`, `snomed_ecl`) mais a ferramenta de mapeamento que depende do SNOMED (`map_snomed_to_icd10`) vêm **desligadas por padrão**. Com elas desligadas o servidor registra 31 ferramentas em vez de 37; o `find_equivalent` continua funcionando e pula o ramo do SNOMED com uma nota explicativa.

O motivo: desde 2026-05-08 o endpoint Snowstorm público do IHTSDO que este projeto historicamente chamava (`https://browser.ihtsdotools.org/snowstorm/snomed-ct/...`) devolve HTTP 410 Gone em todos os caminhos. Sem um backend que funcione, registrar essas ferramentas entregaria a todo cliente 6 ferramentas garantidamente quebradas.

Para habilitar as ferramentas SNOMED:

1. **Confirme a sua licença de SNOMED CT.** O uso do SNOMED CT exige licença da SNOMED International (IHTSDO). Quem reside em país membro costuma tê-la pelo centro nacional de release; quem não é membro pode obter uma licença de Afiliado. Veja https://www.snomed.org/snomed-ct/get-snomed.

2. **Rode uma instância Snowstorm.** A SNOMED International publica o Snowstorm como código aberto ([IHTSDO/snowstorm](https://github.com/IHTSDO/snowstorm)) e como imagem Docker ([`snomedinternational/snowstorm`](https://hub.docker.com/r/snomedinternational/snowstorm)). Auto-hospedar exige importar um arquivo de release RF2 (fornecido a quem tem licença).

3. **Configure este servidor:**

   ```json
   {
     "mcpServers": {
       "medical-terminologies": {
         "command": "npx",
         "args": ["-y", "medical-terminologies-mcp"],
         "env": {
           "WHO_CLIENT_ID": "...",
           "WHO_CLIENT_SECRET": "...",
           "ENABLE_SNOMED_TOOLS": "true",
           "SNOMED_BASE_URL": "https://meu-snowstorm.exemplo.com/snowstorm/snomed-ct",
           "SNOMED_LANGUAGE": "en"
         }
       }
     }
   }
   ```

   O `SNOMED_BASE_URL` deve apontar para a base sob a qual o Snowstorm expõe `/MAIN/concepts` e os endpoints relacionados. O `SNOMED_LANGUAGE` aceita tags `Accept-Language` padrão (ex.: `pt`, `es`, `pt-BR,en;q=0.8`) — o Snowstorm devolve termos localizados quando o branch os tem, e cai para o inglês caso contrário.

4. **Reinicie o cliente MCP** para que o servidor leia as variáveis de ambiente.

Se você definir `ENABLE_SNOMED_TOOLS=true` sem configurar um Snowstorm que funcione, as ferramentas SNOMED serão registradas mas toda chamada falhará na camada de rede.

## Licenças das terminologias

A licença MIT cobre o código do servidor e os metadados mantidos por
ele — **não** o conteúdo terminológico servido através dele, e **não**
os dois conjuntos embutidos (`cid10.json`, `icd10-to-icd11.json`), que
seguem sob os termos próprios deles. O aviso consolidado vai junto com o
pacote, em [NOTICE.md](./NOTICE.md); toda resposta de ferramenta carrega
um bloco de procedência por fonte, com a licença aplicável.

### ICD-11 (OMS)

O conteúdo da ICD-11 é fornecido sob a [licença Creative Commons Atribuição-SemDerivações 3.0 IGO (CC BY-ND 3.0 IGO)](https://creativecommons.org/licenses/by-nd/3.0/igo/), conforme os [Termos de Uso e Acordo de Licença da ICD-11](https://icd.who.int/en/docs/icd11-license.pdf).

- Citação exigida: *"International Classification of Diseases, Eleventh Revision (ICD-11), World Health Organization (WHO) 2019 https://icd.who.int/browse11. Licensed under the Creative Commons Attribution-NoDerivatives 3.0 IGO licence (CC BY-ND 3.0 IGO)."*
- Este servidor sempre serve códigos e títulos da ICD-11 junto com as URIs deles, verbatim; rótulos em outros idiomas são as traduções oficiais da própria OMS (nunca tradução de máquina)
- A OMS pode encerrar a licença a qualquer momento mediante aviso (§4.7)
- O acesso à API exige cadastro em https://icd.who.int/icdapi

### Tabelas de transição ICD-10 → ICD-11 da OMS (embutidas)

Conversão de formato (TSV → JSON, conteúdo inalterado) das tabelas que a OMS publica dentro da release da ICD-11. © Organização Mundial da Saúde, sob os Termos de Uso da ICD-11 — não sob a licença MIT deste projeto. Orientação da OMS: as tabelas mostram correspondência entre revisões e *"não se destinam a converter dados diretamente de uma revisão para a outra."*

### CID-10 V2008 (DataSUS / CBCD, embutida)

© Organização Mundial da Saúde; tradução para o português do Brasil © CBCD / Faculdade de Saúde Pública da USP; arquivos eletrônicos publicados pelo DataSUS (Ministério da Saúde do Brasil). Permissão DataSUS/CBCD: desenvolvedores podem usar os arquivos **com o devido crédito e sem custo** — este servidor os serve de graça e com crédito em toda resposta. Não estão sob a licença MIT deste projeto.

### SNOMED CT

O uso do SNOMED CT exige licença da IHTSDO (SNOMED International). As ferramentas SNOMED deste servidor vêm desligadas por padrão e só são habilitadas por operadores com licença válida e instância Snowstorm própria — veja [Configuração do SNOMED CT (avançado)](#configuração-do-snomed-ct-avançado).

- Países membros têm licença nacional
- Há licença de Afiliado para os demais (o Brasil não é país membro)
- Mais informação: https://www.snomed.org/get-snomed

### LOINC

Este material contém conteúdo do LOINC (http://loinc.org). O LOINC é copyright © Regenstrief Institute, Inc. e do Logical Observation Identifiers Names and Codes (LOINC) Committee, e está disponível sem custo sob a licença em http://loinc.org/license. LOINC® é marca registrada nos Estados Unidos do Regenstrief Institute, Inc.

- Servido pela API gratuita NLM Clinical Tables; todo código vem com o nome de exibição oficial
- Termos com copyright de terceiros são servidos com o aviso repassado verbatim

### RxNorm

O RxNorm é produzido pela U.S. National Library of Medicine; as APIs RxNav servem conteúdo RxNorm de domínio público, não proprietário, sem custo.

> Este produto usa dados publicamente disponíveis da U.S. National Library of Medicine (NLM), National Institutes of Health, Department of Health and Human Services; a NLM não é responsável pelo produto e não o endossa nem o recomenda, nem a qualquer outro produto.

### ATC (via NLM RxClass)

Classificação ATC © WHO Collaborating Centre for Drug Statistics Methodology (https://atcddd.fhi.no/), obtida via NLM RxClass e servida verbatim. Este servidor nunca redistribui o índice ATC/DDD do WHOCC.

### MeSH

O MeSH é obra do governo dos Estados Unidos, servido sob os [Termos e Condições da NLM](https://www.nlm.nih.gov/databases/download/terms_and_conditions.html). Cortesia da U.S. National Library of Medicine.

## Limites de taxa das APIs

Este servidor aplica limite de taxa para respeitar os provedores das APIs:

| API | Limite |
|-----|--------|
| WHO ICD-11 | 5 requisições/segundo |
| NLM (LOINC, MeSH) | 10 requisições/segundo |
| RxNorm | 20 requisições/segundo |
| SNOMED CT (Snowstorm) | 10 requisições/segundo |

## Desenvolvimento

### Compilar a partir do código-fonte

```bash
git clone https://github.com/SidneyBissoli/medical-terminologies-mcp.git
cd medical-terminologies-mcp
npm install
npm run build
```

### Rodar localmente

```bash
npm start
```

### Testar com o MCP Inspector

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Contribuição

Contribuições são bem-vindas! Fique à vontade para abrir um Pull Request.

1. Faça um fork do repositório
2. Crie o seu branch de funcionalidade (`git checkout -b feature/AlgoIncrivel`)
3. Faça o commit das suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Envie para o branch (`git push origin feature/AlgoIncrivel`)
5. Abra um Pull Request

## Autor

**Sidney Bissoli**

- GitHub: [@SidneyBissoli](https://github.com/SidneyBissoli)

## Licença

Este projeto está licenciado sob a licença MIT — veja o arquivo [LICENSE](LICENSE) para os detalhes.

Atenção: embora este software seja MIT, as terminologias médicas acessadas por ele têm licenças próprias (veja [Licenças das terminologias](#licenças-das-terminologias) acima).

## Agradecimentos

- [OMS](https://www.who.int/) pela API da ICD-11
- [Regenstrief Institute](https://loinc.org/) pelo LOINC
- [U.S. National Library of Medicine](https://www.nlm.nih.gov/) pelo RxNorm e pelo MeSH
- [SNOMED International](https://www.snomed.org/) pelo SNOMED CT
- [Anthropic](https://www.anthropic.com/) pelo Model Context Protocol

## Suporte

Se você encontrar algum problema ou tiver dúvidas:

- Abra uma issue no [GitHub](https://github.com/SidneyBissoli/medical-terminologies-mcp/issues)
- Verifique as issues existentes, a solução pode já estar lá

---

Feito com carinho para a comunidade de informática médica
