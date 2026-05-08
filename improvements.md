# Auditoria de melhorias — medical-terminologies-mcp

> Auditoria realizada em 2026-05-07 sobre o estado do repositório local em
> `C:\Users\SIDNEY\OneDrive\programacao\mcp\medical-terminologies-mcp`.
> Versão de pacote: 1.0.2. SDK MCP instalado: 1.25.2.

---

## [P1 — Testes] Status: parcialmente entregue, contract+integration tests deliberadamente diferidos (revisão 2026-05-08)

**Entregue (commit `790eefc`):**

- Vitest setup zero-config, `npm test` script, CI workflow rodando em PR + push to main.
- 116 tests across 5 files, ~330ms:
  - `src/utils/cache.test.ts` — 8 tests (get/set, prefix namespacing, getOrSet semantics)
  - `src/utils/rate-limiter.test.ts` — 8 tests (token bucket, queue, refill)
  - `src/utils/retry.test.ts` — 7 tests (retryable vs non-retryable, exhaustion, callbacks)
  - `src/utils/zod-schema.test.ts` — 9 tests (buildInputSchema/Output, handleToolError, annotations)
  - `src/types/schemas.test.ts` — 58 tests (input validators table-driven, output schemas com fixtures)

**Cobertura prática que isso entrega:**

- Os 58 schema tests cobrem regressões nos 24 handlers que constroem `structuredContent` — qualquer typo de mapeamento camelCase→snake_case falha no TS compile-time (handler usa o tipo inferido) e nos schema tests em runtime se a forma divergir.
- Validação dos regex strict (LOINC, SCTID, MeSH ID, RxCUI) e dos refines (ICD-11 lookup, RxNorm NDC).

**Diferido deliberadamente:**

- Contract tests com `nock`/`msw` para os 5 clients (estimado ~6-8h).
- Integration tests com env flag contra APIs reais (estimado ~4-6h).

**Por que diferido (não "faltando"):** O cenário que motivou o P1 — "se a NLM mudar o formato JSON-LD do MeSH amanhã" — não é capturado por contract tests com snapshots, porque o snapshot é frozen e continua passando. Para esse cenário, integration tests contra APIs reais são necessários. Contract tests sozinhos detectam apenas bugs introduzidos por refatoração interna, classe que TypeScript strict + os 58 schema tests existentes já cobrem parcialmente. Para a faixa de adoção atual (~160 dl/mês), o ROI marginal de 10-14h adicionais não se justifica.

**Reavaliar quando:**

- (a) Primeira regressão real reportada por usuário (sinal de que a rede de proteção runtime via `Schema.parse()` está deixando bugs passarem em produção), OU
- (b) Downloads cruzarem 1.000/mês sustentados (mais usuários = maior custo de regressão por incidente).

Quando reavaliar, fazer o conjunto completo: contract tests + integration tests + cron diário em CI. Não fazer só contract tests — resolve a classe errada de bug.

---

## [P3 — Streamable HTTP transport] Status: deliberadamente diferido (revisão 2026-05-08)

**Estado atual:**

- `src/server.ts` instancia apenas `StdioServerTransport`. `server.json` declara `"transport": { "type": "stdio" }`.
- Não há flag `--http`, não há `StreamableHTTPServerTransport`, não há deploy avaliado em Smithery / Cloudflare Worker / LobeHub.

**Por que diferido (não "faltando"):**

- ~3-4h de trabalho ortogonal aos itens de qualidade interna que constituíram o resto do sweep desta auditoria. Decisão tomada conjuntamente no início do Batch B; ficou registrada apenas em conversação até esta nota.
- Pré-requisito técnico para canais de distribuição hosted (Smithery, Cloudflare Workers, LobeHub), mas a implementação do transport sozinha não move adoção — depende da decisão de produto subsequente de **aplicar** essa distribuição multi-canal.

**Nota sobre classificação:**

Originalmente classificado P3 ("adoção limitada ao caso 'instalo localmente'"). Evidência empírica subsequente sugere que a classificação foi baixa demais: o projeto irmão `bcb-br-mcp` tem ~501 dl/mês com distribuição multi-canal (npm + Smithery + Cloudflare Workers + LobeHub), enquanto este projeto tem ~160 dl/mês via npm-only. A diferença de ~3× provavelmente reflete canal de distribuição mais que qualidade técnica — e Streamable HTTP é pré-requisito técnico para os canais que estão entregando o crescimento. Não estou reclassificando formalmente (auditoria é registro do que se sabia naquele momento), mas a deferral **não deve ser lida como "trivial pra deixar pra depois"**: provavelmente é o item de maior alavancagem de adoção do backlog inteiro.

**Reavaliar quando:**

- (a) **Decisão de aplicar a estratégia multi-canal do `bcb-br-mcp`** (Smithery + Cloudflare Worker + LobeHub). Esse é o trigger mais provável temporalmente — quando vier "vamos publicar em Smithery", o transport HTTP precisa estar pronto. Trigger operacionaliza a frase vaga "fase de divulgação" em uma decisão concreta de replicar uma estratégia que está empiricamente funcionando.
- (b) Demanda explícita de usuário pedindo deploy compartilhado (vários agentes ou múltiplas máquinas com a mesma instância).
- (c) Downloads cruzarem 500/mês sustentados — sinal de que distribuição npm-only está saturando o canal.

Probabilidade temporal: (a) primeiro, depois (c), depois talvez (b). Quando atacar distribuição, começar por aqui — provavelmente entrega mais que vários sprints técnicos juntos.

**Nota de rastreabilidade cruzada:** Quando este item for implementado, reavaliar o P3 *SNOMED com Accept-Language hardcoded* (resolvido via env var `SNOMED_LANGUAGE` no commit `36a4ccb`). A env var resolve o caso operador-único, mas em deploy multi-tenant via HTTP transport (Smithery/Worker), o LLM consumindo o servidor pode precisar propagar idioma do usuário final por chamada — o que requer parâmetro `language` per-tool, complementando a env var. Não está implementado hoje porque adicionar 5 schemas + handlers sem demanda real é over-engineering; quando o cenário multi-tenant virar real (este item resolvido), o param per-tool deixa de ser prematuro.

---

## [P3 — Lacunas de cobertura de terminologias] Status: deliberadamente diferido (revisão 2026-05-08)

**Estado atual:**

- 5 terminologias suportadas (ICD-11, LOINC, RxNorm, MeSH, SNOMED). Sem ATC, CID-10, DSM-5, OPCS-4, CPT, OMIM, CID-O, DICOM SR.
- Decisão tomada conjuntamente no início do Batch B; ficou registrada apenas em conversação até esta nota (mesmo caso da deferral do Streamable HTTP transport acima).

**Por que diferido (não "faltando"):**

A própria auditoria diferenciou explicitamente esse item dos outros: *"Risco de não fazer: Não é risco — é oportunidade."* Distinto qualitativamente das outras duas deferrals deste arquivo:

- P1 testes = **risco** (regressão silenciosa em produção)
- P3 Streamable HTTP = **oportunidade de adoção** (canal de distribuição)
- P3 cobertura de terminologias = **oportunidade de cobertura funcional** (caso de uso brasileiro fora hoje)

Esse é o único dos três que é genuinamente roadmap, não débito. Sustentar a distinção evita que futuro auditor (humano ou IA) trate os três como equivalentes.

**Triagem interna (auditoria já fez):**

- **ATC**: implementar (WHO Collaborating Centre)
- **CID-10**: implementar (DataSUS / CDC XML)
- **DSM-5**: somente documentação (licença APA restritiva)
- **OPCS-4, CPT**: fora (licenças restritivas)
- **OMIM, CID-O, DICOM SR**: fora (nicho insuficiente)

ATC + CID-10 = ~12h. São os dois únicos worth implementing.

**Precisões sobre o framing brasileiro** (importantes para futura implementação):

- **CID-10 não é "equivalente brasileiro" do ICD-11.** É a tradução brasileira oficial (CBCD/USP) da ICD-10 — versão anterior. ICD-11 é a internacional mais nova; o Brasil ainda não adotou oficialmente. Implementar CID-10 não é adicionar "equivalente regional" — é cobrir a versão da ICD que SUS/ANVISA usam operacionalmente hoje. Reforça o argumento de impacto.
- **ATC não tem equivalente brasileiro.** É a classificação internacional WHO Collaborating Centre adotada diretamente por ANVISA, RENAME, Farmácia Popular. Sem camada de adaptação brasileira — só acesso à classificação WHO. Simplifica a implementação (não precisa parser de variante local).

**Reavaliar quando:**

- (a) **Decisão de submeter ao MCP Registry com tag `region:brazil` ou `country:br`**, ou de listar em catálogos brasileiros de software de saúde (GitHub topic `saude-publica-brasil`, blog post na rede brasileira de saúde digital). Operacionaliza a intenção abstrata "posicionar para mercado brasileiro" em ação concreta com data.
- (b) **Pelo menos 1 pedido formal de usuário OU 1 issue no GitHub mencionando uso clínico/governamental brasileiro.** Sinal qualitativo (uso institucional) > quantitativo (contagem de pedidos) — usuários de MCPs raramente abrem issues pedindo features; tipicamente abandonam e procuram alternativa, então threshold de N pedidos pode nunca ser atingido mesmo com demanda real.
- (c) **Decisão de propor o pacote como ferramenta auxiliar em projeto institucional do DataSenado, IBGE, Ministério da Saúde ou similar.** Trigger com maior probabilidade dado o contexto profissional do autor (Analista Legislativo do DataSenado, acesso natural a esses canais). ATC + CID-10 viram pré-requisitos imediatos se o pacote for proposto institucionalmente.

Probabilidade temporal estimada: (c) primeiro, depois (a), depois (b). Esse item, no contexto específico do autor, provavelmente tem retorno por hora maior que vários itens P1/P2 fechados — mas só se materializar via canal institucional. Sem isso, são 12h num projeto solo de ~160 dl/mês com retorno marginal baixo.

---

## [P0 — descoberto após auditoria, 2026-05-08] Backend SNOMED público está fora

- **Categoria:** Cobertura funcional / Robustez
- **Evidência:** Todos os endpoints sob `*.ihtsdotools.org` retornam HTTP 410 Gone, verificado em 2026-05-08 a partir de IPs distintos (Brasil via curl direto, EUA via WebFetch da infra Anthropic). Inclui `https://browser.ihtsdotools.org/`, `/snowstorm/snomed-ct/MAIN/concepts/{sctid}`, `/snowstorm/snomed-ct/MAIN/members?referenceSet=447562003` e o endpoint FHIR em `https://snowstorm.ihtsdotools.org/fhir/metadata`. A resposta vem do origin nginx, não de CDN — é deprecação intencional do servidor.
- **Problema:** O `SNOMEDClient` (`src/clients/snomed-client.ts:31`) aponta para essa URL como base. As 5 tools SNOMED do projeto (`snomed_search`, `snomed_concept`, `snomed_hierarchy`, `snomed_descriptions`, `snomed_ecl`) e a crosswalk `map_snomed_to_icd10` ficam quebradas em produção sem que o usuário típico tenha como saber. `find_equivalent` falha parcialmente quando inclui SNOMED nos targets.
- **Sugestão:** Gatear as 6 tools dependentes de SNOMED por trás de `ENABLE_SNOMED_TOOLS=true` (default off). Tornar `SNOMED_BASE_URL` configurável via env para self-host. Documentar em "SNOMED CT setup (advanced)" no README. Bump de minor version. Resultado: 21 tools default que funcionam, 27 quando o operador tem licença IHTSDO + Snowstorm próprio.
- **Esforço estimado:** M (~2-3 h).
- **Risco de não fazer:** 22% das tools (6/27) falham silenciosamente para 100% dos usuários instalando o pacote.

> Esse achado supera vários P0/P1 originais em prioridade. Foi descoberto por verificação operacional do endpoint antes de implementar a feature P1 "map_snomed_to_icd10 — implementação real via refset 447562003" — a auditoria assumia o endpoint reachable porque o havia visto funcionar em 2026-05-07.

---

## Arquivos lidos

Inspecionados integralmente:

- `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`
- `README.md`, `PROGRESS.md`, `server.json`, `LICENSE` (via metadados)
- `.github/workflows/publish.yml`
- `src/index.ts`, `src/server.ts`
- `src/types/index.ts`
- `src/utils/cache.ts`, `src/utils/logger.ts`, `src/utils/rate-limiter.ts`, `src/utils/retry.ts`
- `src/tools/icd11.ts`, `src/tools/loinc.ts`, `src/tools/rxnorm.ts`, `src/tools/mesh.ts`, `src/tools/snomed.ts`, `src/tools/crosswalk.ts`
- `src/clients/who-client.ts`, `src/clients/nlm-client.ts`, `src/clients/rxnorm-client.ts`, `src/clients/snomed-client.ts`, `src/clients/mesh-client.ts`
- `node_modules/@modelcontextprotocol/sdk/package.json` (para confirmar versão de SDK efetivamente instalada)

Inspecionados via metadados (tamanho, mtime):

- `logs.txt` (0 bytes), `.mcpregistry_github_token` (40 bytes), `.mcpregistry_registry_token` (439 bytes)

Buscas realizadas no repositório:

- `*test*` → **nenhum resultado** (sem testes)
- `*lint*` → **nenhum resultado** (sem ESLint/Biome)
- `CHANGELOG*` → **nenhum resultado** (sem CHANGELOG.md)

---

## Resumo executivo

**Três melhorias de maior alavancagem (alta prioridade × baixo esforço):**

1. **Corrigir a codificação do `README.md` (UTF-16 LE → UTF-8) e adicionar `.mcpregistry_registry_token` ao `.gitignore`.** ~15 min combinados. O README atual tem 16.350 bytes para ~8 mil caracteres de texto — proporção que confirma UTF-16 LE. Isso compromete a renderização na página do pacote no npmjs.com, que é o principal canal de descoberta. O token de registro (439 bytes, formato JWT) está exposto a um eventual `git add .`. Risco e visibilidade altos por esforço trivial.
2. **Eliminar a duplicação de schemas Zod entre `src/types/index.ts` e os arquivos de `src/tools/`.** Schemas estritos (regex de SCTID, RxCUI, LOINC_NUM, MeSH ID) estão definidos no módulo central mas **nunca são importados** — cada tool redefine localmente uma versão frouxa com `z.string().min(1)`. Centralizar elimina classe inteira de bugs silenciosos e remove código morto. ~2–3 h.
3. **Pinar o SDK MCP em vez de usar `"latest"` em `package.json:42`.** Builds não-determinísticos abrem a porta para regressões silenciosas. ~5 min para alterar para `^1.25.2` e `npm install`.

**Ponto forte do projeto que merece destaque:**

A camada `src/utils/` (cache, rate-limiter, retry) é tecnicamente honesta. O `RateLimiter` é uma implementação correta de token bucket com refill fracionário, fila e `tryAcquire`. O `withRetry` faz backoff exponencial com jitter de ±25%, distinção entre erros de rede e códigos HTTP retryables, e expõe um wrapper genérico (`retryable`). O `CacheManager` tem TTLs distintos por classe de dado (STATIC/LOOKUP/SEARCH/TOKEN) e `getOrSet`. Bem feito — não mexa.

**Veredito geral:**

Projeto com arquitetura de baixo nível sólida e cobertura funcional ampla (27 tools, 5 terminologias), mas com problemas significativos de empacotamento (README quebrado, secrets), validação (schemas duplicados/divergentes), e honestidade funcional (3 das 4 ferramentas de crosswalk não fazem mapeamento real). Não está pronto para uso clínico/produção — o que está alinhado com os disclaimers que o próprio servidor emite. Para uso exploratório, didático e de pesquisa, entrega valor real. As correções P0/P1 listadas abaixo são predominantemente de baixo a médio esforço.

---

## Achados detalhados

### [P0] README.md está em UTF-16 LE — pode quebrar a renderização na página do npm

- **Categoria:** Distribuição e deploy / Developer Experience
- **Evidência:** `README.md`. Tamanho de 16.350 bytes para ~8.000 caracteres de texto visível indica codificação de 2 bytes/char. Ao ler o arquivo via API, todo caractere ASCII aparece intercalado com espaço (efeito do byte `0x00` de UTF-16 LE sendo interpretado em outra codificação).
- **Problema:** npmjs.com renderiza markdown assumindo UTF-8. README em UTF-16 (com ou sem BOM) tem comportamento inconsistente: pode aparecer com caracteres invisíveis, espaços entre letras, ou simplesmente vazio. Para um pacote com ~160 downloads/mês cuja descoberta depende da página do npm, isso é dano direto à adoção.
- **Sugestão:** Reescrever o arquivo em UTF-8 sem BOM. No PowerShell: `Get-Content README.md -Encoding Unicode | Set-Content README-utf8.md -Encoding UTF8` e renomear. Adicionar ao `.editorconfig` (criar) `charset = utf-8` para evitar recorrência. Verificar visualmente em `https://www.npmjs.com/package/medical-terminologies-mcp` após nova publicação.
- **Esforço estimado:** P (~10 min).
- **Risco de não fazer:** Página de pacote no npm com aparência amadora; perda de credibilidade no primeiro contato.

---

### [P0] `.mcpregistry_registry_token` (439 bytes, formato JWT) NÃO está no `.gitignore`

- **Categoria:** Segurança
- **Evidência:** `.gitignore` cobre apenas `.mcpregistry_github_token` (linha final). O arquivo `.mcpregistry_registry_token` (mtime 2026-01-19, 439 bytes — tamanho compatível com JWT) está sem proteção.
- **Problema:** Qualquer `git add .` ou commit acidental publica o token. Mesmo que o histórico atual esteja limpo, a janela de exposição existe enquanto o arquivo persistir em working tree sem ignore.
- **Sugestão:** Adicionar `.mcpregistry_registry_token` ao `.gitignore` (de preferência substituir as duas linhas finais por um glob `.mcpregistry_*_token`). Verificar via `git ls-files .mcpregistry_registry_token` se o arquivo já foi commitado em algum momento — se sim, **rotacionar o token imediatamente** e usar `git filter-repo` para limpar o histórico antes de novo push.
- **Esforço estimado:** P (~5 min, mais tempo de rotação se houver vazamento histórico).
- **Risco de não fazer:** Vazamento de credencial de publicação no MCP Registry, com risco de uso indevido (publicação de versões maliciosas em nome do autor).

---

### [P0] `SERVER_INFO.version = '1.0.0'` está hardcoded e diverge do `package.json` (1.0.2)

- **Categoria:** Conformidade com o protocolo MCP
- **Evidência:**
  - `src/server.ts:13` — `version: '1.0.0'`
  - `package.json:4` — `"version": "1.0.2"`
  - `src/clients/snomed-client.ts:53` — `'User-Agent': 'medical-terminologies-mcp/1.0.0'` (mesmo bug, outro lugar)
- **Problema:** Em `initialize` (handshake MCP), o servidor reporta `serverInfo.version` para o cliente. Hoje, quem roda `1.0.2` recebe `1.0.0`. Isso quebra:
  - Triagem de bugs (usuário reporta versão errada).
  - Logs de telemetria do cliente.
  - Eventual feature gating por versão.
  - Conformidade de User-Agent enviado à API SNOMED.
- **Sugestão:** Importar a versão de `package.json` em build time via injeção do esbuild — adicionar ao script de build: `--define:__VERSION__='"'$(node -p "require('./package.json').version")'"'` e referenciar `__VERSION__` em ambos os pontos. Alternativa mais simples: ler `package.json` em runtime no `index.ts` e passar para `createServer()` como parâmetro.
- **Esforço estimado:** P (~30 min com testes manuais).
- **Risco de não fazer:** Bug de observabilidade silencioso, embaraçoso quando reportado por usuários atentos.

---

### [P1] Schemas Zod estritos em `src/types/index.ts` são código morto — tools usam versões frouxas locais

- **Categoria:** Qualidade de código / Conformidade com o protocolo MCP
- **Evidência:**
  - `src/types/index.ts:121` define `LOINCDetailsParamsSchema` com `z.string().regex(/^\d{1,5}-\d$/, 'Invalid LOINC number format')`.
  - `src/tools/loinc.ts:31` redefine `LOINCDetailsParamsSchema = z.object({ loincNum: z.string().min(1) })`. **A regex estrita nunca executa.**
  - Mesmo padrão para SCTID (`/^\d+$/`), RxCUI (`/^\d+$/`), MeSH ID (`/^D\d+$/`), ICD-11 lookup (`.refine()` que valida `code OR uri`). Todos definidos em `types/`, todos ignorados pelos handlers.
  - `src/tools/icd11.ts:289-298` reimplementa manualmente o `.refine` do schema central.
- **Problema:** Validação prometida não acontece. Usuário passa `loinc_num: "abc123"` → handler passa direto para a NLM, que devolve erro genérico `404 NOT_FOUND` em vez de uma mensagem de validação acionável. Pior: o módulo `types/` dá ilusão de robustez que não existe. É também duplicação clara — o esquema vive em dois lugares e pode (vai) divergir.
- **Sugestão:**
  1. Importar os schemas de `types/index.ts` nos tools, removendo as definições locais.
  2. Renomear convenções para alinhar (ver achado P1 sobre `snake_case` vs `camelCase`).
  3. Considerar derivar o `inputSchema` (JSON Schema) do schema Zod com `zod-to-json-schema` — fonte única da verdade.
- **Esforço estimado:** M (~3–4 h, principalmente por causa da reescrita das mensagens de erro de validação consistentes).
- **Risco de não fazer:** Mensagens de erro ruins, validação ausente, debt aumenta a cada nova tool.

---

### [P1] SDK MCP pinado como `"latest"` quebra builds determinísticos

- **Categoria:** Robustez / Distribuição
- **Evidência:** `package.json:42` — `"@modelcontextprotocol/sdk": "latest"`. `package-lock.json` resolve para `1.25.2` no momento, mas `npm install` em uma máquina nova pode resolver para qualquer versão mais recente.
- **Problema:** O SDK MCP teve quebras entre minor releases no passado (mudanças em `Tool` shape, em `CallToolResult`, em transports). Um `npm ci` daqui a duas semanas pode falhar o build sem que ninguém tenha tocado o código. Para um projeto sem testes, regressões silenciosas chegam ao usuário final.
- **Sugestão:** Pinar para `"^1.25.2"` no `package.json` e rodar `npm install` para atualizar o lock. Adicionar Renovate/Dependabot (P3) para PR automático em atualizações.
- **Esforço estimado:** P (~5 min).
- **Risco de não fazer:** Build quebra em momento inesperado; usuários relatam erros de instalação.

---

### [P1] `getParents`/`getChildren` no WHO client + `icd11_chapters` fazem N+1 chamadas sequenciais

- **Categoria:** Robustez e performance
- **Evidência:**
  - `src/clients/who-client.ts:262-275` — `getParents` itera `entity.parent` com `for ... of` e `await this.getEntity(parentUri)` linha a linha.
  - `src/clients/who-client.ts:285-298` — `getChildren` faz o mesmo padrão.
  - `src/tools/icd11.ts:421-434` — `handleICD11Chapters` itera os 28 capítulos com `for ... of` sequencial. Com rate limit de 5 req/s, cada chamada cold leva ≥ 5,6 s só de wait nos tokens.
- **Problema:** Latência percebida pelo usuário cresce linear com o tamanho da hierarquia. O rate limiter já permite paralelismo (5 tokens disponíveis simultaneamente); a serialização forçada do código desperdiça essa capacidade.
- **Sugestão:** Substituir os loops por `Promise.all(uris.map(uri => this.getEntity(uri, language)))`. O `RateLimiter.acquire()` já é a barreira correta — múltiplos `acquire()` paralelos usam os tokens disponíveis e enfileiram o resto. Para `icd11_chapters`, isso reduz de ~5,6 s para ~600 ms cold.
- **Esforço estimado:** P (~30 min, três trechos quase idênticos).
- **Risco de não fazer:** UX ruim em ferramentas de hierarquia; piora se a OMS aumentar o número de filhos por nó.

---

### [P1] Cache de OAuth ignora `expires_in` retornado pela WHO

- **Categoria:** Robustez
- **Evidência:** `src/clients/who-client.ts:108-113` — TTL fixado em `DEFAULT_TTL.TOKEN` (3000 s = 50 min). O campo `tokenResponse.expires_in` é tipado em `OAuthTokenResponse` (`src/types/index.ts:332`) mas **descartado**.
- **Problema:** Se a OMS reduzir a vida do token (já fizeram 30 min em ambientes de teste no passado), o cache vai servir token vencido por até 50 min, gerando 401s em cascata. O fluxo de retry após 401 está implementado (`src/clients/who-client.ts:155-160`), mas custa uma round-trip extra por requisição até o cache expirar.
- **Sugestão:** Calcular TTL como `Math.max(60, expiresIn - 60)` segundos — usa a resposta real da API com 60 s de margem de segurança.
- **Esforço estimado:** P (~10 min).
- **Risco de não fazer:** Latência e taxa de erro elevadas em períodos de instabilidade da WHO.

---

### [P1] `map_icd10_to_icd11` é heurística textual, não mapeamento

- **Categoria:** Cobertura funcional
- **Evidência:** `src/tools/crosswalk.ts:170-180` — o handler simplesmente faz `client.search(code, 'en', 10)`, ou seja, busca textual no índice ICD-11 usando o código ICD-10 como string. A descrição da tool em `crosswalk.ts:53-59` diz "Map an ICD-10 code to ICD-11" / "Find the ICD-11 equivalent".
- **Problema:** Existe a transition table oficial publicada pela OMS (https://icd.who.int/browse11/Downloads/Download → arquivos de mapping ICD-10→ICD-11). A tool atual:
  - Não usa essa fonte autoritativa.
  - Pode retornar matches espúrios (uma busca por "E11" pode encontrar entidades ICD-11 cuja descrição menciona "E11" sem relação real).
  - Apresenta os resultados como "Potential ICD-11 Matches" com score, o que pode induzir o LLM a confiar em falsos positivos.
- **Sugestão:** Duas opções:
  1. **Implementação correta:** baixar (em build time) a transition table oficial e empacotá-la como recurso. Tool consulta a tabela; cai no `search()` apenas como fallback explícito. Documentar claramente.
  2. **Honestidade nominal:** renomear para `icd10_to_icd11_search` ou `icd10_to_icd11_suggest`, e na descrição deixar claro que é busca por similaridade textual, não mapeamento autoritativo.
- **Esforço estimado:** G para opção 1 (8+ h, parsing das tabelas + estratégia de inclusão de dados); P para opção 2 (~30 min).
- **Risco de não fazer:** Uso clínico (apesar dos disclaimers gerais) com resultado errado; LLM cita a tool como fonte de verdade.

---

### [P1] `map_snomed_to_icd10` e `map_loinc_to_snomed` retornam apenas texto descritivo, sem mapeamento

- **Categoria:** Cobertura funcional
- **Evidência:**
  - `src/tools/crosswalk.ts:391-419` — `handleMapSNOMEDToICD10` lista *opções* de onde obter o mapping (SNOMED Reference Set 447562003, NLM UMLS, NHS), mas não consulta nenhuma delas.
  - `src/tools/crosswalk.ts:486-541` — `handleMapLOINCToSNOMED` faz o mesmo padrão: lista UMLS, RELMA, downloads do LOINC, e sugere `snomed_search` com o componente. Não retorna mapping algum.
- **Problema:** O nome da tool promete mapeamento; o output é uma página de FAQ. LLMs vão chamar a tool esperando dados estruturados e receber prosa. Para `SNOMED → ICD-10`, o **Snowstorm público suporta** consulta ao reference set ICD-10 Complex Map (`/MAIN/concepts/{sctid}/refset-members?referenceSet=447562003`) — não exige licença extra além do disclaimer geral SNOMED já tratado.
- **Sugestão:**
  - **`map_snomed_to_icd10`:** implementar consulta real ao refset 447562003 via Snowstorm. Se a chamada falhar/vazia, aí sim cair no texto orientativo.
  - **`map_loinc_to_snomed`:** sem mapping livre disponível, considerar **remover a tool** ou renomear para `loinc_to_snomed_guidance`. Manter algo que se anuncia como `map_*` mas não mapeia é dívida de credibilidade.
- **Esforço estimado:** M (~4 h para a parte SNOMED↔ICD; P para renomear/remover a parte LOINC).
- **Risco de não fazer:** Perda de utilidade real; LLM gasta turno fazendo uma chamada que devolve prosa em vez de dados.

---

### [P1] `find_equivalent` declara `sourceTerminology` mas nunca usa o parâmetro

- **Categoria:** Qualidade de código / Conformidade com o protocolo MCP
- **Evidência:**
  - `src/tools/crosswalk.ts:46-51` — schema declara `sourceTerminology: z.enum([...]).optional()`.
  - `src/tools/crosswalk.ts:131-138` — `inputSchema` JSON também declara `source_terminology`.
  - `src/tools/crosswalk.ts:567-571` — handler faz `params.sourceTerminology = args.source_terminology` mas **a variável nunca é referenciada depois**. Apenas `params.term` e `params.targetTerminologies` são consumidos.
- **Problema:** Parâmetro órfão induz LLM a passar valor sem efeito. Pode causar confusão em debugging ("passei `source_terminology: 'icd11'` e a busca incluiu LOINC mesmo assim").
- **Sugestão:** Decidir o que `sourceTerminology` deveria fazer — provavelmente "excluir essa terminologia da busca cruzada, já que se assume que o termo veio dela". Implementar ou remover. Se remover, atualizar tanto o Zod quanto o JSON Schema.
- **Esforço estimado:** P (~30 min).
- **Risco de não fazer:** Confusão de uso, dead parameter virando armadilha.

---

### [P1] `getLOINCDetails` com `maxList: 1` pode retornar `null` para LOINC válido

- **Categoria:** Robustez
- **Evidência:** `src/clients/nlm-client.ts:175-200` — pede `maxList: 1` e depois faz `findIndex(code => code === loincNum)`. Se o NLM Clinical Tables ranqueia algum outro LOINC acima do exato (por relevância de busca textual), `findIndex` retorna `-1` e a função devolve `null`.
- **Problema:** `loinc_details` falha silenciosamente para LOINCs perfeitamente válidos. Bug de borda real, especialmente para códigos que aparecem como substring de outros (`2-1` é prefixo de muitos).
- **Sugestão:** Aumentar `maxList` para ≥ 7 (ou 10), manter o `findIndex`. Custo: 1 KB extra de payload em troca de correção. Alternativa melhor: usar o endpoint específico de lookup por código se a Clinical Tables API o suporta — verificar https://clinicaltables.nlm.nih.gov/apidoc/loinc_items/v3/doc.html.
- **Esforço estimado:** P (~10 min para a mudança trivial; M se for explorar endpoint melhor).
- **Risco de não fazer:** Bug intermitente difícil de reproduzir, gera relatos do tipo "às vezes funciona, às vezes não".

---

### [P1] Inconsistência de nomenclatura: `inputSchema` em snake_case, Zod em camelCase

- **Categoria:** Qualidade de código
- **Evidência:** Em todos os 6 arquivos de `src/tools/`, o `inputSchema` JSON declara `max_results`, `loinc_num`, `mesh_id`, `active_only`, `source_terminology`, etc. Já os schemas Zod usam `maxResults`, `loincNum`, `meshId`, `activeOnly`, `sourceTerminology`. Cada handler faz a conversão manual:
  - `src/tools/loinc.ts:339` — `loincNum: args.loinc_num`
  - `src/tools/icd11.ts:240` — `maxResults: args.max_results ?? 25`
  - Mesmo padrão em outros handlers, dezenas de linhas de mapeamento manual.
- **Problema:** Toda nova tool reproduz a conversão. Erros de digitação não são pegos pelo TypeScript (porque `args` é `Record<string, unknown>`). Manter os dois lados sincronizados é trabalho contínuo.
- **Sugestão:** Padronizar em `snake_case` (convenção mais comum em APIs MCP) ou `camelCase` em ambos os lados. Se derivar `inputSchema` do Zod via `zod-to-json-schema` (ver achado sobre schemas duplicados), o problema desaparece automaticamente.
- **Esforço estimado:** M (~2 h se feito junto com a centralização de schemas).
- **Risco de não fazer:** Bugs por typo silenciosos; cada nova tool aumenta a superfície.

---

### [P1] Sem `annotations` (`readOnlyHint`, `idempotentHint`, `openWorldHint`) nas tools

- **Categoria:** Conformidade com o protocolo MCP
- **Evidência:** Nenhum dos 27 `Tool` objects em `src/tools/*.ts` declara `annotations`. O SDK 1.25.2 suporta `Tool['annotations']` desde versões anteriores.
- **Problema:** Todas essas tools são **read-only e idempotentes** (busca em APIs públicas de terminologia). Declarar isso ajuda:
  - LLMs a serem mais agressivos no uso (menos confirmações).
  - Clientes MCP a aplicar políticas (ex.: Claude Desktop pode pular confirmação para read-only).
  - Documentação automática em consoles/inspectors.
- **Sugestão:** Adicionar a todas as 27 tools:
  ```typescript
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true, // chamam APIs externas
    destructiveHint: false,
  }
  ```
- **Esforço estimado:** P (~30 min, repetitivo mas simples).
- **Risco de não fazer:** UX subótima em clientes que aproveitariam essas dicas.

---

### [P1] Sem `outputSchema` — todo retorno é texto não-estruturado

- **Categoria:** Conformidade com o protocolo MCP / Cobertura funcional
- **Evidência:** Todos os handlers retornam `{ content: [{ type: 'text', text: '...' }] }`. Nenhuma tool declara `outputSchema` nem usa `structuredContent` em respostas.
- **Problema:** O MCP suporta `structuredContent` desde 2024-11-05. Permite que clientes/LLMs consumam dados tipados em vez de re-parsearem markdown. Para um servidor que entrega listas de códigos, hierarquias e descritores — todos altamente estruturados — entregar só prosa é deixar capacidade na mesa.
- **Sugestão:** Para tools de busca/lookup, adicionar `outputSchema` Zod e retornar `structuredContent` ao lado do `content` textual. Por exemplo, `icd11_search` poderia retornar `{ entities: [{ code, title, score, ... }] }` estruturado, mantendo o markdown como fallback humano-legível.
- **Esforço estimado:** M (~6 h se feito incrementalmente em uma terminologia primeiro).
- **Risco de não fazer:** Outras tools competidoras vão aproveitar `structuredContent` antes; este servidor parece menos moderno.

---

### [P1] Sem testes de qualquer tipo

- **Categoria:** Testes
- **Evidência:** Busca por `*test*` no repo retorna zero resultados. `package.json` não tem script `test`. Sem `jest`, `vitest`, `node:test` em deps.
- **Problema:** 27 tools, 5 clients, 4 utils. Cada deploy é fé. As regressões em parsing de respostas de API (especialmente JSON-LD do MeSH e formato `[totalCount, codes, null, fields]` do LOINC Clinical Tables) são difíceis de pegar manualmente.
- **Sugestão:** Começar pequeno com `vitest` (zero-config para ESM):
  - **Unit tests** para `RateLimiter`, `withRetry` (já testáveis sem mocks).
  - **Contract tests** com `nock` ou `msw` para os 5 clients — fixar JSON real das APIs em fixtures, garantir que a desserialização não quebra.
  - **Integration tests** opcionais com vars de ambiente que rodam contra APIs reais (rate-limited, atrás de um flag).
  - Meta razoável: 60% de cobertura nos `clients/`.
- **Esforço estimado:** G (~16 h para chegar em cobertura útil de clients).
- **Risco de não fazer:** Quebras silenciosas em mudanças de upstream; impossível refatorar com confiança.

---

### [P1] CI só testa publicação, não roda lint/typecheck/testes

- **Categoria:** Sustentabilidade do projeto
- **Evidência:** `.github/workflows/publish.yml` é o único workflow. Roda em `release: created` ou dispatch manual. O job `build` faz `npm ci && npm run build && grep -o "toolRegistry.register" dist/index.js | wc -l`.
- **Problema:**
  - Não há gate de qualidade em PRs.
  - O `tsc --noEmit` mencionado em `PROGRESS.md` como "✅ No errors" não é executado em CI — só localmente.
  - O grep no bundle conta registros mas não garante que cada um é o esperado.
- **Sugestão:** Criar `.github/workflows/ci.yml` separado, disparado em `pull_request` e `push: branches: [main]`, rodando: `npm ci`, `npx tsc --noEmit`, `npm test` (quando houver), `npm run build`. Manter o `publish.yml` exclusivo para release. Adicionar `--provenance` ao `npm publish` para atestação SLSA.
- **Esforço estimado:** P (~45 min).
- **Risco de não fazer:** Bugs de tipo entram no main sem ser pegos.

---

### [P2] `MeSH` client busca o mesmo URL três vezes para descritor/tree/qualifiers

- **Categoria:** Robustez e performance
- **Evidência:** `src/clients/mesh-client.ts:127`, `:156`, `:184` — `getDescriptor`, `getTreeNumbers`, `getAllowedQualifiers` cada um faz `this.request(`/${meshId}.json`)` e cacheia separadamente.
- **Problema:** Chamada cold para os três métodos = 3 requests para a mesma URL. Cache mitiga em chamadas subsequentes, mas a primeira execução é desnecessariamente lenta (3 × rate-limit + 3 × round-trip).
- **Sugestão:** Refatorar para um `_fetchDescriptorRaw(meshId)` privado, cacheado uma vez. Os três métodos públicos consomem o mesmo objeto raw e fazem extração específica. Mantém a API pública igual.
- **Esforço estimado:** P (~45 min).
- **Risco de não fazer:** Latência triplicada em cenários cold.

---

### [P2] `MeSHQualifier.label` e `MeSHConcept.terms` sempre vazios — contrato quebrado

- **Categoria:** Cobertura funcional
- **Evidência:**
  - `src/clients/mesh-client.ts:359` — `label: ''` com comentário "Would need separate lookup to get labels".
  - `src/clients/mesh-client.ts:333-336` — `extractConcepts` constrói `MeSHConcept` com `terms: []` e nunca preenche.
- **Problema:** O tipo `MeSHQualifier` promete `label: string` mas a tool sempre retorna string vazia. A tabela formatada exibe `(lookup required)` (`src/tools/mesh.ts:325`), entregando UX ruim.
- **Sugestão:** Para qualifiers, fazer um lookup paralelo nos URIs encontrados (com `Promise.all` e o rate limiter compartilhado). Custa ≤10 requests extras em casos típicos. Para `concepts.terms`, parsear as triplas `meshv:term` no `@graph` (estão lá no JSON-LD).
- **Esforço estimado:** M (~2 h, requer ler de novo a estrutura JSON-LD do MeSH).
- **Risco de não fazer:** `mesh_qualifiers` continua sendo "lista de IDs sem nome", o que é quase inútil.

---

### [P2] Logging duplo: `pino` + `process.stderr.write` cru espalhado

- **Categoria:** Observabilidade
- **Evidência:**
  - `src/utils/logger.ts` configura `pino` corretamente para stderr (não corromper stdio MCP).
  - `src/server.ts:114, 117, 169, 170` — escreve diretamente em `process.stderr.write(...)` ignorando `pino`.
  - `src/utils/retry.ts:147` — também usa `process.stderr.write` cru.
- **Problema:** Impossível ajustar log level desses pontos. Saída não é estruturada (JSON do pino vs texto cru). Configurar `LOG_LEVEL=warn` deixa esses logs vazando mesmo assim.
- **Sugestão:** Substituir todos os `process.stderr.write` por chamadas equivalentes ao `logger`/`createClientLogger`. Em `retry.ts:147`, expor um logger via opções ou injeção, ou usar o callback `onRetry` que já existe no contrato (`src/utils/retry.ts:21`).
- **Esforço estimado:** P (~45 min).
- **Risco de não fazer:** Observabilidade fragmentada; harder debugging em produção.

---

### [P2] Tools registradas via efeito colateral de import — frágil

- **Categoria:** Qualidade de código
- **Evidência:** `src/index.ts:21-31` — imports como `import './tools/icd11.js';` apenas para disparar `toolRegistry.register(...)` no topo dos módulos (`src/tools/icd11.ts:471-475`).
- **Problema:**
  - Linters podem flaggar como "unused import" ou tree-shaking pode (em outras builds) eliminar.
  - `noUnusedLocals: true` no `tsconfig.json:18` não pega isso porque é import sem nome, mas qualquer mudança no setup pode quebrar.
  - Adicionar/remover tool exige editar dois arquivos.
  - Em `src/tools/icd11.ts:481` há um `registerICD11Tools` exportado e marcado `@deprecated` — código morto consequente desse padrão.
- **Sugestão:** Substituir por `register*Tools()` exportadas explícitas chamadas em `index.ts`, eliminar os side-effects e o código morto. Ou adotar um padrão de descoberta com `import.meta.glob` se preferir auto-registro.
- **Esforço estimado:** P (~1 h).
- **Risco de não fazer:** Pegadinha esperando para acontecer; código morto (`@deprecated`) acumula.

---

### [P2] Shutdown handlers não fecham o transport antes do `process.exit`

- **Categoria:** Robustez
- **Evidência:** `src/index.ts:51-58` — em SIGINT/SIGTERM apenas chama `process.exit(0)`. O `Server` do SDK e o `StdioServerTransport` não são fechados.
- **Problema:** Requisições em andamento são cortadas. Sem flush de logs `pino` (que está com `sync: false` em `src/utils/logger.ts:9`). Em ambientes de orquestração (Docker, systemd), comportamento de shutdown pouco gracioso.
- **Sugestão:**
  ```typescript
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down...');
    await server.close();
    logger.flush?.();
    process.exit(0);
  });
  ```
- **Esforço estimado:** P (~15 min).
- **Risco de não fazer:** Logs perdidos em shutdown; respostas truncadas.

---

### [P2] Tratamento de erro genérico assume `error.response.data` é JSON

- **Categoria:** Robustez
- **Evidência:** Padrão recorrente nos 5 clients: `const message = error.response?.data?.message || error.message;` (ex.: `src/clients/who-client.ts:138`, `nlm-client.ts:74`, `rxnorm-client.ts:64`, `snomed-client.ts:75`, `mesh-client.ts:65`).
- **Problema:** Se a API responde com HTML de erro (proxy 502, página de manutenção, Cloudflare challenge), `data` é uma string e `data.message` é `undefined`. Usuário vê `API error: undefined`. Se `data` é um objeto com formato diferente (ex.: `{ error: { message: '...' } }`), também perde a mensagem.
- **Sugestão:** Helper compartilhado `extractErrorMessage(error: AxiosError): string` que verifica:
  - `data?.message`
  - `data?.error?.message`
  - `data?.error_description` (padrão OAuth)
  - se `data` é string e tamanho < 500, usar trecho
  - fallback `error.message`
- **Esforço estimado:** P (~45 min, refator de 5 clients).
- **Risco de não fazer:** Mensagens de erro inúteis em situações exatamente quando o usuário mais precisa de informação.

---

### [P2] `releaseId` ICD-11 hardcoded em `'2024-01'`

- **Categoria:** Sustentabilidade
- **Evidência:** `src/clients/who-client.ts:18` — `releaseId: '2024-01'`. WHO publica novos releases anualmente.
- **Problema:** A cada ano, o usuário precisa esperar nova versão do pacote para acessar o release atualizado. Atualmente já há `2025-01` disponível em produção da WHO.
- **Sugestão:** Permitir override via env var `WHO_ICD11_RELEASE_ID`, default para `'2024-01'`. Documentar no README.
- **Esforço estimado:** P (~15 min).
- **Risco de não fazer:** Defasagem progressiva em relação à classificação atual.

---

### [P2] `logs.txt` (vazio, 0 bytes) não está coberto por nenhum padrão do `.gitignore`

- **Categoria:** Sustentabilidade
- **Evidência:** `.gitignore:25` cobre `*.log` mas não `logs.txt`. O arquivo `logs.txt` (0 bytes, mtime 2026-01-19) está na raiz.
- **Problema:** Se intencional (destino de logs em runtime), deveria estar no gitignore. Se acidental, deveria ser removido. Em qualquer caso, o estado atual é ambíguo.
- **Sugestão:** Decidir intenção. Se for runtime log: adicionar `logs.txt` ao `.gitignore`. Se acidental: `rm logs.txt`.
- **Esforço estimado:** P (~2 min).
- **Risco de não fazer:** Trivial mas é poluição visual no repo.

---

### [P3] Sem `CHANGELOG.md` separado — changelog vive no `PROGRESS.md`

- **Categoria:** Sustentabilidade / Developer Experience
- **Evidência:** `CHANGELOG*` não encontrado no repo. `PROGRESS.md` tem uma seção "Changelog" no final.
- **Problema:** Convenção npm/GitHub é `CHANGELOG.md` na raiz. Releases automáticos (semantic-release, changesets) esperam esse arquivo. Usuários da página do npm clicam em "Changelog" e não encontram.
- **Sugestão:** Extrair a seção do `PROGRESS.md` para `CHANGELOG.md` no formato Keep a Changelog. Considerar adotar `changesets` para automação futura.
- **Esforço estimado:** P (~30 min).
- **Risco de não fazer:** Ferramentas downstream perdem informação; UX inferior na página do npm.

---

### [P3] Sem `CONTRIBUTING.md`, sem Dependabot/Renovate, sem templates de issue/PR

- **Categoria:** Sustentabilidade
- **Evidência:** `.github/` contém apenas `workflows/publish.yml`. Sem `dependabot.yml`, sem `ISSUE_TEMPLATE/`, sem `PULL_REQUEST_TEMPLATE.md`.
- **Problema:** Para um projeto de saúde digital com superfície de API externa grande (5 APIs), updates de segurança em deps são importantes. PRs externos chegam sem direção.
- **Sugestão:**
  - `.github/dependabot.yml` para `npm` e `github-actions` (semanal).
  - `.github/CONTRIBUTING.md` com fluxo de PR, padrão de commit, como rodar testes (quando houver).
  - Template de bug report focado em qual terminologia/tool reproduz.
- **Esforço estimado:** P (~1 h).
- **Risco de não fazer:** Manutenção a longo prazo fica mais cara; PRs externos têm qualidade variável.

---

### [P3] Sem suporte a Streamable HTTP transport — só stdio

- **Categoria:** Conformidade com o protocolo MCP / Distribuição
- **Evidência:** `src/server.ts:160` instancia apenas `StdioServerTransport`. `server.json` declara `"transport": { "type": "stdio" }`.
- **Problema:** Streamable HTTP é a direção do ecossistema MCP para deploys remotos (Smithery, Cloudflare, hospedagem em geral). Para um servidor que **só consulta APIs públicas** (sem dados privados), há valor real em rodar como serviço HTTP único compartilhado.
- **Sugestão:**
  - Adicionar transporte HTTP via `StreamableHTTPServerTransport` do SDK como segundo modo, ativado por flag CLI (`--http --port 3000`).
  - Avaliar deploy como Smithery server (gerenciado, baixo esforço) ou Cloudflare Worker (zero-cost para volume atual de 160 dl/mês).
- **Esforço estimado:** M (~3-4 h para transporte HTTP funcional; G se incluir deploy em Worker).
- **Risco de não fazer:** Adoção limitada ao caso "instalo localmente"; perde casos de uso "quero acessar de várias máquinas/agentes".

---

### [P3] Lacunas em cobertura de terminologias — vale considerar

- **Categoria:** Cobertura funcional
- **Evidência:** README e `package.json:13-31` listam 5 terminologias. Não há ATC, OPCS-4, CPT, DSM-5, OMIM, CID-10 (ICD-10 nativo), CID-O (oncologia), DICOM SR codes.
- **Problema:** Para um pacote chamado "medical-terminologies-mcp", a ausência de ICD-10 nativo (vs. apenas ICD-11) é notável — muitos sistemas brasileiros e europeus ainda usam CID-10. ATC é a referência padrão para classificação de medicamentos no SUS, ANVISA, e farmacologia internacional.
- **Sugestão (priorizada por impacto-esforço para o contexto do autor):**
  - **ATC** via WHO Collaborating Centre API ou pacote de dados estático (~M esforço).
  - **CID-10** via SUS/CID10 do DataSUS (`http://www2.datasus.gov.br/cid10/V2008/cid10.htm`) ou XML estático do CDC (~M).
  - **DSM-5** restrição de licença APA — provável "documentação apenas" (~P).
  - OPCS-4, CPT: licenças restritivas, deixar fora.
  - DICOM SR codes: nicho, baixa prioridade.
- **Esforço estimado:** Variável; ATC + CID-10 = G no total (~12 h).
- **Risco de não fazer:** Não é risco — é oportunidade. Atende caso de uso brasileiro que está fora hoje.

---

### [P3] SNOMED com `Accept-Language: en` hardcoded

- **Categoria:** Internacionalização
- **Evidência:** `src/clients/snomed-client.ts:55` — header fixo. Snowstorm suporta `pt`, `es`, `fr`, etc. via Accept-Language.
- **Problema:** Mesmo no MAIN, busca/lookup retornam termos em outros idiomas quando suportados. Hardcoding em inglês reduz utilidade fora de audiência anglófona.
- **Sugestão:** Aceitar `language` como parâmetro opcional nas tools SNOMED, propagar para o header. Default `en`.
- **Esforço estimado:** P (~30 min).
- **Risco de não fazer:** UX inferior para usuários que querem termos em PT-BR.

---

### [P3] Sem `npm publish --provenance` em CI

- **Categoria:** Distribuição / Segurança
- **Evidência:** `.github/workflows/publish.yml:53-56` — `npm publish --access public` sem flag de provenance.
- **Problema:** npm 9.5+ suporta SLSA provenance attestations. Para um pacote em healthcare, provenance é sinal de cuidado de supply chain.
- **Sugestão:** Adicionar `--provenance` ao comando publish e `id-token: write` permissions no job. Pré-requisito: o publish.yml já roda em GHA o que é o ambiente certo para provenance.
- **Esforço estimado:** P (~10 min).
- **Risco de não fazer:** Sinal sutil de "pacote não-auditável"; alguns scanners de segurança downgradeiam.

---

## Ordem sugerida de execução

A ordem prioriza valor-por-esforço e dependências explícitas entre achados.

**Sprint 1 (1 dia, melhorias triviais de alto impacto):**

1. Corrigir codificação do `README.md` para UTF-8.
2. Adicionar `.mcpregistry_registry_token` (e `logs.txt`) ao `.gitignore`. Verificar histórico git e rotacionar se necessário.
3. Pinar SDK em `^1.25.2`.
4. Sincronizar versão hardcoded em `server.ts` e `snomed-client.ts` com `package.json` (preferir injeção via build).
5. Trocar loops sequenciais por `Promise.all` em `who-client.ts` e `icd11_chapters`.
6. Cache de OAuth WHO usando `expires_in` real.

**Sprint 2 (2–3 dias, qualidade de código):**

7. Centralizar schemas Zod em `src/types/`, importar nos tools, remover duplicatas.
8. Adicionar `zod-to-json-schema` para derivar `inputSchema` automaticamente — resolve junto a inconsistência snake_case/camelCase.
9. Adicionar `annotations` (`readOnlyHint`, etc.) em todas as tools.
10. Substituir `process.stderr.write` cru por `logger.*` consistente.
11. Substituir registro por side-effect por `register*Tools()` explícito; remover código morto.
12. Helper compartilhado `extractErrorMessage` para todos os clients.
13. Shutdown handlers fechando `server` e flushando `pino`.

**Sprint 3 (1 semana, qualidade funcional):**

14. Implementar mapping real para `map_snomed_to_icd10` via Snowstorm refset 447562003.
15. Decidir destino de `map_loinc_to_snomed` (renomear para `_guidance` ou remover).
16. Renomear ou implementar corretamente `map_icd10_to_icd11`.
17. Resolver `sourceTerminology` órfão em `find_equivalent`.
18. Corrigir `getLOINCDetails` (aumentar `maxList`).
19. Refatorar MeSH client para fetch único; preencher `terms` e `qualifier.label`.
20. Adicionar suporte a `releaseId` configurável e `language` no SNOMED client.

**Sprint 4 (2 semanas, sustentabilidade):**

21. Setup de Vitest + testes de unit e contract.
22. CI workflow para PR (lint+typecheck+test+build).
23. CHANGELOG.md, CONTRIBUTING.md, dependabot.yml, templates.
24. `outputSchema` + `structuredContent` nas tools mais usadas (search, lookup).
25. `npm publish --provenance`.

**Sprint 5 (opcional, expansão):**

26. Streamable HTTP transport.
27. ATC + CID-10 nativo.
28. Avaliar deploy gerenciado (Smithery / Cloudflare Worker).

---

## O que NÃO precisa mudar

Coisas bem feitas que vi durante a auditoria. **Não altere por engano em refatorações.**

- **`src/utils/rate-limiter.ts`** — implementação de token bucket é correta, com refill fracionário, fila assíncrona, `tryAcquire` não-bloqueante e jitter desnecessário (porque rate limiting é determinístico, não probabilístico — a ausência de jitter aqui está certa). Métodos auxiliares (`getAvailableTokens`, `getQueueLength`, `reset`) bem expostos. Os limites por API (5/10/20 req/s) são conservadores em relação ao que as APIs públicas tipicamente toleram.

- **`src/utils/retry.ts`** — `withRetry` faz tudo certo: backoff exponencial com `Math.pow`, cap em `maxDelay`, jitter de ±25%, retryables por status code configuráveis, detecção de erros de rede via mensagem (ECONNRESET, ETIMEDOUT etc.), callback `onRetry` opcional, lança `lastError` no fim. O único pecado é o `process.stderr.write` cru no log, já flagged em outro achado.

- **`src/utils/cache.ts`** — TTLs distintos por tipo de dado é a abordagem certa. `getOrSet` é o pattern idiomático. `useClones: false` é decisão consciente de performance que economiza overhead de clone para objetos imutáveis pós-cache. `clearPrefix` é útil para invalidação por terminologia.

- **`tsconfig.json`** — strict, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`. Configuração madura. **Não relaxe nada disso.**

- **Disclaimer SNOMED** em todas as outputs (`SNOMED_TOOL_DISCLAIMER`) — postura correta dada a licença IHTSDO. Mantenha o padrão.

- **OAuth WHO** com fluxo client_credentials, cache de token, e detecção de 401 para invalidação — a forma do código está certa, só os parâmetros (TTL fixo) que precisam ajuste fino.

- **Singleton lazy de clients** (`getWHOClient()`, `getNLMClient()` etc.) — bom para estado compartilhado de cache e para evitar criação repetida em handlers. Mantenha.

- **Decisão de logar para `stderr`, não `stdout`** (`src/utils/logger.ts:7`) — crítico para não corromper o protocolo MCP em transporte stdio. Comentário no código deixa intent claro. Deixe assim.

- **PROGRESS.md** com tabela de fases e checklist — é uma forma honesta de comunicar status do projeto. Mesmo recomendando extrair changelog para arquivo separado, manter o PROGRESS.md como diário de implementação tem valor.
