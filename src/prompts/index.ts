/**
 * MCP Prompts — high-level, parameterized templates that orchestrate
 * multiple tool calls to answer domain-typical questions. The MCP client
 * (LobeChat, Claude Desktop, etc.) renders them as named user actions
 * with structured arguments; the LLM expands the resulting message and
 * decides which tools to call.
 *
 * These are intentionally orchestration hints, not rigid scripts —
 * the rendered prompt suggests tools but doesn't constrain the LLM.
 *
 * Side-effect imports: every prompt is registered at module load via
 * `promptRegistry.register(...)`. Add new prompts here or in a sibling
 * file, then wire the file in BOTH `src/index.ts` and `src/worker.ts`.
 * The meta-test in `src/index.test.ts` enforces the Node side.
 */

import type { Prompt, GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import { promptRegistry, type PromptHandler } from '../server-core.js';

// --- find-medical-code -------------------------------------------------

const findMedicalCode: Prompt = {
  name: 'find-medical-code',
  description:
    'Search a clinical condition, symptom, or medical term across all available terminologies (ICD-11, LOINC, RxNorm, MeSH, ATC, CID-10) in parallel and synthesize the matches with their codes and source terminology.',
  arguments: [
    {
      name: 'condition',
      description: 'The condition, symptom, or medical term to search for.',
      required: true,
    },
    {
      name: 'language',
      description: 'Preferred language hint — "en" or "pt-BR". When "pt-BR", CID-10 results are prioritized. Defaults to "en".',
      required: false,
    },
  ],
};

const findMedicalCodeHandler: PromptHandler = async (args): Promise<GetPromptResult> => {
  const condition = (args.condition ?? '').trim();
  const language = args.language ?? 'en';
  const isPt = language.toLowerCase().startsWith('pt');

  const text = [
    `Find medical codes for the following clinical concept: "${condition}".`,
    '',
    'Search across all available terminologies in parallel by calling these tools:',
    '- `icd11_search` (WHO ICD-11)',
    '- `loinc_search` (lab/observation codes)',
    '- `rxnorm_search` (drugs)',
    '- `mesh_search` (biomedical concepts)',
    '- `atc_classify` (WHO ATC for drugs)',
    '- `cid10_search` (Brazilian Portuguese ICD-10)',
    '',
    isPt
      ? 'The user prefers Portuguese — prioritize CID-10 matches in the summary and include the official Portuguese names.'
      : 'Synthesize results into a ranked list. For each match, report: code, official label, source terminology.',
    '',
    'If no terminology returns a confident match, say so explicitly rather than guessing. Note: `map_icd10_to_icd11` is currently a text-search heuristic, not an authoritative mapping — surface this caveat if cross-mapping comes up.',
  ].join('\n');

  return {
    description: findMedicalCode.description,
    messages: [
      {
        role: 'user',
        content: { type: 'text', text },
      },
    ],
  };
};

promptRegistry.register(findMedicalCode, findMedicalCodeHandler);

// --- drug-info ---------------------------------------------------------

const drugInfo: Prompt = {
  name: 'drug-info',
  description:
    'Compile comprehensive information about a drug — normalized name, RxCUI, active ingredients, therapeutic classes, and WHO ATC classification — by composing RxNorm and ATC tool calls.',
  arguments: [
    {
      name: 'drug_name',
      description: 'The drug name (brand or generic) to look up. Approximate matches are accepted.',
      required: true,
    },
  ],
};

const drugInfoHandler: PromptHandler = async (args): Promise<GetPromptResult> => {
  const drug = (args.drug_name ?? '').trim();

  const text = [
    `Look up comprehensive information about the drug "${drug}". Use these tools in sequence:`,
    '',
    '1. Call `rxnorm_search` to find the RxCUI for the drug (the canonical RxNorm identifier).',
    '2. With the RxCUI: call `rxnorm_concept` for the normalized name and `rxnorm_ingredients` for the active ingredients.',
    '3. Call `rxnorm_classes` for the therapeutic classes (MoA, EPC, etc.).',
    '4. Call `atc_classify` with the drug name for the WHO ATC classification.',
    '',
    'Summarize the results as a structured report. If RxNorm and ATC categorize the drug differently (e.g. one calls it an antihypertensive, the other a diuretic), note the discrepancy — both can be correct and the reason is usually the level of classification specificity.',
    '',
    'Caveat to surface if relevant: ATC `byId` only resolves levels 1–4 (1–5 char codes); substance-level 7-char codes only return via `byDrugName`.',
  ].join('\n');

  return {
    description: drugInfo.description,
    messages: [
      {
        role: 'user',
        content: { type: 'text', text },
      },
    ],
  };
};

promptRegistry.register(drugInfo, drugInfoHandler);

// --- cid10-portuguese-lookup -------------------------------------------

const cid10PortugueseLookup: Prompt = {
  name: 'cid10-portuguese-lookup',
  description:
    'Procura um termo médico em português no CID-10 brasileiro (DataSUS V2008), com contexto de capítulo e descrição clínica. Searches a Portuguese medical term in the Brazilian CID-10 with chapter context.',
  arguments: [
    {
      name: 'term',
      description: 'Termo médico em português a ser pesquisado (ex.: "infecções respiratórias", "diabetes"). Busca é insensível a acentos.',
      required: true,
    },
  ],
};

const cid10PortugueseLookupHandler: PromptHandler = async (args): Promise<GetPromptResult> => {
  const term = (args.term ?? '').trim();

  const text = [
    `Procure o termo médico "${term}" no CID-10 (Classificação Internacional de Doenças, 10ª revisão, versão brasileira em português — DataSUS V2008).`,
    '',
    'Sequência de chamadas:',
    '1. `cid10_search` para buscar correspondências (a busca é diacritic-insensitive — "infeccoes" encontra "infecções").',
    '2. Para o melhor match, `cid10_lookup` retorna o nome oficial completo.',
    '3. Identifique o capítulo do CID-10 a que o código pertence com `cid10_chapter` (passando o código ou o número/letra do capítulo).',
    '',
    'Apresente o resultado em formato estruturado em português:',
    '- **Código:** (e.g. J18.9)',
    '- **Nome oficial:** (em português)',
    '- **Capítulo:** (número/letra do capítulo + nome do capítulo)',
    '- **Contexto clínico:** breve descrição em português',
    '',
    'Se o termo não retornar resultado confiante, diga isso explicitamente em vez de inventar um código.',
  ].join('\n');

  return {
    description: cid10PortugueseLookup.description,
    messages: [
      {
        role: 'user',
        content: { type: 'text', text },
      },
    ],
  };
};

promptRegistry.register(cid10PortugueseLookup, cid10PortugueseLookupHandler);
