import { describe, it, expect } from 'vitest';
import {
  ATTRIBUTION_META_KEY,
  MEDICAL_SOURCES,
  medicalProvenance,
  PROVENANCE_META_KEY,
  provenancedResult,
} from './provenance.js';
import { RANKING_METHOD_NOTE } from './utils/lexical-score.js';

describe('medicalProvenance (canonical block v1.0)', () => {
  it('every source preset carries the legal floor: license + citation + verified_at', () => {
    for (const key of Object.keys(MEDICAL_SOURCES) as Array<keyof typeof MEDICAL_SOURCES>) {
      const p = medicalProvenance(key);
      expect(p.contract_version).toBe('1.0');
      expect(p.license.id ?? p.license.name).toBeTruthy();
      expect(p.license.verified_at).toBe('2026-08-08');
      expect(p.citation.length).toBeGreaterThan(20);
      expect(p.source_url.length).toBeGreaterThan(0);
    }
  });

  it('derived fields carry the derivation note (find_equivalent ranking case)', () => {
    const p = medicalProvenance('WHO_ICD_API', { derived: { note: RANKING_METHOD_NOTE } });
    expect(p.derived).toBe(true);
    expect(p.derivation_note).toBe(RANKING_METHOD_NOTE);

    const raw = medicalProvenance('WHO_ICD_API');
    expect(raw.derived).toBe(false);
    expect(raw.derivation_note).toBeNull();
  });

  it('bundled sources have served_from_cache=null and vintage as the authority', () => {
    const cid10 = medicalProvenance('DATASUS_CID10');
    expect(cid10.served_from_cache).toBeNull();
    expect(cid10.data_vintage).toBe('V2008');

    const tables = medicalProvenance('WHO_TRANSITION_TABLES', {
      dataVintage: '2025-01',
      citationDetail: '2025-01',
    });
    expect(tables.data_vintage).toBe('2025-01');
    expect(tables.citation).toContain('release 2025-01');
  });

  it('the ICD-11 citation is the wording §1.3 of the WHO license mandates', () => {
    const p = medicalProvenance('WHO_ICD_API');
    expect(p.citation).toContain(
      'International Classification of Diseases, Eleventh Revision (ICD-11), World Health Organization (WHO) 2019',
    );
    expect(p.citation).toContain('CC BY-ND 3.0 IGO');
  });
});

describe('provenancedResult (the three channels)', () => {
  it('multi-source responses keep one block per source and dedupe attribution', () => {
    const blocks = [
      medicalProvenance('NLM_RXNAV'),
      medicalProvenance('NLM_RXCLASS_ATC'), // same base URL as RxNav
      medicalProvenance('NLM_MESH'),
    ];
    const result = provenancedResult({ text: '# x', structured: { a: 1 }, provenance: blocks });

    const structured = result.structuredContent as {
      provenance: Array<{ source: string }>;
      attribution: string[];
    };
    expect(structured.provenance).toHaveLength(3);
    // RxNav and RxClass share the canonical URL — the attribution list dedupes.
    expect(structured.attribution).toEqual([
      'https://rxnav.nlm.nih.gov/REST',
      'https://id.nlm.nih.gov/mesh',
    ]);

    const meta = (result as { _meta?: Record<string, unknown> })._meta;
    expect(meta?.[PROVENANCE_META_KEY]).toEqual(structured.provenance);
    expect(meta?.[ATTRIBUTION_META_KEY]).toEqual(structured.attribution);

    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text.startsWith('# x')).toBe(true);
    // English footer, one Source line per block.
    expect(text.match(/^Source: /gm)).toHaveLength(3);
  });

  it('rejects an empty block list — every success must carry provenance', () => {
    expect(() => provenancedResult({ text: 'x', structured: {}, provenance: [] })).toThrow();
  });
});
