# Gate de segurança — Snyk Agent Scan (2026-08-09)

Gate de fechamento de conformidade (padrão do portfólio, mesmo dos servidores
ilo/uis/ibge).

## Resultado

**PASSOU COM RESSALVA DOCUMENTADA** — enumeração de runtime limpa nas duas
superfícies; um único tipo de achado de análise, severidade **low**, avaliado
como falso positivo (abaixo).

- Scanner: `snyk-agent-scan` v0.5.16 (via `uvx`), autenticado (SNYK_TOKEN).
- Modo: `--ci --dangerously-run-mcp-servers` (STDIO local real — o scanner
  lançou `node dist/index.js` direto, sem ponte `mcp-remote`). Nota de
  invocação: nesta versão o CLI recebe um **arquivo de config MCP**
  (`mcpServers`), não o comando cru — o config usado aponta para o
  `dist/index.js` do repo.
- Alvo: superfície completa da v1.8.0 em DUAS configurações — **default
  (31 tools)** e **`ENABLE_SNOMED_TOOLS=true` (37 tools)** — cada uma com
  3 prompts + 4 resources; tudo enumerado com sucesso; `error: null` nos
  dois servidores (nenhuma falha de runtime).
- Evidência bruta: `2026-08-09-snyk-agent-scan.json`.

## Achado único: W001 "Dangerous Words Detection" (low) — falso positivo

A heurística sinaliza as palavras `vital` e `important` em descrições como
possível linguagem de manipulação do agente. As ocorrências reais são duas,
idênticas nas duas configurações:

1. **`loinc_search`** — "Search for clinical measurements and **vital**
   signs". *Vital signs* é o termo clínico consagrado (sinais vitais) — é o
   próprio domínio da tool, não diretiva ao agente.
2. **Resource `info://licenses`** — "**Important** for downstream
   redistribution decisions and for surfacing license constraints". Ênfase
   factual sobre o papel do notice de licenças — não há inflação de
   prioridade de tool nem instrução para ignorar regras.

A verificação anti-injection do fechamento (descrições sem diretivas de
comportamento) cobre exatamente esse risco e passa.

**Decisão** (precedente ibge W001): não reescrever descrições nesta rodada.
Qualquer mudança de descrição altera a superfície e dispararia o gate
Inspector + smoke em produção por uma troca cosmética sem ganho de segurança
real — e "vital signs" não tem substituto correto em terminologia clínica.

## Limitação conhecida

O scan cobre apenas o transporte STDIO local; o Worker hospedado
(`https://medical.sidneybissoli.com/mcp`) serve a MESMA superfície
(`registerAll` único, dumps byte-idênticos verificados na Sessão 04), então a
enumeração vale para os dois transportes.
