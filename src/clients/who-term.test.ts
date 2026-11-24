import { describe, expect, it } from 'vitest';
import { termRefs } from './who-client.js';

// WHO `Term` (ICD-API swagger v2, read 2026-11-24): label + optional
// references, never an '@id'. Until 3.2.1 the server read '@id', every `uri`
// vanished from the wire and strict clients rejected icd11_lookup/icf_lookup.
const OWNER = 'http://id.who.int/icd/release/11/2026-01/mms/149933236';
const en = (v: string) => ({ '@language': 'en', '@value': v });

describe('termRefs', () => {
  it('a term of the entity itself points to the entity', () => {
    expect(termRefs([{ label: en('difficult walking') }], OWNER)).toEqual([
      { uri: OWNER, label: 'difficult walking' },
    ]);
  });

  it('a term from another entity points there, release URI first', () => {
    const both = { label: en('x'), foundationReference: 'F', linearizationReference: 'L' };
    const onlyFoundation = { label: en('y'), foundationReference: 'F' };
    expect(termRefs([both, onlyFoundation], OWNER).map((t) => t.uri)).toEqual(['L', 'F']);
  });

  it('drops terms without a label and tolerates an absent list', () => {
    expect(termRefs([{ foundationReference: 'F' }], OWNER)).toEqual([]);
    expect(termRefs(undefined, OWNER)).toEqual([]);
  });
});
