/**
 * harmonize_terms — free-text clinical terms → ranked standard-code candidates
 * (PROGRESS.md Phase 20.6, 2026-10-03).
 *
 * Origin: the Scripps AI-enablement catalog publishes a recipe ("Harmonize
 * free-text clinical terms to standard codes") that asks, per term, for the
 * top candidates (ICD-11 for diagnoses, RxNorm + ATC for drugs, LOINC for
 * labs), a match_type (exact | strong | needs_review) and the version of each
 * source — and states that nobody had assembled it. Before this tool a user
 * did it call by call. validate_codes covers the CODE-first path; this is the
 * TERM-first one.
 *
 * Design decisions (recorded in PROGRESS.md 20.6):
 * - Hard cap of HARMONIZE_MAX_TERMS per call; above it the call is REFUSED
 *   with the instruction to split (no queueing — the portfolio rule).
 * - Repeated term+domain pairs are looked up once; every submitted row still
 *   gets its own result, in request order.
 * - Drugs use RxNav approximateTerm, NOT /drugs.json: for "metformin" the
 *   latter returns 134 products (combinations first) and no ingredient,
 *   while approximateTerm returns the ingredient (RxCUI 6809). Measured
 *   2026-10-03.
 * - match_score is the find_equivalent formula; match_type is derived from it
 *   (src/utils/lexical-score.ts). Both are server-computed, so every
 *   provenance block carries derived: { note }.
 * - One failed lookup never fails the batch: that row gets status "error".
 * - ICD-11 (1.18.1, measured live on the hosted endpoint): candidates are
 *   scored against the title AND the synonyms WHO says matched, and
 *   postcoordinated clusters are dropped.
 * - Measured live on 2026-10-03 and fixed before release: candidates with
 *   score 0 are dropped ("metfromin" → "merbromin", an antiseptic); LOINC
 *   names starting "Deprecated" are dropped (Clinical Tables leaves STATUS
 *   empty); the strong threshold is 0.85, not 0.8 ("Tylenol" → "Tylenol PM").
 */

import { Tool, CallToolResult } from '@modelcontextprotocol/server';
import { toolRegistry } from '../server-core.js';
import { getWHOClient } from '../clients/who-client.js';
import { getRxNormClient } from '../clients/rxnorm-client.js';
import { getNLMClient } from '../clients/nlm-client.js';
import {
  HarmonizeTermsParamsSchema,
  HarmonizeTermsOutputSchema,
  HARMONIZE_MAX_TERMS,
  type HarmonizeTermsOutput,
  type HarmonizeResult,
  type HarmonizeDomain,
} from '../types/index.js';
import {
  buildInputSchema,
  buildOutputSchema,
  handleToolError,
  READ_ONLY_TOOL_ANNOTATIONS,
} from '../utils/zod-schema.js';
import {
  classifyMatch,
  lexicalScore,
  normalizeForMatch,
  MATCH_TYPE_NOTE,
  RANKING_METHOD_NOTE,
  STRONG_MATCH_MIN_SCORE,
} from '../utils/lexical-score.js';
import {
  medicalProvenance,
  provenancedResult,
  withProvenanceMulti,
  type MedicalSourceKey,
} from '../provenance.js';

/** Upstream candidates fetched per term before lexical re-ranking. */
const UPSTREAM_FETCH = 10;
/** LOINC gets a wider page: its upstream order is weak for generic terms. */
const LOINC_FETCH = 25;
/** Lookups in flight at once; the per-API rate limiters still apply below. */
const CONCURRENCY = 4;

const TERMINOLOGY_BY_DOMAIN = {
  diagnosis: 'icd11',
  drug: 'rxnorm',
  lab: 'loinc',
} as const satisfies Record<HarmonizeDomain, HarmonizeResult['terminology']>;

const DERIVED_NOTE = `${RANKING_METHOD_NOTE} ${MATCH_TYPE_NOTE}`;

const harmonizeTermsTool: Tool = {
  name: 'harmonize_terms',
  title: 'Harmonize Free-Text Terms to Standard Codes',
  description: `Map a LIST of free-text clinical terms to standard codes in one call, with ranked candidates and a confidence label for each — the building block of a reviewable crosswalk.

Use this tool to:
- Harmonize a column of diagnoses, drugs or lab names from a dataset to ICD-11 / RxNorm (+ ATC) / LOINC
- Triage which terms map cleanly (exact / strong) and which need a person (needs_review)
- Build a crosswalk you can audit: every row keeps its candidates, scores and sources

Give each term its \`domain\`: diagnosis → ICD-11; drug → RxNorm concepts (ingredients first) plus the ATC classes of the term; lab → LOINC. Up to ${HARMONIZE_MAX_TERMS} terms per call — a longer list is refused with a validation error: split it into batches of ${HARMONIZE_MAX_TERMS}. Repeated term+domain pairs are looked up once. \`max_candidates\` keeps 1-5 per term (default 3).

Every candidate carries \`match_score\` (lexical, 0-1, the find_equivalent formula) and \`match_type\`: exact = same words after normalization; strong = every term word is in the title (or the matched synonym) and score ≥ ${STRONG_MATCH_MIN_SCORE}; needs_review = anything else. A one-word term is exact or needs_review, never strong ("Tylenol" vs "Tylenol PM" is a different product). Synonyms, abbreviations ("MI", "HbA1c") and misspellings land in needs_review or no_candidates — the label errs toward asking a person. Candidates sharing no word with the term are dropped, as are LOINC codes named "Deprecated". For diagnoses, a candidate is also scored against the synonyms WHO matched (e.g. "hypertension NOS" for Essential hypertension), reported in \`matched_label\`; postcoordinated clusters (codes with "/" or "&") are left out — build those with icd11_postcoordination. Lab names are ambiguous without specimen and property: "glucose" matches over a thousand LOINC codes, so write "glucose serum" or expect needs_review. One failed lookup does not fail the batch: that row comes back with status "error".

Terms are searched in English and sent to the WHO and NLM APIs — de-identify the list first. For Brazilian Portuguese diagnoses use cid10_search; to check codes you already have, use validate_codes; for one term across every terminology, use find_equivalent. Record the vocabulary versions with the provenance blocks (one per source) and terminology_versions.`,
  inputSchema: buildInputSchema(HarmonizeTermsParamsSchema),
  outputSchema: buildOutputSchema(withProvenanceMulti(HarmonizeTermsOutputSchema)),
  annotations: READ_ONLY_TOOL_ANNOTATIONS,
};

interface RawCandidate {
  code: string;
  title: string;
  uri: string | null;
  /** Other labels the SOURCE says matched the term (ICD-11 synonyms); scored too. */
  labels: string[];
}

interface LookupOutcome {
  candidates: RawCandidate[];
  atc: { atc_code: string; atc_name: string }[] | null;
  error: string | null;
  /** Sources that answered (even with zero hits) — one provenance block each. */
  answered: MedicalSourceKey[];
}

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function lookupDiagnosis(term: string): Promise<LookupOutcome> {
  const response = await getWHOClient().search(term, 'en', UPSTREAM_FETCH);
  // Foundation-only hits carry no linearization code — useless in a crosswalk.
  // Postcoordinated clusters ("8C03.0/5A11", "BA41.Z&XY6K") are combinations,
  // not the concept a free-text term names: measured live 2026-10-03, "acute
  // myocardial infarction" got BA41.Z&XY6K (PERIPROCEDURAL MI) as strong.
  // Stem codes only; building clusters is icd11_postcoordination's job.
  const candidates = (response.destinationEntities ?? [])
    .filter((e) => typeof e.theCode === 'string' && e.theCode.length > 0 && Boolean(e.title))
    .filter((e) => !/[/&]/.test(e.theCode as string))
    .map((e) => ({
      code: e.theCode as string,
      title: e.title as string,
      uri: e.id ?? null,
      // WHO matches synonyms ("hypertension NOS" → BA00.Z, its top hit) that
      // the title alone does not show; scoring the title only demoted BA00.Z
      // below "Ocular hypertension" (measured live 2026-10-03).
      labels: (e.matchingPVs ?? []).map((pv) => pv.label).filter((l): l is string => Boolean(l)),
    }));
  return { candidates, atc: null, error: null, answered: ['WHO_ICD_API'] };
}

async function lookupDrug(term: string): Promise<LookupOutcome> {
  const client = getRxNormClient();
  const answered: MedicalSourceKey[] = [];

  // approximateTerm returns one row per (concept, source vocabulary); keep
  // one candidate per RxCUI in upstream order, titled with the RxNorm-sourced
  // name when present (other vocabularies spell it "METFORMIN", "Metformin").
  const matches = await client.getApproximateMatch(term, 25);
  answered.push('NLM_RXNAV');
  const byRxcui = new Map<string, string>();
  const order: string[] = [];
  for (const m of matches) {
    if (!m.rxcui) continue;
    if (!byRxcui.has(m.rxcui)) {
      order.push(m.rxcui);
      byRxcui.set(m.rxcui, '');
    }
    if (!m.name) continue;
    if (m.source === 'RXNORM' || byRxcui.get(m.rxcui) === '') byRxcui.set(m.rxcui, m.name);
  }
  const candidates = order
    .filter((rxcui) => (byRxcui.get(rxcui) ?? '') !== '')
    .slice(0, UPSTREAM_FETCH)
    .map((rxcui) => ({ code: rxcui, title: byRxcui.get(rxcui) as string, uri: null, labels: [] }));

  // ATC is a second, independent source: its failure leaves atc null and does
  // not turn the row into an error.
  let atc: LookupOutcome['atc'] = null;
  try {
    const atcMatches = await client.getATCByDrugName(term);
    answered.push('NLM_RXCLASS_ATC');
    const seen = new Set<string>();
    atc = [];
    for (const a of atcMatches) {
      if (seen.has(a.atc_code)) continue;
      seen.add(a.atc_code);
      atc.push({ atc_code: a.atc_code, atc_name: a.atc_name });
    }
  } catch {
    atc = null;
  }
  return { candidates, atc, error: null, answered };
}

async function lookupLab(term: string): Promise<LookupOutcome> {
  // Clinical Tables orders a generic term poorly ("glucose": 1,031 hits, a
  // breath test first) and leaves STATUS empty, so fetch a wider page for the
  // lexical re-rank and drop retired codes by LOINC's own naming convention
  // (the long common name of a deprecated term starts with "Deprecated").
  const response = await getNLMClient().searchLOINC(term, LOINC_FETCH);
  const candidates = (response.items ?? [])
    .filter((r) => Boolean(r.LOINC_NUM) && Boolean(r.LONG_COMMON_NAME))
    .filter((r) => !/^deprecated\b/i.test(r.LONG_COMMON_NAME))
    .map((r) => ({ code: r.LOINC_NUM, title: r.LONG_COMMON_NAME, uri: null, labels: [] }));
  return { candidates, atc: null, error: null, answered: ['CLINICALTABLES_LOINC'] };
}

async function lookup(term: string, domain: HarmonizeDomain): Promise<LookupOutcome> {
  try {
    if (domain === 'diagnosis') return await lookupDiagnosis(term);
    if (domain === 'drug') return await lookupDrug(term);
    return await lookupLab(term);
  } catch (e) {
    return { candidates: [], atc: null, error: errorMessage(e), answered: [] };
  }
}

/** Runs `tasks` with at most `limit` in flight, preserving result order. */
async function runPooled<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

const cell = (s: string): string => s.replace(/\|/g, '\\|');

async function handleHarmonizeTerms(args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    const params = HarmonizeTermsParamsSchema.parse(args);
    const maxCandidates = params.max_candidates ?? 3;

    // Dedupe by normalized term + domain; the first spelling is the one queried.
    const keyOf = (term: string, domain: HarmonizeDomain): string =>
      `${domain}\u0000${normalizeForMatch(term)}`;
    const unique = new Map<string, { term: string; domain: HarmonizeDomain }>();
    for (const item of params.terms) {
      const key = keyOf(item.term, item.domain);
      if (!unique.has(key)) unique.set(key, { term: item.term, domain: item.domain });
    }
    const keys = [...unique.keys()];
    const outcomes = await runPooled(
      keys.map((key) => () => {
        const { term, domain } = unique.get(key)!;
        return lookup(term, domain);
      }),
      CONCURRENCY,
    );
    const outcomeByKey = new Map(keys.map((key, i) => [key, outcomes[i]]));

    const results: HarmonizeResult[] = params.terms.map((item, index) => {
      const outcome = outcomeByKey.get(keyOf(item.term, item.domain))!;
      const ranked = outcome.candidates
        .map((c, upstreamIndex) => {
          // Best of the title and the labels the source matched; the label
          // that won is reported, so a person sees WHY it scored.
          let best = { label: c.title, score: lexicalScore(item.term, c.title) };
          for (const label of c.labels) {
            const score = lexicalScore(item.term, label);
            if (score > best.score) best = { label, score };
          }
          return { ...c, upstreamIndex, match_score: best.score, scoredLabel: best.label };
        })
        // No word in common is not a candidate: RxNav's spelling tolerance
        // turned "metfromin" into "merbromin" (an antiseptic) at score 0.
        .filter((c) => c.match_score > 0)
        .sort((a, b) => b.match_score - a.match_score || a.upstreamIndex - b.upstreamIndex)
        .slice(0, maxCandidates)
        .map((c) => ({
          code: c.code,
          title: c.title,
          uri: c.uri,
          match_score: c.match_score,
          match_type: classifyMatch(item.term, c.scoredLabel, c.match_score),
          matched_label: c.scoredLabel === c.title ? null : c.scoredLabel,
        }));
      const status: HarmonizeResult['status'] =
        outcome.error !== null ? 'error' : ranked.length > 0 ? 'matched' : 'no_candidates';
      return {
        index,
        term: item.term,
        domain: item.domain,
        terminology: TERMINOLOGY_BY_DOMAIN[item.domain],
        status,
        match_type: ranked[0]?.match_type ?? null,
        candidates: ranked,
        atc: item.domain === 'drug' && outcome.error === null ? outcome.atc : null,
        error: outcome.error,
      };
    });

    const counts = { exact: 0, strong: 0, needs_review: 0, no_candidates: 0, error: 0 };
    for (const r of results) {
      if (r.status === 'error') counts.error++;
      else if (r.status === 'no_candidates') counts.no_candidates++;
      else if (r.match_type) counts[r.match_type]++;
    }

    const lines: string[] = [];
    lines.push('# Term Harmonization');
    lines.push('');
    lines.push(
      `Terms: ${results.length} (${unique.size} distinct lookups) · exact: ${counts.exact} · strong: ${counts.strong} · needs review: ${counts.needs_review} · no candidates: ${counts.no_candidates} · errors: ${counts.error}`,
    );
    lines.push('');
    lines.push('| # | Term | Domain | Match | Best candidate | Score | Other candidates |');
    lines.push('|---|------|--------|-------|----------------|-------|------------------|');
    for (const r of results) {
      const best = r.candidates[0];
      const bestCell = best ? `${best.code} — ${best.title}` : r.error ? `⚠️ ${r.error}` : 'no candidates';
      const others = r.candidates
        .slice(1)
        .map((c) => `${c.code} (${c.match_score.toFixed(2)})`)
        .join(', ');
      const atcNote = r.atc && r.atc.length > 0 ? ` · ATC ${r.atc.map((a) => a.atc_code).join(', ')}` : '';
      lines.push(
        `| ${r.index + 1} | ${cell(r.term)} | ${r.domain} | ${r.match_type ?? '—'} | ${cell(bestCell)}${cell(atcNote)} | ${best ? best.match_score.toFixed(3) : '—'} | ${cell(others) || '—'} |`,
      );
    }
    lines.push('');
    lines.push(`_${MATCH_TYPE_NOTE}_`);

    const structured: HarmonizeTermsOutput = {
      total: results.length,
      unique_lookups: unique.size,
      counts,
      results,
      ranking: { method: 'lexical', note: DERIVED_NOTE },
    };

    // One block per source that answered at least once; none answered →
    // the server block keeps the provenance channel present.
    const answered = [...new Set(outcomes.flatMap((o) => o.answered))];
    const blocks =
      answered.length > 0
        ? answered.map((source) => medicalProvenance(source, { derived: { note: DERIVED_NOTE } }))
        : [medicalProvenance('SERVER_METADATA')];

    return provenancedResult({ text: lines.join('\n'), structured, provenance: blocks });
  } catch (error) {
    return handleToolError(error);
  }
}

toolRegistry.register(harmonizeTermsTool, handleHarmonizeTerms);
