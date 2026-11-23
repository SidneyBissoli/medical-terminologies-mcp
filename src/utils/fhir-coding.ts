/**
 * FHIR `Coding` for codes this server has confirmed at the source (Phase 24.1).
 *
 * A researcher's requirement (2026-11-23): an assistant should never pass on a
 * code the server has not confirmed, and should hand it on as a FHIR Coding
 * (system, code, display, version) a FHIR stack can store without rework.
 *
 * Every system URI below was read at its publisher on 2026-11-23:
 * - LOINC, RxNorm, ATC: FHIR R4 terminologies-systems.html
 * - ICD-10 (WHO): FHIR R4 icd.html (`http://hl7.org/fhir/sid/icd-10`)
 * - ICD-11 MMS: WHO ICD-API FHIR support page and the HL7 FHIR Terminology
 *   Ecosystem IG (icd-11.html), which also fixes the CODE form: the entity id
 *   (e.g. 257068234, or "1363559646/other" for a residual), with the short
 *   classification code beside it in the provisional WHO extension.
 * - MeSH: HL7 THO 7.5.0 NamingSystem-MeSH, preferred URI.
 * - CID-10 (Brazil): RNDS NamingSystem BRCID10 (status draft). The RNDS
 *   publishes no code list, so codes keep the DataSUS form (undotted, "A001").
 *
 * FHIR JSON forbids null, so `version` and `extension` are OMITTED when the
 * call does not know them. A version appears only when it is the release this
 * call actually read (ICD-11 pin, bundled CID-10); LOINC/RxNorm/MeSH/ATC are
 * read live from NLM services that do not state their release per answer.
 */

import { getICD11ReleaseId } from '../clients/who-client.js';
import type { FhirCoding } from '../types/index.js';

export const FHIR_SYSTEMS = {
  icd11: 'http://id.who.int/icd/release/11/mms',
  icd10: 'http://hl7.org/fhir/sid/icd-10',
  cid10: 'https://rnds-fhir.saude.gov.br/CodeSystem/BRCID10',
  loinc: 'http://loinc.org',
  rxnorm: 'http://www.nlm.nih.gov/research/umls/rxnorm',
  mesh: 'https://www.nlm.nih.gov/mesh',
  atc: 'http://www.whocc.no/atc',
} as const;

export type CodingTerminology = keyof typeof FHIR_SYSTEMS;

/** Provisional WHO extension carrying the short ICD-11 code beside the entity id. */
export const ICD11_CLASSIFICATION_CODE_EXTENSION =
  'http://id.who.int/icd/schema/extension/classificationCode';

/** CID-10 bundle version (DataSUS has published no successor to V2008). */
const CID10_VERSION = 'V2008';

/**
 * Entity id of an ICD-11 MMS linearization URI: everything after `/mms/`.
 * `http://id.who.int/icd/release/11/2026-01/mms/1363559646/other` →
 * `1363559646/other`. Null when the URI is not an MMS entity URI.
 */
export function icd11EntityId(uri: string | null | undefined): string | null {
  if (!uri) return null;
  const m = /\/mms\/(.+)$/.exec(uri);
  if (!m) return null;
  const id = m[1].replace(/\/+$/, '');
  // Entity ids are digits, optionally followed by a residual suffix.
  return /^\d+(\/(other|unspecified))?$/.test(id) ? id : null;
}

/** Strip the dot from a CID-10 code: the DataSUS form is undotted. */
function cid10Code(code: string): string {
  return code.trim().toUpperCase().replace('.', '');
}

/**
 * Build the Coding for a code confirmed at its source.
 *
 * For ICD-11, `entityUri` is required (the code is the entity id); without it
 * the result is null rather than a Coding a FHIR validator would reject.
 */
export function toFhirCoding(
  terminology: CodingTerminology,
  code: string,
  display: string | null,
  entityUri?: string | null,
): FhirCoding | null {
  if (terminology === 'icd11') {
    const id = icd11EntityId(entityUri);
    if (!id) return null;
    // Groupings above the category level have no short code; a URI is not one.
    const shortCode = code.trim();
    const hasShortCode = shortCode !== '' && !shortCode.startsWith('http');
    return {
      system: FHIR_SYSTEMS.icd11,
      version: getICD11ReleaseId(),
      code: id,
      ...(display !== null ? { display } : {}),
      ...(hasShortCode
        ? { extension: [{ url: ICD11_CLASSIFICATION_CODE_EXTENSION, valueCode: shortCode }] }
        : {}),
    };
  }
  if (terminology === 'cid10') {
    return {
      system: FHIR_SYSTEMS.cid10,
      version: CID10_VERSION,
      code: cid10Code(code),
      ...(display !== null ? { display } : {}),
    };
  }
  return {
    system: FHIR_SYSTEMS[terminology],
    code,
    ...(display !== null ? { display } : {}),
  };
}
