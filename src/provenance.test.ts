import { describe, it, expect } from 'vitest';
import { createProvenanceContext, renderConcise } from '@sbissoli/mcp-provenance';
import {
  ATTRIBUTION_META_KEY,
  MEDICAL_SOURCES,
  medicalProvenance,
  PROVENANCE_META_KEY,
  provenanceContext,
  provenancedResult,
} from './provenance.js';
import { RANKING_METHOD_NOTE } from './utils/lexical-score.js';

const SOURCE_KEYS = Object.keys(MEDICAL_SOURCES) as Array<keyof typeof MEDICAL_SOURCES>;

describe('medicalProvenance (canonical block)', () => {
  it('every source preset carries the legal floor: license + citation + verified_at', () => {
    for (const key of SOURCE_KEYS) {
      const p = medicalProvenance(key);
      expect(p.contract_version).toBe('1.2');
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

describe('contract 1.2 on the wire (step two of 1.2): no byte changes', () => {
  // This server never passes `field_sources` (multi-source responses carry one
  // block per source), so emitting 1.2 must leave every channel as 1.1 left it.
  const ctx11 = createProvenanceContext({
    metaNamespace: 'com.sidneybissoli.medical',
    locale: 'en',
    timezone: 'utc',
    defaultMode: 'concise',
  });

  it('the context emits 1.2', () => {
    expect(provenanceContext.contractVersion).toBe('1.2');
  });

  it('concise block and footer are byte-identical to the 1.1 rendering, for every source', () => {
    for (const key of SOURCE_KEYS) {
      const p = medicalProvenance(key);
      const as11 = { ...p, contract_version: '1.1' as const };
      expect(JSON.stringify(renderConcise(p))).toBe(JSON.stringify(renderConcise(as11)));
      expect(renderConcise(p)).not.toHaveProperty('field_sources');
      expect(provenanceContext.footer([p])).toBe(ctx11.footer([as11]));
    }
    // A derived block (find_equivalent ranking) too.
    const d = medicalProvenance('NLM_MESH', { derived: { note: RANKING_METHOD_NOTE } });
    const d11 = { ...d, contract_version: '1.1' as const };
    expect(JSON.stringify(renderConcise(d))).toBe(JSON.stringify(renderConcise(d11)));
    expect(provenanceContext.footer([d])).toBe(ctx11.footer([d11]));
  });
});

describe('revision (contract 1.3, informed now, emitted from 1.3 on)', () => {
  it('the canonical block carries revision current for every source, the bundled CID-10 included', () => {
    for (const key of SOURCE_KEYS) {
      const p = medicalProvenance(key);
      expect(p.revision?.status, key).toBe('current');
    }
    // `final` needs proof from the source — not claimed for the frozen V2008.
    expect(medicalProvenance('DATASUS_CID10').revision).toEqual({
      status: 'current',
      note: 'Frozen since 2008: DataSUS has not published a successor to V2008.',
    });
    expect(medicalProvenance('SERVER_METADATA').revision).toEqual({ status: 'current', note: null });
  });

  it('it does not reach the 1.2 wire: concise block without revision', () => {
    for (const key of SOURCE_KEYS) {
      expect(renderConcise(medicalProvenance(key))).not.toHaveProperty('revision');
    }
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
