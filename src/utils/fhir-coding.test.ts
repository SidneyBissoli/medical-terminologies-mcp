import { describe, expect, it } from 'vitest';
import { FhirCodingSchema } from '../types/index.js';
import {
  FHIR_SYSTEMS,
  ICD11_CLASSIFICATION_CODE_EXTENSION,
  icd11EntityId,
  toFhirCoding,
} from './fhir-coding.js';
import { getICD11ReleaseId } from '../clients/who-client.js';

describe('icd11EntityId', () => {
  it('takes the id after /mms/ from a release URI', () => {
    expect(icd11EntityId('http://id.who.int/icd/release/11/2026-01/mms/257068234')).toBe('257068234');
  });
  it('keeps the residual suffix as part of the id', () => {
    expect(icd11EntityId('http://id.who.int/icd/release/11/2026-01/mms/1363559646/other')).toBe('1363559646/other');
    expect(icd11EntityId('http://id.who.int/icd/release/11/mms/1363559646/unspecified')).toBe('1363559646/unspecified');
  });
  it('rejects what is not an MMS entity URI', () => {
    expect(icd11EntityId(null)).toBeNull();
    expect(icd11EntityId('http://id.who.int/icd/entity/257068234')).toBeNull();
    expect(icd11EntityId('http://id.who.int/icd/release/11/2026-01/mms/codeinfo/5A11')).toBeNull();
  });
});

describe('toFhirCoding', () => {
  it('ICD-11: entity id as code, release as version, short code in the WHO extension', () => {
    const c = toFhirCoding('icd11', '5A11', 'Type 2 diabetes mellitus', 'http://id.who.int/icd/release/11/2026-01/mms/119724091');
    expect(c).toEqual({
      system: 'http://id.who.int/icd/release/11/mms',
      version: getICD11ReleaseId(),
      code: '119724091',
      display: 'Type 2 diabetes mellitus',
      extension: [{ url: ICD11_CLASSIFICATION_CODE_EXTENSION, valueCode: '5A11' }],
    });
  });
  it('ICD-11 without entity URI: null, never a Coding a FHIR validator rejects', () => {
    expect(toFhirCoding('icd11', '5A11', 'x', null)).toBeNull();
  });
  it('ICD-11 grouping without short code (URI as input): no extension', () => {
    const uri = 'http://id.who.int/icd/release/11/2026-01/mms/1435254666';
    expect(toFhirCoding('icd11', uri, 'Endocrine diseases', uri)).not.toHaveProperty('extension');
  });
  it('CID-10: RNDS system, DataSUS undotted code, V2008', () => {
    expect(toFhirCoding('cid10', 'A00.1', 'Cólera devida a Vibrio cholerae 01, biótipo El Tor')).toEqual({
      system: 'https://rnds-fhir.saude.gov.br/CodeSystem/BRCID10',
      version: 'V2008',
      code: 'A001',
      display: 'Cólera devida a Vibrio cholerae 01, biótipo El Tor',
    });
  });
  it('ICF: HL7 sid/icf system, lower-case category code, pinned release as version', () => {
    expect(toFhirCoding('icf', 'D450', 'Walking')).toEqual({
      system: 'http://hl7.org/fhir/sid/icf',
      version: '2026-01',
      code: 'd450',
      display: 'Walking',
    });
  });
  it('NLM-served terminologies: no version key at all (FHIR JSON forbids null)', () => {
    for (const t of ['loinc', 'rxnorm', 'mesh', 'atc', 'icd10'] as const) {
      const c = toFhirCoding(t, 'X1', 'label');
      expect(c).toEqual({ system: FHIR_SYSTEMS[t], code: 'X1', display: 'label' });
      expect(c).not.toHaveProperty('version');
    }
  });
  it('display omitted (not null) when the source has none', () => {
    expect(toFhirCoding('loinc', '2345-7', null)).toEqual({ system: 'http://loinc.org', code: '2345-7' });
  });
  it('every Coding it builds passes the advertised schema', () => {
    const samples = [
      toFhirCoding('icd11', '5A11', 'T2DM', 'http://id.who.int/icd/release/11/2026-01/mms/119724091'),
      toFhirCoding('cid10', 'E11', 'Diabetes'),
      toFhirCoding('loinc', '2345-7', null),
      toFhirCoding('icf', 'd450', 'Walking'),
    ];
    for (const s of samples) expect(FhirCodingSchema.safeParse(s).success).toBe(true);
  });
});
