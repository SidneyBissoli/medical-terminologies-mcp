/**
 * `within` on icd11_search / icf_search / cid10_search (PROGRESS.md 24.4b):
 * bound a search to branches of the hierarchy. The rule that matters most:
 * a branch that names nothing is an ERROR, never a silently unbounded search.
 *
 * CID-10 runs on the bundled dataset; the WHO client is stubbed and records
 * the subtrees it was asked to search.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CID10SearchOutput, ICD11SearchOutput, ICFSearchOutput } from '../types/index.js';
import { ApiError } from '../types/index.js';

const REL = 'http://id.who.int/icd/release/11/2026-01';
const seen: { mms: string[][]; icf: string[][] } = { mms: [], icf: [] };

vi.mock('../clients/who-client.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getWHOClient: () => ({
    search: async (_q: string, _l: string, _m: number, subtrees: string[] = []) => {
      seen.mms.push(subtrees);
      return { error: false, destinationEntities: [{ id: `${REL}/mms/1`, theCode: '6A70', title: 'Single episode depressive disorder', score: 1, isLeaf: false, matchingPVs: [] }] };
    },
    searchICF: async (_q: string, _l: string, _m: number, subtrees: string[] = []) => {
      seen.icf.push(subtrees);
      return { error: false, destinationEntities: [{ id: `${REL}/icf/555410497`, theCode: 'd4500', title: 'Walking short distances', score: 1, isLeaf: true }] };
    },
    lookup: async (code: string) => {
      if (code === '5A11') return { '@id': `${REL}/mms/119724091`, code: '5A11', title: { '@value': 'Type 2 diabetes mellitus' } };
      throw new ApiError('not found', 'NOT_FOUND', 404);
    },
    lookupICF: async (code: string) => {
      if (code === 'd450') return { '@id': `${REL}/icf/1550548595`, code: 'd450', title: { '@value': 'Walking' } };
      throw new ApiError('not found', 'NOT_FOUND', 404);
    },
    getChapters: async () => ({ '@id': `${REL}/mms`, child: [`${REL}/mms/334423054`, `${REL}/mms/231358748`] }),
    getEntity: async (uri: string) =>
      uri.endsWith('334423054')
        ? { '@id': uri, code: '06', title: { '@value': 'Mental, behavioural or neurodevelopmental disorders' } }
        : { '@id': uri, code: 'V', title: { '@value': 'Supplementary section for functioning assessment' } },
  }),
}));

const { toolRegistry } = await import('../server-core.js');
await import('../register.js');

async function call<T>(tool: string, args: Record<string, unknown>) {
  const r = await toolRegistry.getHandler(tool)!(args);
  const text = (r.content as { text: string }[]).map((c) => c.text).join('\n');
  return { r, s: r.structuredContent as unknown as T, text };
}

beforeEach(() => {
  seen.mms = [];
  seen.icf = [];
});

describe('icd11_search within', () => {
  it('a chapter number ("6" or "06") becomes that chapter entity, sent as the WHO subtree filter', async () => {
    for (const v of ['6', '06']) {
      const { r, s } = await call<ICD11SearchOutput>('icd11_search', { query: 'depression', within: [v] });
      expect(r.isError).toBeFalsy();
      expect(s.within).toEqual([{ value: v, code: '06', title: 'Mental, behavioural or neurodevelopmental disorders', uri: `${REL}/mms/334423054` }]);
    }
    expect(seen.mms).toEqual([[`${REL}/mms/334423054`], [`${REL}/mms/334423054`]]);
  });

  it('a code resolves through lookup; several branches go together', async () => {
    const { s } = await call<ICD11SearchOutput>('icd11_search', { query: 'diabetes', within: ['5A11', 'V'] });
    expect(s.within.map((b) => b.code)).toEqual(['5A11', 'V']);
    expect(seen.mms[0]).toEqual([`${REL}/mms/119724091`, `${REL}/mms/231358748`]);
  });

  it('a branch that does not exist is an error and nothing is searched', async () => {
    const { r, text } = await call<ICD11SearchOutput>('icd11_search', { query: 'diabetes', within: ['5A11', 'ZZ99'] });
    expect(r.isError).toBe(true);
    expect(text).toContain('Branch "ZZ99" not found in ICD-11');
    expect(seen.mms).toEqual([]);
  });

  it('without within the search is unbounded and says so (within: [])', async () => {
    const { s } = await call<ICD11SearchOutput>('icd11_search', { query: 'diabetes' });
    expect(s.within).toEqual([]);
    expect(seen.mms).toEqual([[]]);
  });
});

describe('icf_search within', () => {
  it('a category code bounds the search to its subtree', async () => {
    const { r, s } = await call<ICFSearchOutput>('icf_search', { query: 'walking', within: ['d450'] });
    expect(r.isError).toBeFalsy();
    expect(s.within).toEqual([{ value: 'd450', code: 'd450', title: 'Walking', uri: `${REL}/icf/1550548595` }]);
    expect(seen.icf).toEqual([[`${REL}/icf/1550548595`]]);
  });

  it('an unknown branch is an error and nothing is searched', async () => {
    const { r, text } = await call<ICFSearchOutput>('icf_search', { query: 'walking', within: ['d999'] });
    expect(r.isError).toBe(true);
    expect(text).toContain('Branch "d999" not found in ICF');
    expect(seen.icf).toEqual([]);
  });
});

describe('cid10_search within (bundled dataset)', () => {
  it('a chapter number keeps only that chapter (infecção: chapter 1 only)', async () => {
    const { s } = await call<CID10SearchOutput>('cid10_search', { query: 'infecção', within: ['1'], max_results: 100 });
    expect(s.within[0]).toMatchObject({ code: 'A00-B99', uri: null });
    expect(s.total_count).toBeGreaterThan(0);
    expect(s.hits.every((h) => h.code >= 'A00' && h.code < 'C00')).toBe(true);
  });

  it('a range keeps its categories; a category keeps its subcategories', async () => {
    const range = await call<CID10SearchOutput>('cid10_search', { query: 'infecção', within: ['N30-N39'] });
    expect(range.s.hits.map((h) => h.display)).toEqual(['N39.0']);
    const cat = await call<CID10SearchOutput>('cid10_search', { query: 'episódio depressivo', within: ['F32'] });
    expect(cat.s.hits.length).toBeGreaterThan(1);
    expect(cat.s.hits.every((h) => h.code.startsWith('F32'))).toBe(true);
  });

  it('a range whose end does not exist is an error, not a guess', async () => {
    const { r, text } = await call<CID10SearchOutput>('cid10_search', { query: 'depressivo', within: ['F30-F35'] });
    expect(r.isError).toBe(true);
    expect(text).toContain('Ramo "F30-F35" não encontrado na CID-10');
  });
});
