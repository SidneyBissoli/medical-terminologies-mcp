/**
 * match_value_set behavior (PROGRESS.md 24.4), offline: only the bundled
 * terminologies (CID-10 V2008, ICD-10 transition tables) are used, so no
 * client is mocked and no network is touched.
 */
import { describe, it, expect } from 'vitest';
import { toolRegistry } from '../server-core.js';
import '../register.js';
import type { MatchValueSetOutput } from '../types/index.js';

async function call(args: Record<string, unknown>) {
  const handler = toolRegistry.getHandler('match_value_set');
  expect(handler).toBeDefined();
  const r = await handler!(args);
  return { r, s: r.structuredContent as unknown as MatchValueSetOutput };
}

describe('match_value_set', () => {
  it('suggests only members of the set, best first, with their FHIR coding', async () => {
    const { r, s } = await call({
      terms: ['infarto agudo do miocardio', 'colera'],
      value_set: [
        { code: 'A00', terminology: 'cid10' },
        { code: 'I21', terminology: 'cid10' },
      ],
    });
    expect(r.isError).toBeFalsy();
    const [iam, colera] = s.results;
    expect(iam.best?.code).toBe('I21');
    expect(iam.best?.match_type).toBe('exact');
    expect(iam.best?.coding).toMatchObject({ system: 'https://rnds-fhir.saude.gov.br/CodeSystem/BRCID10', code: 'I21' });
    expect(colera.best?.code).toBe('A00');
    // Every suggestion is a member of the set.
    const sugeridos = s.results.flatMap((x) => x.candidates.map((c) => c.code));
    expect(sugeridos.every((c) => ['A00', 'I21'].includes(c))).toBe(true);
  });

  it('lists members the source does not confirm and never ranks them', async () => {
    const { s } = await call({
      terms: ['colera'],
      value_set: [
        { code: 'A00', terminology: 'cid10' },
        { code: 'ZZZZ', terminology: 'icd10' },
      ],
    });
    expect(s.value_set).toMatchObject({ submitted: 2, confirmed: 1 });
    expect(s.value_set.unconfirmed).toEqual([{ code: 'ZZZZ', terminology: 'icd10', reason: 'not_found', error: null }]);
    expect(s.results[0].candidates.map((c) => c.code)).toEqual(['A00']);
  });

  it('a term sharing no word with any member is no_candidates, not a forced guess', async () => {
    const { s } = await call({ terms: ['xyzzy plugh'], value_set: [{ code: 'A00', terminology: 'cid10' }] });
    expect(s.results[0]).toMatchObject({ status: 'no_candidates', best: null, candidates: [] });
    expect(s.counts.no_candidates).toBe(1);
  });

  it('a member listed twice is checked and ranked once', async () => {
    const { s } = await call({
      terms: ['colera'],
      value_set: [
        { code: 'A00', terminology: 'cid10' },
        { code: 'a00', terminology: 'cid10' },
      ],
    });
    expect(s.value_set.confirmed).toBe(1);
    expect(s.results[0].candidates).toHaveLength(1);
  });

  it('refuses an empty value set (validation error, not an empty answer)', async () => {
    const { r } = await call({ terms: ['colera'], value_set: [] });
    expect(r.isError).toBe(true);
  });
});
