/**
 * compose_functioning (PROGRESS.md 24.6) — one functional concept, four roles.
 *
 * Asked by a clinical terminology practitioner (2026-11-23): coding "walking
 * speed" well takes three systems at once — the measure (LOINC), the activity
 * (ICF) and, when there is one, the condition (ICD-11). find_equivalent already
 * returns all three, but as one lexical list with no roles. This tool gives
 * each piece its role and says how each link was found:
 *
 * - ICF → ICD-11 chapter V is READ FROM THE WHO (same entity, or index term),
 *   never guessed — measured 2026-11-24: d450 Walking IS VW13 Walking.
 * - The LOINC measure and the ICD-11 condition are lexical suggestions
 *   (the find_equivalent score), to be reviewed by a person.
 *
 * @author Sidney Bissoli
 * @license MIT
 */

import { Tool, CallToolResult } from '@modelcontextprotocol/server';
import { toolRegistry } from '../server-core.js';
import {
  ComposeFunctioningParamsSchema,
  ComposeFunctioningOutputSchema,
  ComposeFunctioningOutput,
} from '../types/index.js';
import {
  buildInputSchema,
  buildOutputSchema,
  handleToolError,
  READ_ONLY_TOOL_ANNOTATIONS,
} from '../utils/zod-schema.js';
import { bestLabelScore, MATCH_TYPE_NOTE, RANKING_METHOD_NOTE } from '../utils/lexical-score.js';
import { toFhirCoding } from '../utils/fhir-coding.js';
import { plainTitle } from '../utils/plain-title.js';
import { medicalProvenance, provenancedResult, withProvenanceMulti, type Provenance } from '../provenance.js';
import { terminologyProvenance } from './crosswalk.js';
import { icfComponent } from './icf.js';
import { getWHOClient } from '../clients/who-client.js';
import { getNLMClient, loincSynonyms } from '../clients/nlm-client.js';

/** Same pool as find_equivalent: the Clinical Tables order buries exact titles. */
const LOINC_POOL = 50;
/** Wider than `limit` so ranking, not the source order, picks the survivors. */
const WHO_POOL = 25;

const DERIVED_NOTE = `${RANKING_METHOD_NOTE} ${MATCH_TYPE_NOTE} The ICF → ICD-11 counterpart is read from the WHO (same entity or index term), not scored.`;

const NOTE =
  'functioning (ICF) and conditions (ICD-11) and measures (LOINC) are lexical suggestions ranked by this server: review them. ' +
  'icd11_counterpart is different: it is the ICD-11 entity the WHO itself ties to that ICF category (chapter V, "Generic functioning domains"), ' +
  'read from the source — same_entity when they are one WHO entity, index_term when the ICD-11 entity lists the ICF category among its index terms.';

const composeFunctioningTool: Tool = {
  name: 'compose_functioning',
  title: 'Compose a Functional Concept Across Terminologies',
  description: `Code ONE functional concept ("walking speed", "climbing stairs", "using transportation") in the three systems a clinical record needs, each in its role: the function or activity (ICF), the measure (LOINC observation) and the condition (ICD-11), plus the ICD-11 entity the WHO itself ties to each ICF category.

Returns four roles:
- \`functioning\`: ICF categories, each with \`icd11_counterpart\` — the ICD-11 chapter V entity the WHO links to it (d450 Walking → VW13 Walking, the same WHO entity). This link is READ FROM THE WHO (\`same_entity\` or \`index_term\`), never guessed; null when the WHO ties none.
- \`measures\`: LOINC observations ("Walking speed 24 hour mean Calculated"); retired codes dropped.
- \`conditions\`: ICD-11 conditions ("Difficulty in walking"), outside chapter V.

Everything except \`icd11_counterpart\` is a lexical suggestion (the find_equivalent score: \`match_score\`, \`match_type\`, \`matched_label\`) — review it with a person. Every candidate carries its FHIR \`coding\`. Searches in English.

When NOT to use: to search one terminology, use its own search tool; for the same concept across ICD-11, LOINC, RxNorm, MeSH and ICF as one ranked list, use find_equivalent; to pick codes from a value set you already have, use match_value_set.`,
  inputSchema: buildInputSchema(ComposeFunctioningParamsSchema),
  outputSchema: buildOutputSchema(withProvenanceMulti(ComposeFunctioningOutputSchema)),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

type Out = ComposeFunctioningOutput;

const errorText = (e: unknown): string => (e instanceof Error ? e.message : 'Error');

/** Ranks raw candidates by the find_equivalent score; drops those sharing no word. */
function rank<T extends { title: string; synonyms: string[] }>(term: string, raw: T[], limit: number) {
  return raw
    .map((r) => ({ r, best: bestLabelScore(term, r.title, r.synonyms) }))
    .filter((x) => x.best.score > 0)
    // Stable sort: ties keep the source order.
    .sort((a, b) => b.best.score - a.best.score)
    .slice(0, limit)
    .map(({ r, best }) => ({
      r,
      match: {
        match_score: best.score,
        match_type: best.matchType,
        matched_label: best.label === r.title ? null : best.label,
      },
    }));
}

async function functioningRole(term: string, limit: number): Promise<{ role: Out['functioning']; answered: boolean }> {
  const who = getWHOClient();
  let ranked;
  try {
    const response = await who.searchICF(term, 'en', WHO_POOL);
    const raw = (response.destinationEntities ?? [])
      .filter((r) => Boolean(r.theCode))
      .map((r) => ({
        code: r.theCode as string,
        title: plainTitle(r.title),
        uri: r.id ?? null,
        synonyms: (r.matchingPVs ?? []).map((pv) => plainTitle(pv.label)),
      }));
    ranked = rank(term, raw, limit);
  } catch (e) {
    return { role: { error: errorText(e), items: [] }, answered: false };
  }

  // The counterpart check is a second trip per category; a failure there is
  // reported in `error`, never folded into "the WHO ties none".
  const failures: string[] = [];
  const items = await Promise.all(
    ranked.map(async ({ r, match }) => {
      let icd11_counterpart: Out['functioning']['items'][number]['icd11_counterpart'] = null;
      if (r.uri) {
        try {
          const found = await who.icd11CounterpartOfICF(await who.lookupICF(r.uri, 'en'), 'en');
          if (found) {
            const title = found.entity.title?.['@value'] ?? 'Unknown';
            const code = found.entity.code ?? null;
            icd11_counterpart = {
              code,
              title,
              uri: found.entity['@id'],
              link: found.link,
              coding: toFhirCoding('icd11', code ?? '', title, found.entity['@id']),
            };
          }
        } catch (e) {
          failures.push(`${r.code}: ${errorText(e)}`);
        }
      }
      return {
        code: r.code,
        title: r.title,
        component: icfComponent(r.code),
        uri: r.uri,
        ...match,
        coding: toFhirCoding('icf', r.code, r.title),
        icd11_counterpart,
      };
    }),
  );
  return {
    role: {
      error: failures.length > 0 ? `ICD-11 counterpart not checked for ${failures.join('; ')}` : null,
      items,
    },
    answered: true,
  };
}

async function measuresRole(term: string, limit: number): Promise<{ role: Out['measures']; answered: boolean }> {
  try {
    const response = await getNLMClient().searchLOINC(term, LOINC_POOL);
    const raw = (response.items ?? [])
      .filter((r) => !/^deprecated\b/i.test(r.LONG_COMMON_NAME))
      .map((r) => ({ code: r.LOINC_NUM, title: r.LONG_COMMON_NAME, synonyms: loincSynonyms(r) }));
    const items = rank(term, raw, limit).map(({ r, match }) => ({
      code: r.code,
      title: r.title,
      ...match,
      coding: toFhirCoding('loinc', r.code, r.title),
    }));
    return { role: { error: null, items }, answered: true };
  } catch (e) {
    return { role: { error: errorText(e), items: [] }, answered: false };
  }
}

/** Chapter V (functioning, codes V…) and chapter X (extension codes, X…). */
const NOT_A_CONDITION = /^[VX]/i;

async function conditionsRole(term: string, limit: number): Promise<{ role: Out['conditions']; answered: boolean }> {
  try {
    const response = await getWHOClient().search(term, 'en', WHO_POOL);
    const raw = (response.destinationEntities ?? [])
      .filter((r) => Boolean(r.theCode) && !NOT_A_CONDITION.test(r.theCode as string))
      .map((r) => ({
        code: r.theCode as string,
        title: plainTitle(r.title),
        uri: r.id ?? null,
        synonyms: (r.matchingPVs ?? []).map((pv) => plainTitle(pv.label)),
      }));
    const items = rank(term, raw, limit).map(({ r, match }) => ({
      code: r.code,
      title: r.title,
      uri: r.uri,
      ...match,
      coding: toFhirCoding('icd11', r.code, r.title, r.uri),
    }));
    return { role: { error: null, items }, answered: true };
  } catch (e) {
    return { role: { error: errorText(e), items: [] }, answered: false };
  }
}

async function handleComposeFunctioning(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = ComposeFunctioningParamsSchema.parse(args);
    const { term, limit } = params;

    const [functioning, measures, conditions] = await Promise.all([
      functioningRole(term, limit),
      measuresRole(term, limit),
      conditionsRole(term, limit),
    ]);

    const structured: Out = {
      term,
      functioning: functioning.role,
      measures: measures.role,
      conditions: conditions.role,
      note: NOTE,
    };

    const lines: string[] = [`# Functional concept: "${term}"`, ''];
    const section = (heading: string, role: { error: string | null; items: unknown[] }, rows: string[]) => {
      lines.push(`## ${heading}`);
      if (role.error) lines.push(`_Error: ${role.error}_`);
      if (role.items.length === 0 && !role.error) lines.push('_No candidate shares a word with the term._');
      lines.push(...rows, '');
    };
    section(
      'Functioning — ICF',
      functioning.role,
      functioning.role.items.map((i) => {
        const cp = i.icd11_counterpart;
        const tie = cp
          ? ` → ICD-11 \`${cp.code ?? cp.uri}\` ${cp.title} (WHO link: ${cp.link === 'same_entity' ? 'same entity' : 'index term'})`
          : ' → no ICD-11 entity tied by the WHO';
        return `- \`${i.code}\` ${i.title} — ${i.match_type} (${i.match_score.toFixed(3)})${tie}`;
      }),
    );
    section(
      'Measures — LOINC',
      measures.role,
      measures.role.items.map((i) => `- \`${i.code}\` ${i.title} — ${i.match_type} (${i.match_score.toFixed(3)})`),
    );
    section(
      'Conditions — ICD-11',
      conditions.role,
      conditions.role.items.map((i) => `- \`${i.code}\` ${i.title} — ${i.match_type} (${i.match_score.toFixed(3)})`),
    );
    lines.push(`_${NOTE}_`);

    // One block per source that answered. The ICD-11 block also covers the
    // counterpart lookups; every block is derived (ranking is server-side).
    const blocks: Provenance[] = [];
    if (functioning.answered) blocks.push(terminologyProvenance('icf', DERIVED_NOTE));
    if (measures.answered) blocks.push(terminologyProvenance('loinc', DERIVED_NOTE));
    const counterpartAsked = functioning.role.items.some((i) => i.uri);
    if (conditions.answered || counterpartAsked) blocks.push(terminologyProvenance('icd11', DERIVED_NOTE));
    // No source answered: the text is the server's own (as in match_value_set).
    if (blocks.length === 0) blocks.push(medicalProvenance('SERVER_METADATA'));

    return provenancedResult({ text: lines.join('\n'), structured, provenance: blocks });
  } catch (error) {
    return handleToolError(error);
  }
}

toolRegistry.register(composeFunctioningTool, handleComposeFunctioning);
