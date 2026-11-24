import { describe, expect, it } from 'vitest';
import { WHOClient, type ICD11EntityResponse } from './who-client.js';
import { ApiError } from '../types/index.js';

// PROGRESS.md 24.6, measured in production 2026-11-24: ICD-11 chapter V holds
// the SAME WHO entities as the ICF generic level (d450 Walking = VW13,
// 1550548595), and VW13 lists the finer ICF categories (d4500, 555410497) as
// index terms with their foundationReference. The rule must only ever return
// what the WHO states — never a guess.

const REL = 'http://id.who.int/icd/release/11/2026-01';
const icf = (id: string, parent?: string): ICD11EntityResponse =>
  ({ '@id': `${REL}/icf/${id}`, title: { '@language': 'en', '@value': id }, ...(parent ? { parent: [`${REL}/icf/${parent}`] } : {}) }) as ICD11EntityResponse;

/** A client whose WHO answers come from two in-memory maps (MMS and ICF). */
function client(mms: Record<string, Partial<ICD11EntityResponse>>, icfEntities: Record<string, ICD11EntityResponse> = {}) {
  const c = Object.create(WHOClient.prototype) as WHOClient;
  const calls: string[] = [];
  Object.assign(c, {
    getEntity: async (uri: string) => {
      calls.push(uri);
      const id = uri.split('/mms/')[1];
      const e = mms[id];
      if (!e) throw new ApiError('Resource not found', 'NOT_FOUND', 404);
      return { '@id': uri, ...e };
    },
    lookupICF: async (uri: string) => {
      const id = uri.split('/icf/')[1];
      return icfEntities[id] ?? icf(id);
    },
  });
  return { c, calls };
}

describe('icd11CounterpartOfICF', () => {
  it('same entity in the MMS → same_entity (d450 = VW13)', async () => {
    const { c } = client({ '1550548595': { code: 'VW13', title: { '@language': 'en', '@value': 'Walking' } } });
    const r = await c.icd11CounterpartOfICF(icf('1550548595'));
    expect(r?.link).toBe('same_entity');
    expect(r?.entity.code).toBe('VW13');
  });

  it('finer category listed as an index term of the ancestor → index_term (d4500 → VW13)', async () => {
    const { c } = client({
      '1550548595': {
        code: 'VW13',
        indexTerm: [{ label: { '@language': 'en', '@value': 'Walking short distances' }, foundationReference: 'http://id.who.int/icd/entity/555410497' }],
      },
    });
    const r = await c.icd11CounterpartOfICF(icf('555410497', '1550548595'));
    expect(r).toMatchObject({ link: 'index_term', entity: { code: 'VW13' } });
  });

  it('ancestor in the MMS that does NOT list the category → null, not a guess', async () => {
    const { c } = client({ '1550548595': { code: 'VW13', indexTerm: [] } });
    expect(await c.icd11CounterpartOfICF(icf('555410497', '1550548595'))).toBeNull();
  });

  it('residual categories (…/other) never climb to an ancestor', async () => {
    const { c, calls } = client({ '1550548595': { code: 'VW13' } });
    expect(await c.icd11CounterpartOfICF(icf('1550548595/other', '1550548595'))).toBeNull();
    expect(calls).toEqual([`${REL}/mms/1550548595/other`]);
  });

  it('climbs at most 3 ICF levels', async () => {
    const chain = { '4': icf('4', '3'), '3': icf('3', '2'), '2': icf('2', '1') };
    const { c, calls } = client({}, chain);
    expect(await c.icd11CounterpartOfICF(icf('5', '4'))).toBeNull();
    expect(calls).toHaveLength(4); // itself + 3 ancestors
  });

  it('a source failure propagates (it is not "the WHO ties none")', async () => {
    const c = Object.create(WHOClient.prototype) as WHOClient;
    Object.assign(c, { getEntity: async () => { throw new ApiError('boom', 'API_ERROR', 503); } });
    await expect(c.icd11CounterpartOfICF(icf('1550548595'))).rejects.toThrow('boom');
  });
});
