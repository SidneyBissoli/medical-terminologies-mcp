/**
 * match_value_set (PROGRESS.md 24.4) — which code of THIS value set fits
 * this field?
 *
 * Asked by a clinical terminology practitioner (2026-11-23): in a clinical
 * form a field accepts only the codes of one value set, so the useful answer
 * is "the best member of the set", never a code outside it. Full value sets
 * (VSAC) need a UMLS license, so the caller brings the set as a list of codes.
 *
 * 1. Every member is confirmed at its source with the validate_codes logic
 *    (title + FHIR Coding). Unconfirmed members are reported, never ranked.
 * 2. Each term is scored against each confirmed member's title with the
 *    harmonize_terms score (lexical; meaning-based matching is 24.5).
 *
 * @author Sidney Bissoli
 * @license MIT
 */

import { Tool, CallToolResult } from '@modelcontextprotocol/server';
import { toolRegistry } from '../server-core.js';
import {
  MatchValueSetParamsSchema,
  MatchValueSetOutputSchema,
  MatchValueSetOutput,
  ValidateCodesResult,
} from '../types/index.js';
import {
  buildInputSchema,
  buildOutputSchema,
  handleToolError,
  READ_ONLY_TOOL_ANNOTATIONS,
} from '../utils/zod-schema.js';
import {
  bestLabelScore,
  MATCH_TYPE_NOTE,
  RANKING_METHOD_NOTE,
} from '../utils/lexical-score.js';
import { medicalProvenance, provenancedResult, withProvenanceMulti, type Provenance } from '../provenance.js';
import { terminologyProvenance, validateOneCode } from './crosswalk.js';
import { getWHOClient } from '../clients/who-client.js';
import { getNLMClient, loincSynonyms } from '../clients/nlm-client.js';
import { getMeSHClient } from '../clients/mesh-client.js';

/**
 * Synonyms the SOURCE publishes for a confirmed member (24.5a): ICD-11/ICF
 * inclusions and index terms, LOINC related/consumer/short names, MeSH entry
 * terms. The confirmation step just fetched the same records, so these reads
 * are cache hits. Terminologies without published synonyms here (CID-10,
 * ICD-10, RxNorm, ATC) give none; a failure gives none, never an error.
 */
async function memberSynonyms(m: ValidateCodesResult): Promise<string[]> {
  const labels = (xs: { label?: { '@value'?: string } }[] | undefined) =>
    (xs ?? []).map((x) => x.label?.['@value'] ?? '').filter(Boolean);
  try {
    switch (m.terminology) {
      case 'icd11': {
        const e = await getWHOClient().lookup(m.code, 'en');
        return [...labels(e.inclusion), ...labels(e.indexTerm)];
      }
      case 'icf': {
        const e = await getWHOClient().lookupICF(m.code, 'en');
        return [...labels(e.inclusion), ...labels(e.indexTerm)];
      }
      case 'loinc': {
        const d = await getNLMClient().getLOINCDetails(m.code);
        return d ? loincSynonyms(d) : [];
      }
      case 'mesh': {
        const d = await getMeSHClient().getDescriptor(m.code);
        return d ? d.concepts.flatMap((c) => c.terms) : [];
      }
      default:
        return [];
    }
  } catch {
    return [];
  }
}

const DERIVED_NOTE = `${RANKING_METHOD_NOTE} ${MATCH_TYPE_NOTE}`;

const matchValueSetTool: Tool = {
  name: 'match_value_set',
  title: 'Match Terms to a Value Set',
  description: `For each free-text term, pick the best code FROM A VALUE SET YOU PROVIDE — the question "which code of this value set fits this field?".

Send \`terms\` (up to 50) and \`value_set\`: the allowed codes as \`{ code, terminology }\` pairs (up to 100; any of icd11, icd10, cid10, loinc, rxnorm, mesh, atc, icf, mixed if needed). Only those codes can be suggested — never a code outside the set.

How it works: every member is first confirmed at its source (the validate_codes logic), giving its official title and FHIR \`coding\`; members that do not exist or cannot be checked are listed in \`value_set.unconfirmed\` and never ranked. Then each term is scored against each confirmed member's title AND the synonyms its source publishes (ICD-11/ICF inclusions and index terms, LOINC related names, MeSH entry terms): \`match_score\` (lexical, 0-1), \`match_type\` (exact / strong / needs_review, the harmonize_terms rules) and \`matched_label\` (the synonym that scored, or null when the title did). Members sharing no word with the term are left out; a term with none left is \`no_candidates\`.

Lexical only: a synonym the source does NOT publish ("gait speed" for "walking speed") lands in needs_review or no_candidates — review those with a person. Each member is looked up live (cached), so a large set of ICD-11/ICF codes takes a few seconds.

When NOT to use: with no value set, map terms with harmonize_terms; to check a list of codes, use validate_codes.`,
  inputSchema: buildInputSchema(MatchValueSetParamsSchema),
  outputSchema: buildOutputSchema(withProvenanceMulti(MatchValueSetOutputSchema)),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

type Candidate = MatchValueSetOutput['results'][number]['candidates'][number];

/** Same member listed twice (same terminology + code) is checked and ranked once. */
function dedupe<T extends { code: string; terminology: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = `${i.terminology}:${i.code.trim().toUpperCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function handleMatchValueSet(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = MatchValueSetParamsSchema.parse(args);
    const members = dedupe(params.value_set);
    const checked: ValidateCodesResult[] = await Promise.all(members.map(validateOneCode));

    const confirmed = checked.filter((r) => r.valid && r.title);
    const unconfirmed = checked
      .filter((r) => !(r.valid && r.title))
      .map((r) => ({
        code: r.code,
        terminology: r.terminology,
        reason: (r.error !== null ? 'error' : 'not_found') as 'error' | 'not_found',
        error: r.error,
      }));

    const synonyms = await Promise.all(confirmed.map(memberSynonyms));

    const results: MatchValueSetOutput['results'] = params.terms.map((term) => {
      const ranked: Candidate[] = confirmed
        .map((m, i) => {
          const title = m.title as string;
          const best = bestLabelScore(term, title, synonyms[i]);
          return {
            code: m.code,
            terminology: m.terminology,
            title,
            match_score: best.score,
            match_type: best.matchType,
            matched_label: best.label === title ? null : best.label,
            coding: m.coding,
          };
        })
        .filter((c) => c.match_score > 0)
        // Ties keep the order the caller gave the value set in.
        .sort((a, b) => b.match_score - a.match_score)
        .slice(0, params.max_candidates);
      return {
        term,
        status: ranked.length > 0 ? 'matched' : 'no_candidates',
        best: ranked[0] ?? null,
        candidates: ranked,
      };
    });

    const counts = { exact: 0, strong: 0, needs_review: 0, no_candidates: 0 };
    for (const r of results) {
      if (r.best) counts[r.best.match_type]++;
      else counts.no_candidates++;
    }

    const structured: MatchValueSetOutput = {
      value_set: { submitted: params.value_set.length, confirmed: confirmed.length, unconfirmed },
      results,
      counts,
    };

    // Markdown: one row per term; cells escape `\` before `|` (code scanning).
    const cell = (s: string): string => s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
    const lines: string[] = [];
    lines.push('# Value Set Match');
    lines.push('');
    lines.push(
      `Value set: ${params.value_set.length} submitted · ${confirmed.length} confirmed · ${unconfirmed.length} left out` +
        ` — exact ${counts.exact} · strong ${counts.strong} · needs_review ${counts.needs_review} · no_candidates ${counts.no_candidates}`,
    );
    lines.push('');
    lines.push('| # | Term | Match | Best member | Score | Other members |');
    lines.push('|---|------|-------|-------------|-------|---------------|');
    results.forEach((r, i) => {
      const best = r.best ? `${r.best.terminology} \`${r.best.code}\` ${r.best.title}` : '—';
      const others = r.candidates
        .slice(1)
        .map((c) => `${c.terminology} \`${c.code}\` (${c.match_score.toFixed(3)})`)
        .join('; ');
      lines.push(
        `| ${i + 1} | ${cell(r.term)} | ${r.best?.match_type ?? 'no_candidates'} | ${cell(best)} | ${r.best ? r.best.match_score.toFixed(3) : '—'} | ${cell(others) || '—'} |`,
      );
    });
    if (unconfirmed.length > 0) {
      lines.push('');
      lines.push('**Left out of the ranking (not confirmed at the source):** ' +
        unconfirmed.map((u) => `${u.terminology} \`${cell(u.code)}\` (${u.reason})`).join(', '));
    }
    lines.push('');
    lines.push(`_${MATCH_TYPE_NOTE}_`);

    // One block per terminology whose source answered for a member; ranking
    // and match types are computed here, so every block is derived.
    const answered = [...new Set(checked.filter((r) => r.error === null).map((r) => r.terminology))];
    const blocks: Provenance[] =
      answered.length > 0
        ? answered.map((t) => terminologyProvenance(t, DERIVED_NOTE))
        : [medicalProvenance('SERVER_METADATA')];

    return provenancedResult({ text: lines.join('\n'), structured, provenance: blocks });
  } catch (error) {
    return handleToolError(error);
  }
}

toolRegistry.register(matchValueSetTool, handleMatchValueSet);
