/**
 * Integration tests against the actual upstream APIs.
 *
 * Skipped by default. Run with:
 *
 *   INTEGRATION_TESTS=1 npm test
 *
 * Or, in CI, via the dedicated workflow at
 * `.github/workflows/integration.yml` which runs nightly.
 *
 * Tests are intentionally narrow — they validate that endpoints we
 * depend on are still reachable and still return the shapes the
 * clients expect, NOT the correctness of any particular value (which
 * would change with each upstream release). When an upstream sneaks in
 * a breaking change, the assertions here fail close to the change.
 *
 * Discoveries that motivated these tests:
 *  - 2026-05-09: MeSH `/D{id}.json` shape changed from `@graph`
 *    array to flat compact JSON-LD; client returned empty data for
 *    weeks before this work caught it.
 *  - 2026-05-09: NLM `/loinc_answers` started returning HTTP 404;
 *    `loinc_answers` tool silently degraded to empty. It came back later
 *    with AnswerStringID/SequenceNo/Score, which the client never read
 *    (empty codes, sequence 0) until 1.18.2 — now asserted field by field.
 *  - 2026-05-09: WHO ICD-11 `lookup` by URI duplicated the `/icd`
 *    prefix (existing code bug, not upstream drift, but caught by
 *    the same exploration).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getNLMClient } from '../clients/nlm-client.js';
import { getRxNormClient } from '../clients/rxnorm-client.js';
import { getMeSHClient } from '../clients/mesh-client.js';
import { getCID10Client } from '../clients/cid10-client.js';
import { getWHOClient, WHOClient, WHO_ICD11_DEFAULT_RELEASE } from '../clients/who-client.js';
import { cache } from '../utils/cache.js';

const ENABLED = process.env.INTEGRATION_TESTS === '1';
const HAS_WHO_CREDS = Boolean(process.env.WHO_CLIENT_ID && process.env.WHO_CLIENT_SECRET);

const describeIntegration = ENABLED ? describe : describe.skip;

describeIntegration('Integration: live API contracts', () => {
  beforeAll(() => {
    cache.flush();
  });

  // No auth, no flag — always run when integration enabled.

  // In CI the WHO block must RUN, not skip. Until 2026-10-03 the repository
  // had no WHO_CLIENT_ID / WHO_CLIENT_SECRET secrets, so the ICD-11 block —
  // the flagship terminology — was skipped every day while the run showed
  // green ("11 passed | 5 skipped"). Locally, without creds, it still skips.
  // This also catches a secret saved EMPTY (`gh secret set` without a TTY
  // stores "" silently): empty reads as absent and fails here.
  it.runIf(process.env.CI === 'true')('CI has WHO credentials, so the ICD-11 block runs', () => {
    expect(
      HAS_WHO_CREDS,
      'WHO_CLIENT_ID / WHO_CLIENT_SECRET missing or empty in the repository secrets — the ICD-11 block would be skipped',
    ).toBe(true);
  });

  describe('NLM Clinical Tables (LOINC)', () => {
    it('LOINC search for "glucose" returns at least one result with a populated long name', async () => {
      const r = await getNLMClient().searchLOINC('glucose', 5);
      expect(r.totalCount).toBeGreaterThan(0);
      expect(r.items.length).toBeGreaterThan(0);
      expect(r.items[0].LOINC_NUM).toMatch(/^\d+-\d$/);
      expect(r.items[0].LONG_COMMON_NAME.length).toBeGreaterThan(0);
    });

    it('LOINC details for 2339-0 (Glucose) returns the canonical component', async () => {
      const item = await getNLMClient().getLOINCDetails('2339-0');
      expect(item).not.toBeNull();
      expect(item!.LOINC_NUM).toBe('2339-0');
      expect(item!.LONG_COMMON_NAME.toLowerCase()).toContain('glucose');
    });

    // The endpoint 404'd in May 2026, came back with field names the client
    // did not read, and nothing noticed for months (fixed in 1.18.2). This
    // asserts the FIELDS, not just "non-empty": empty codes were the symptom.
    it('LOINC answers for 72166-2 come back with LA codes, order and text', async () => {
      const answers = await getNLMClient().getLOINCAnswers('72166-2');
      expect(answers.length).toBeGreaterThan(0);
      for (const a of answers) {
        expect(a.answerCode).toMatch(/^LA\d+-\d$/);
        expect(a.sequence).toBeGreaterThan(0);
        expect(a.answerString.length).toBeGreaterThan(0);
      }
    });

    it('LOINC answers for 44250-9 (PHQ-9 item) keep the numeric scores', async () => {
      const answers = await getNLMClient().getLOINCAnswers('44250-9');
      expect(answers.map((a) => a.score)).toEqual([0, 1, 2, 3]);
    });
  });

  describe('NLM RxNav (RxNorm + ATC)', () => {
    it('drug search for "metformin" returns multiple TTYs', async () => {
      const r = await getRxNormClient().searchDrugs('metformin');
      expect(r.drugs.length).toBeGreaterThan(0);
      const ttys = new Set(r.drugs.map((d) => d.tty));
      expect(ttys.size).toBeGreaterThan(1);
    });

    // Lacuna que custou caro: getIngredients nunca esteve aqui, e a URL que
    // ele montava era recusada com 400 pelo RxNav desde sempre — o teste de
    // contrato com nock passava porque nock compara a query DECODIFICADA,
    // e "%2B" decodifica justamente para o '+' que o teste esperava.
    // Medido em 2026-09-10: 14 erros em 14 chamadas, 28 dias.
    it('ingredientes de 860975 (metformina + sitagliptina) voltam com IN', async () => {
      const ings = await getRxNormClient().getIngredients('860975');
      expect(ings.length).toBeGreaterThan(0);
      expect(ings.some((i) => i.tty === 'IN')).toBe(true);
      expect(ings.map((i) => i.name.toLowerCase()).join(' ')).toContain('metformin');
    });

    it('ATC classify for "metformin" returns A10BA (Biguanides) class', async () => {
      // Note: byDrugName returns ATC1-4 codes (1-5 chars); the
      // substance-level (7-char) code A10BA02 is not exposed by this
      // endpoint shape — confirmed live 2026-05-09. We assert on the
      // pharmacological class code instead.
      const matches = await getRxNormClient().getATCByDrugName('metformin');
      expect(matches.length).toBeGreaterThan(0);
      const codes = new Set(matches.map((m) => m.atc_code));
      expect(codes.has('A10BA')).toBe(true);
      expect(matches.every((m) => m.atc_level_type === 'ATC1-4')).toBe(true);
    });

    it('ATC byCode A10BA resolves to "Biguanides"', async () => {
      const c = await getRxNormClient().getATCByCode('A10BA');
      expect(c).not.toBeNull();
      expect(c!.atc_name).toMatch(/biguanide/i);
    });

    it('ATC members of A10BA include metformin and phenformin', async () => {
      const members = await getRxNormClient().getATCMembers('A10BA');
      const names = members.map((m) => m.name.toLowerCase());
      expect(names).toContain('metformin');
      expect(names).toContain('phenformin');
    });
  });

  describe('NLM MeSH', () => {
    it('search for "hypertension" returns descriptors', async () => {
      const r = await getMeSHClient().searchDescriptors('hypertension', 'contains', 5);
      expect(r.length).toBeGreaterThan(0);
      expect(r[0].id).toMatch(/^D\d+$/);
    });

    it('descriptor D006973 (Hypertension) populates label, scope_note, tree, concepts, qualifiers', async () => {
      // This is the canary for the JSON-LD shape regression that
      // motivated all the contract tests. If NLM ever flips the shape
      // again, every assertion below fails on the same call.
      const d = await getMeSHClient().getDescriptor('D006973');
      expect(d).not.toBeNull();
      expect(d!.label).toBe('Hypertension');
      expect(d!.scopeNote.length).toBeGreaterThan(50);
      expect(d!.treeNumbers.length).toBeGreaterThan(0);
      expect(d!.treeNumbers[0].treeNumber).toMatch(/^[A-Z]\d+(\.\d+)+$/);
      expect(d!.concepts.length).toBeGreaterThan(0);
      expect(d!.concepts[0].terms.length).toBeGreaterThan(0);
      expect(d!.qualifiers.length).toBeGreaterThan(10);
      expect(d!.qualifiers.every((q) => q.label.length > 0)).toBe(true);
    });
  });

  describe('CID-10 (bundled — sanity check the data file is intact)', () => {
    it('lookup of I21 resolves to acute MI', () => {
      const hit = getCID10Client().lookup('I21');
      expect(hit).not.toBeNull();
      expect(hit!.title.toLowerCase()).toMatch(/infarto/);
    });

    it('listChapters returns 22 entries', () => {
      expect(getCID10Client().listChapters()).toHaveLength(22);
    });
  });

  // WHO needs OAuth creds — set WHO_CLIENT_ID and WHO_CLIENT_SECRET to run.

  (HAS_WHO_CREDS ? describe : describe.skip)('WHO ICD-11 (requires creds)', () => {
    // Diagnostic first: when the token request fails, say WHY (the OAuth
    // `error` / `error_description`) and describe the credentials WITHOUT
    // revealing them — length and stray whitespace, the usual paste mistakes.
    // Added 2026-10-03, when two pasted pairs both drew a bare HTTP 400.
    it('the WHO token endpoint accepts the credentials', async () => {
      const id = process.env.WHO_CLIENT_ID ?? '';
      const secret = process.env.WHO_CLIENT_SECRET ?? '';
      const shape = (v: string) =>
        `length ${v.length}${v !== v.trim() ? ', LEADING/TRAILING WHITESPACE' : ''}${/^["']|["']$/.test(v) ? ', QUOTES' : ''}${v.includes('=') ? ', contains "="' : ''}`;
      const res = await fetch('https://icdaccessmanagement.who.int/connect/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: id,
          client_secret: secret,
          grant_type: 'client_credentials',
          scope: 'icdapi_access',
        }).toString(),
      });
      let reason = '';
      if (!res.ok) {
        const body = await res.text();
        try {
          const j = JSON.parse(body) as { error?: string; error_description?: string };
          reason = `${j.error ?? '?'}${j.error_description ? ` — ${j.error_description}` : ''}`;
        } catch {
          reason = body.slice(0, 200);
        }
      }
      expect(
        res.ok,
        `WHO token endpoint said HTTP ${res.status}: ${reason}. WHO_CLIENT_ID: ${shape(id)}; WHO_CLIENT_SECRET: ${shape(secret)}.`,
      ).toBe(true);
    });

    it('OAuth handshake succeeds and search returns destinationEntities', async () => {
      const c = new WHOClient();
      const r = await c.search('diabetes', 'en', 3);
      expect(Array.isArray(r.destinationEntities)).toBe(true);
      expect(r.destinationEntities.length).toBeGreaterThan(0);
      expect(r.destinationEntities[0].title.length).toBeGreaterThan(0);
    });

    // harmonize_terms (1.18.1) ranks with `theCode` and the synonyms WHO
    // reports as matched (`matchingPVs[].label`); a shape change there would
    // silently demote the right code. "hypertension" → BA00.Z via the
    // synonym "hypertension NOS" (measured 2026-10-03).
    it('search exposes theCode and matchingPVs labels (what harmonize_terms ranks on)', async () => {
      const r = await getWHOClient().search('hypertension', 'en', 10);
      const essential = r.destinationEntities.find((e) => e.theCode === 'BA00.Z');
      expect(essential, 'BA00.Z (Essential hypertension) not among the top 10 for "hypertension"').toBeDefined();
      const labels = (essential!.matchingPVs ?? []).map((pv) => pv.label.toLowerCase());
      expect(labels).toContain('hypertension nos');
    });

    // PROGRESS.md 14.3 — the annual ICD-11 release bump, as a MEASUREMENT
    // instead of a calendar reminder. WHO publishes a new MMS release about
    // once a year (Jan/Feb). The server pins one (WHO_ICD11_DEFAULT_RELEASE);
    // nothing else would notice a newer one, and the pin would quietly age.
    // This asks WHO itself which release is the latest and fails, with the
    // procedure, when it differs from the pin. See CONTRIBUTING.md →
    // "Annual ICD-11 release bump".
    it('the pinned ICD-11 release is the latest WHO publishes', async () => {
      const tokenRes = await fetch('https://icdaccessmanagement.who.int/connect/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.WHO_CLIENT_ID ?? '',
          client_secret: process.env.WHO_CLIENT_SECRET ?? '',
          grant_type: 'client_credentials',
          scope: 'icdapi_access',
        }).toString(),
      });
      expect(tokenRes.ok, `token: HTTP ${tokenRes.status}`).toBe(true);
      const { access_token } = (await tokenRes.json()) as { access_token: string };

      // The linearization root WITHOUT a release lists every release and names
      // the latest one.
      const res = await fetch('https://id.who.int/icd/release/11/mms', {
        headers: {
          Authorization: `Bearer ${access_token}`,
          Accept: 'application/json',
          'Accept-Language': 'en',
          'API-Version': 'v2',
        },
      });
      expect(res.ok, `release list: HTTP ${res.status}`).toBe(true);
      const body = (await res.json()) as { latestRelease?: string; release?: string[] };
      const idOf = (uri: string) => uri.match(/\/release\/11\/([^/]+)\/mms/)?.[1];
      const latest = body.latestRelease ? idOf(body.latestRelease) : undefined;
      expect(
        latest,
        `WHO release list changed shape (keys: ${Object.keys(body).join(', ')}) — the watch cannot read the latest release`,
      ).toBeTruthy();
      expect(
        latest,
        `WHO published ICD-11 release ${latest}; this server pins ${WHO_ICD11_DEFAULT_RELEASE}. Follow CONTRIBUTING.md → "Annual ICD-11 release bump".`,
      ).toBe(WHO_ICD11_DEFAULT_RELEASE);
    });

    it('lookup of code "5A11" returns an entity', async () => {
      const e = await getWHOClient().lookup('5A11');
      expect(e['@id']).toBeTruthy();
    });

    it('chapters listing returns the expected count via getChapters', async () => {
      const r = await getWHOClient().getChapters();
      // ICD-11 has 28 chapters in the MMS linearization at release 2024-01.
      // A drift (count change) is itself worth surfacing as a failure.
      expect(r.child).toBeDefined();
      expect(r.child!.length).toBeGreaterThanOrEqual(20);
    });
  });

});

// Hint to anyone running locally — no test below this line.
if (!ENABLED) {
  describe('Integration tests', () => {
    it.skip('skipped (set INTEGRATION_TESTS=1 to enable)', () => {});
  });
}
