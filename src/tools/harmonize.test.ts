/**
 * Handler tests for harmonize_terms (PROGRESS.md 20.6).
 *
 * Clients are stubbed at the module boundary (vi.mock) and COUNT their calls,
 * so these tests pin the tool's own decisions: match_type classification,
 * ranking, dedupe (one lookup per term+domain), the hard cap (refused, not
 * queued), per-row failure isolation, the RxNorm-sourced name for a drug
 * candidate, and dropping ICD-11 hits without a linearization code.
 * Upstream parsing stays in the clients' contract tests.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toolRegistry } from '../server-core.js';
import { HarmonizeTermsOutputSchema, type HarmonizeTermsOutput } from '../types/index.js';
import { classifyMatch, lexicalScore } from '../utils/lexical-score.js';

const calls = { who: 0, approx: 0, atc: 0, loinc: 0 };
let failLoinc = false;
let failAtc = false;

vi.mock('../clients/who-client.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getWHOClient: () => ({
    search: async (term: string) => {
      calls.who++;
      if (term.includes('nothing')) return { destinationEntities: [] };
      if (term === 'hypertension') {
        // Live shape (2026-10-03): WHO's top hit matched through a SYNONYM;
        // the title alone scores below "Ocular hypertension".
        return {
          destinationEntities: [
            {
              id: 'http://id.who.int/icd/release/11/2026-01/mms/761947693/unspecified',
              theCode: 'BA00.Z',
              title: 'Essential hypertension, unspecified',
              matchingPVs: [{ propertyId: 'Synonym', label: 'hypertension NOS', score: 1 }],
            },
            { id: 'http://id.who.int/icd/release/11/2026-01/mms/535283437', theCode: '9C61.01', title: 'Ocular hypertension', matchingPVs: [] },
            // Postcoordinated cluster — must be dropped.
            { id: 'x', theCode: 'BA01/BD1Z', title: 'Hypertensive heart disease with heart failure', matchingPVs: [] },
          ],
        };
      }
      return {
        destinationEntities: [
          // Foundation-only hit: no theCode — must be dropped.
          { id: 'http://id.who.int/icd/entity/1', title: 'Diabetes mellitus' },
          { id: 'http://id.who.int/icd/release/11/2026-01/mms/2', theCode: '5A11', title: 'Type 2 diabetes mellitus' },
          { id: 'http://id.who.int/icd/release/11/2026-01/mms/3', theCode: '5A14', title: 'Diabetes mellitus, type unspecified' },
          // Postcoordinated cluster (live: "type 2 diabetes" brought this) — dropped.
          { id: 'y', theCode: '8C03.0/5A11', title: 'Diabetic polyneuropathy [Type 2 diabetes mellitus]' },
          { id: 'z', theCode: 'BA41.Z&XY6K', title: 'Acute periprocedural myocardial infarction' },
        ],
      };
    },
  }),
}));

vi.mock('../clients/rxnorm-client.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getRxNormClient: () => ({
    getApproximateMatch: async () => {
      calls.approx++;
      return [
        { rxcui: '6809', rxaui: '', name: '', source: 'GS', score: 11, rank: 1 },
        { rxcui: '6809', rxaui: '', name: 'METFORMIN', source: 'VANDF', score: 11, rank: 1 },
        { rxcui: '6809', rxaui: '', name: 'metformin', source: 'RXNORM', score: 11, rank: 1 },
        { rxcui: '235743', rxaui: '', name: 'metformin hydrochloride', source: 'RXNORM', score: 9, rank: 2 },
        { rxcui: '999', rxaui: '', name: '', source: 'NDDF', score: 5, rank: 3 }, // no name anywhere: dropped
      ];
    },
    getATCByDrugName: async () => {
      calls.atc++;
      if (failAtc) throw new Error('RxClass down');
      return [
        { rxcui: '6809', drug_name: 'metformin', tty: 'IN', atc_code: 'A10BA02', atc_name: 'metformin', atc_level_type: '5' },
        { rxcui: '6809', drug_name: 'metformin', tty: 'IN', atc_code: 'A10BA02', atc_name: 'metformin', atc_level_type: '5' },
      ];
    },
  }),
}));

vi.mock('../clients/nlm-client.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getNLMClient: () => ({
    searchLOINC: async () => {
      calls.loinc++;
      if (failLoinc) throw new Error('Clinical Tables timeout');
      return {
        totalCount: 4,
        items: [
          // Retired code, named the LOINC way — must be dropped (live, 2026-10-03).
          { LOINC_NUM: '104708-3', LONG_COMMON_NAME: 'Deprecated Glucose [Moles/volume] in Blood' },
          { LOINC_NUM: '2345-7', LONG_COMMON_NAME: 'Glucose [Mass/volume] in Serum or Plasma' },
          { LOINC_NUM: '2339-0', LONG_COMMON_NAME: 'Glucose [Mass/volume] in Blood' },
          // Shares no word with "glucose" — must be dropped.
          { LOINC_NUM: '4548-4', LONG_COMMON_NAME: 'Hemoglobin A1c/Hemoglobin.total in Blood' },
        ],
      };
    },
  }),
}));

// Side-effect import — registers harmonize_terms (after the mocks are hoisted).
await import('./harmonize.js');

async function call(args: Record<string, unknown>) {
  return toolRegistry.getHandler('harmonize_terms')!(args);
}

async function harmonize(args: Record<string, unknown>): Promise<HarmonizeTermsOutput> {
  const result = await call(args);
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  const parsed = HarmonizeTermsOutputSchema.safeParse(result.structuredContent);
  expect(parsed.success).toBe(true);
  return parsed.success ? parsed.data : (undefined as never);
}

describe('classifyMatch', () => {
  const cls = (term: string, title: string) => classifyMatch(term, title, lexicalScore(term, title));

  it('exact = same words after normalization (case, accents, punctuation)', () => {
    expect(cls('Type-2 Diabetes', 'type 2 diabetes')).toBe('exact');
  });
  it('strong = every term word present and score >= 0.85', () => {
    expect(cls('type 2 diabetes', 'Type 2 diabetes mellitus')).toBe('strong');
    expect(cls('atorvastatin 20 mg', 'atorvastatin 20 MG Oral Tablet')).toBe('strong');
  });
  it('a one-word term is never strong: "Tylenol" → "Tylenol PM" is another product (live, 2026-10-03)', () => {
    expect(lexicalScore('Tylenol', 'Tylenol PM')).toBe(0.833);
    expect(cls('Tylenol', 'Tylenol PM')).toBe('needs_review');
    expect(cls('metformin', 'metformin hydrochloride')).toBe('needs_review');
  });
  it('needs_review = a generic term inside a longer title', () => {
    expect(lexicalScore('diabetes', 'Type 2 diabetes mellitus')).toBe(0.7);
    expect(cls('diabetes', 'Type 2 diabetes mellitus')).toBe('needs_review');
  });
  it('needs_review = a score >= 0.85 that still misses a term word', () => {
    // 5 of 6 term words, title = those 5: 0.871 — the token rule blocks it.
    const term = 'acute st elevation myocardial infarction anterior';
    const title = 'Acute ST elevation myocardial infarction';
    expect(lexicalScore(term, title)).toBeGreaterThanOrEqual(0.85);
    expect(cls(term, title)).toBe('needs_review');
  });
  it('needs_review = synonyms and abbreviations (lexical only)', () => {
    expect(cls('MI', 'Acute myocardial infarction')).toBe('needs_review');
  });
});

describe('harmonize_terms', () => {
  beforeEach(() => {
    calls.who = 0;
    calls.approx = 0;
    calls.atc = 0;
    calls.loinc = 0;
    failLoinc = false;
    failAtc = false;
  });

  it('ranks candidates, labels them, and keeps request order', async () => {
    const out = await harmonize({
      terms: [
        { term: 'type 2 diabetes mellitus', domain: 'diagnosis' },
        { term: 'metformin', domain: 'drug' },
        { term: 'glucose', domain: 'lab' },
      ],
    });
    expect(out.results.map((r) => r.index)).toEqual([0, 1, 2]);

    const dx = out.results[0];
    expect(dx.terminology).toBe('icd11');
    expect(dx.candidates.map((c) => c.code)).toEqual(['5A11', '5A14']); // codeless foundation hit + clusters dropped
    expect(dx.match_type).toBe('exact');
    expect(dx.candidates[0].uri).toContain('/mms/2');
    expect(dx.atc).toBeNull();

    const drug = out.results[1];
    expect(drug.candidates[0]).toMatchObject({ code: '6809', title: 'metformin', match_type: 'exact' });
    expect(drug.candidates.map((c) => c.code)).not.toContain('999');
    expect(drug.atc).toEqual([{ atc_code: 'A10BA02', atc_name: 'metformin' }]); // deduped

    const lab = out.results[2];
    expect(lab.match_type).toBe('needs_review'); // LOINC names pin a specimen
    expect(lab.candidates.map((c) => c.code)).toEqual(['2339-0', '2345-7']); // deprecated + score-0 dropped
    expect(out.counts).toEqual({ exact: 2, strong: 0, needs_review: 1, no_candidates: 0, error: 0 });
  });

  it('scores ICD-11 against the synonyms WHO matched and reports the winning label', async () => {
    const out = await harmonize({ terms: [{ term: 'hypertension', domain: 'diagnosis' }] });
    const [first, second] = out.results[0].candidates;
    // Title alone: 0.75 (BA00.Z) < 0.833 (Ocular). Synonym "hypertension NOS": 0.833, and the
    // tie keeps WHO's order — BA00.Z first, as WHO ranked it.
    expect(first).toMatchObject({ code: 'BA00.Z', match_score: 0.833, matched_label: 'hypertension NOS', match_type: 'needs_review' });
    expect(second).toMatchObject({ code: '9C61.01', matched_label: null });
    expect(out.results[0].candidates.map((c) => c.code)).not.toContain('BA01/BD1Z');
  });

  it('caps candidates per term with max_candidates', async () => {
    const out = await harmonize({ terms: [{ term: 'diabetes', domain: 'diagnosis' }], max_candidates: 1 });
    expect(out.results[0].candidates).toHaveLength(1);
  });

  it('looks up a repeated term+domain once, but answers every row', async () => {
    const out = await harmonize({
      terms: [
        { term: 'Glucose', domain: 'lab' },
        { term: 'glucose ', domain: 'lab' },
        { term: 'glucose', domain: 'diagnosis' },
      ],
    });
    expect(calls.loinc).toBe(1);
    expect(calls.who).toBe(1);
    expect(out.total).toBe(3);
    expect(out.unique_lookups).toBe(2);
    expect(out.results).toHaveLength(3);
  });

  it('refuses more than 50 terms with the instruction to split', async () => {
    const terms = Array.from({ length: 51 }, (_, i) => ({ term: `term ${i}`, domain: 'lab' }));
    const result = await call({ terms });
    expect(result.isError).toBe(true);
    const text = (result.content?.[0] as { text?: string }).text ?? '';
    expect(text).toMatch(/50/);
    expect(text).toMatch(/batches/i);
    expect(calls.loinc).toBe(0);
  });

  it('one failing lookup marks only its row as error', async () => {
    failLoinc = true;
    const out = await harmonize({
      terms: [
        { term: 'glucose', domain: 'lab' },
        { term: 'type 2 diabetes mellitus', domain: 'diagnosis' },
      ],
    });
    expect(out.results[0]).toMatchObject({ status: 'error', match_type: null, candidates: [] });
    expect(out.results[0].error).toMatch(/timeout/);
    expect(out.results[1].status).toBe('matched');
    expect(out.counts.error).toBe(1);
  });

  it('an ATC failure leaves atc null without failing the drug row', async () => {
    failAtc = true;
    const out = await harmonize({ terms: [{ term: 'metformin', domain: 'drug' }] });
    expect(out.results[0].status).toBe('matched');
    expect(out.results[0].atc).toBeNull();
  });

  it('a source that answers with nothing gives no_candidates', async () => {
    const out = await harmonize({ terms: [{ term: 'nothing here', domain: 'diagnosis' }] });
    expect(out.results[0]).toMatchObject({ status: 'no_candidates', match_type: null, candidates: [] });
    expect(out.counts.no_candidates).toBe(1);
  });

  it('carries one provenance block per answering source and declares the method', async () => {
    const result = await call({
      terms: [
        { term: 'diabetes', domain: 'diagnosis' },
        { term: 'metformin', domain: 'drug' },
      ],
    });
    const structured = result.structuredContent as {
      provenance: { source: string }[];
      ranking: { method: string; note: string };
    };
    expect(structured.provenance.map((b) => b.source)).toEqual([
      'WHO ICD-API (ICD-11)',
      'RxNorm (NLM RxNav API)',
      'ATC via NLM RxClass',
    ]);
    // The concise block drops `derived`; the method travels in the payload.
    expect(structured.ranking.method).toBe('lexical');
    expect(structured.ranking.note).toContain('match_type is computed by this server');
  });
});
