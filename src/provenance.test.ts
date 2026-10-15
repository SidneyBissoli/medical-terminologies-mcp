import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { CONCISE_BLOCK_JSON_SCHEMA, renderConcise } from '@sbissoli/mcp-provenance';
import {
  ATTRIBUTION_META_KEY,
  LOINC_NOTICE,
  MEDICAL_SOURCES,
  medicalProvenance,
  NLM_STATEMENT,
  PROVENANCE_META_KEY,
  provenanceContext,
  provenancedResult,
} from './provenance.js';
import { RANKING_METHOD_NOTE } from './utils/lexical-score.js';
import { resourceRegistry } from './server-core.js';
import './resources/index.js';

const SOURCE_KEYS = Object.keys(MEDICAL_SOURCES) as Array<keyof typeof MEDICAL_SOURCES>;

describe('medicalProvenance (canonical block)', () => {
  it('every source preset carries the legal floor: license + citation + verified_at', () => {
    for (const key of SOURCE_KEYS) {
      const p = medicalProvenance(key);
      expect(p.contract_version).toBe('1.3');
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

describe('contract 1.3 on the wire: revision always, notices and derived by exception', () => {
  const listed = Object.keys(CONCISE_BLOCK_JSON_SCHEMA.properties);

  it('the context emits 1.3', () => {
    expect(provenanceContext.contractVersion).toBe('1.3');
  });

  it('every source: the required keys in the schema order, plus revision, and nothing undeclared', () => {
    for (const key of SOURCE_KEYS) {
      const c = renderConcise(medicalProvenance(key)) as unknown as Record<string, unknown>;
      const keys = Object.keys(c);
      expect(keys.slice(0, CONCISE_BLOCK_JSON_SCHEMA.required.length), key).toEqual(
        CONCISE_BLOCK_JSON_SCHEMA.required,
      );
      expect(c.revision, key).toEqual(MEDICAL_SOURCES[key].revision);
      for (const k of keys) expect(listed, `${key}.${k}`).toContain(k);
      expect(c, key).not.toHaveProperty('field_sources');
    }
  });

  it('the common case (no caveat, nothing computed) gains only revision: no notices, no derived, no footer line', () => {
    const p = medicalProvenance('NLM_RXNAV');
    const c = renderConcise(p);
    expect(Object.keys(c)).toEqual([...CONCISE_BLOCK_JSON_SCHEMA.required, 'revision']);
    expect(c).not.toHaveProperty('notices');
    expect(c).not.toHaveProperty('derived');
    expect(c).not.toHaveProperty('derivation_note');
    expect(provenanceContext.footer([p])).not.toMatch(/Notices from the source|Values computed/);
  });

  it('a caveat about the DATA reaches the block and the footer (WHO transition tables)', () => {
    const p = medicalProvenance('WHO_TRANSITION_TABLES', { dataVintage: '2025-01' });
    const c = renderConcise(p) as { notices?: string[] };
    expect(c.notices).toEqual(MEDICAL_SOURCES.WHO_TRANSITION_TABLES.notices);
    expect(c.notices?.[0]).toContain('not intended for directly converting data');
    expect(provenanceContext.footer([p])).toContain('Notices from the source: WHO: "Mapping tables');
  });

  it('a value this server computed says so, with the note, in the block and the footer', () => {
    const p = medicalProvenance('NLM_MESH', { derived: { note: RANKING_METHOD_NOTE } });
    const c = renderConcise(p) as { derived?: boolean; derivation_note?: string };
    expect(c.derived).toBe(true);
    expect(c.derivation_note).toBe(RANKING_METHOD_NOTE);
    expect(provenanceContext.footer([p])).toContain('Values computed by the server from the source data:');
  });
});

describe('license statements are not notices (they live in the fixed places)', () => {
  const flat = (s: string) => s.replace(/^\s*>\s?/gm, '').replace(/\*/g, '').replace(/\s+/g, ' ');
  const root = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

  it('no preset carries the NLM statement or the LOINC notice in notices; ICD-11 none at all', () => {
    for (const key of SOURCE_KEYS) {
      const p = medicalProvenance(key);
      expect(p.notices, key).not.toContain(NLM_STATEMENT);
      expect(p.notices, key).not.toContain(LOINC_NOTICE);
      expect(provenanceContext.footer([p]), key).not.toContain('National Library of Medicine (NLM)');
    }
    expect(medicalProvenance('WHO_ICD_API').notices).toEqual([]);
  });

  it('the LOINC citation still embeds the §10 notice — once per response, in the citation', () => {
    const p = medicalProvenance('CLINICALTABLES_LOINC');
    expect(p.citation).toContain(LOINC_NOTICE);
    expect(renderConcise(p)).not.toHaveProperty('notices');
  });

  it('MeSH credits NLM without claiming a wording the MeSH terms do not require', () => {
    const p = medicalProvenance('NLM_MESH');
    expect(p.citation).not.toContain('Courtesy of');
    expect(p.license.name).not.toContain('Courtesy of');
  });

  it('README, LEIA-ME, NOTICE.md and info://licenses carry both statements verbatim', async () => {
    const handler = resourceRegistry.getHandler('info://licenses');
    const res = await handler!('info://licenses');
    const md = (res.contents[0] as { text: string }).text;
    for (const [name, text] of [
      ['README.md', root('README.md')],
      ['LEIA-ME.md', root('LEIA-ME.md')],
      ['NOTICE.md', root('NOTICE.md')],
      ['info://licenses', md],
    ] as const) {
      expect(flat(text), name).toContain(LOINC_NOTICE);
      expect(flat(text), name).toContain(NLM_STATEMENT);
    }
  });
});

describe('revision (contract 1.3)', () => {
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
