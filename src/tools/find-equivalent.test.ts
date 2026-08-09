/**
 * Handler tests for the D2 ranked unified search (find_equivalent).
 *
 * Mocks two HTTP-backed terminologies (RxNorm + MeSH) with nock and pins
 * the server-side ranking pipeline end to end: match_score computation,
 * global rank assignment, per-terminology item ordering, cross-terminology
 * groups, the limit cap, and the ranking self-description. Per-upstream
 * parser correctness stays in the clients' contract tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { toolRegistry } from '../server-core.js';
import { cache } from '../utils/cache.js';
import { FindEquivalentOutputSchema, FindEquivalentOutput } from '../types/index.js';

// Side-effect import — registers find_equivalent.
import './crosswalk.js';

const RXNAV = 'https://rxnav.nlm.nih.gov';
const MESH = 'https://id.nlm.nih.gov';

function rxnormDrugs(names: [string, string][]) {
  return {
    drugGroup: {
      conceptGroup: [
        {
          tty: 'IN',
          conceptProperties: names.map(([rxcui, name]) => ({ rxcui, name, synonym: '', tty: 'IN', language: 'ENG', suppress: 'N', umlscui: '' })),
        },
      ],
    },
  };
}

function meshLookup(items: [string, string][]) {
  return items.map(([id, label]) => ({
    resource: `http://id.nlm.nih.gov/mesh/${id}`,
    label,
  }));
}

async function callFindEquivalent(args: Record<string, unknown>): Promise<FindEquivalentOutput> {
  const handler = toolRegistry.getHandler('find_equivalent');
  expect(handler).toBeDefined();
  const result = await handler!(args);
  expect(result.isError).not.toBe(true);
  const parsed = FindEquivalentOutputSchema.safeParse(result.structuredContent);
  expect(parsed.success).toBe(true);
  return parsed.success ? parsed.data : (undefined as never);
}

describe('find_equivalent — ranked unified search', () => {
  beforeEach(() => {
    cache.flush();
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('scores, globally ranks, and reorders items across two terminologies', async () => {
    nock(RXNAV)
      .get('/REST/drugs.json')
      .query({ name: 'aspirin' })
      .reply(200, rxnormDrugs([
        ['1191', 'aspirin'],
        ['218299', 'aspirin / caffeine oral product'],
      ]));
    nock(MESH)
      .get('/mesh/lookup/descriptor')
      .query(true)
      .reply(200, meshLookup([['D001241', 'Aspirin']]));

    const out = await callFindEquivalent({
      term: 'aspirin',
      target_terminologies: ['rxnorm', 'mesh'],
    });

    expect(out.searched_terminologies).toEqual(['rxnorm', 'mesh']);
    expect(out.ranking.method).toBe('lexical');
    expect(out.ranking.note).toContain('computed by this server');

    const rx = out.results.rxnorm!;
    const mesh = out.results.mesh!;
    // Exact matches score 1.0; rxnorm precedes mesh in tie-break order.
    expect(rx.items[0]).toMatchObject({ code: '1191', title: 'aspirin', match_score: 1, rank: 1 });
    expect(mesh.items[0]).toMatchObject({ code: 'D001241', title: 'Aspirin', match_score: 1, rank: 2 });
    // The verbose candidate ranks below both exact matches.
    expect(rx.items[1].rank).toBe(3);
    expect(rx.items[1].match_score).toBeLessThan(1);
    // Items are ordered by rank within each terminology.
    expect(rx.items.map((i) => i.rank)).toEqual([...rx.items.map((i) => i.rank)].sort((a, b) => a - b));
  });

  it('groups lexically identical titles across terminologies (and only across)', async () => {
    nock(RXNAV)
      .get('/REST/drugs.json')
      .query({ name: 'aspirin' })
      .reply(200, rxnormDrugs([
        ['1191', 'aspirin'],
        ['999', 'ASPIRIN'], // same-terminology duplicate must NOT form a group alone
      ]));
    nock(MESH)
      .get('/mesh/lookup/descriptor')
      .query(true)
      .reply(200, meshLookup([['D001241', 'Aspirin']]));

    const out = await callFindEquivalent({
      term: 'aspirin',
      target_terminologies: ['rxnorm', 'mesh'],
    });

    expect(out.groups).toHaveLength(1);
    const group = out.groups[0];
    expect(group.normalized_title).toBe('aspirin');
    expect(group.terminologies).toEqual(['rxnorm', 'mesh']);
    // All three case-variants share the normalized title, so all are members.
    expect(group.members).toHaveLength(3);
    expect(group.members.every((m) => m.match_score === 1)).toBe(true);
  });

  it('returns empty groups when nothing matches across terminologies', async () => {
    nock(RXNAV)
      .get('/REST/drugs.json')
      .query({ name: 'metformin' })
      .reply(200, rxnormDrugs([['6809', 'metformin']]));
    nock(MESH)
      .get('/mesh/lookup/descriptor')
      .query(true)
      .reply(200, meshLookup([['D008687', 'Metformin hydrochloride']]));

    const out = await callFindEquivalent({
      term: 'metformin',
      target_terminologies: ['rxnorm', 'mesh'],
    });
    expect(out.groups).toEqual([]);
  });

  it('caps candidates per terminology at the limit param', async () => {
    nock(RXNAV)
      .get('/REST/drugs.json')
      .query({ name: 'statin' })
      .reply(200, rxnormDrugs([
        ['1', 'statin one'],
        ['2', 'statin two'],
        ['3', 'statin three'],
      ]));

    const out = await callFindEquivalent({
      term: 'statin',
      target_terminologies: ['rxnorm'],
      limit: 2,
    });
    expect(out.results.rxnorm!.items).toHaveLength(2);
  });

  it('an upstream failure yields error + empty items without breaking the other ranking', async () => {
    nock(RXNAV)
      .get('/REST/drugs.json')
      .query({ name: 'aspirin' })
      .times(4) // withRetry retries 5xx; keep every attempt failing
      .reply(500, 'boom');
    nock(MESH)
      .get('/mesh/lookup/descriptor')
      .query(true)
      .reply(200, meshLookup([['D001241', 'Aspirin']]));

    const out = await callFindEquivalent({
      term: 'aspirin',
      target_terminologies: ['rxnorm', 'mesh'],
    });

    expect(out.results.rxnorm!.found).toBe(false);
    expect(out.results.rxnorm!.error).not.toBeNull();
    expect(out.results.rxnorm!.items).toEqual([]);
    // MeSH ranking is unaffected: its single exact match is global rank 1.
    expect(out.results.mesh!.items[0].rank).toBe(1);
  });

  it('markdown output carries the ranking note and per-item rank/score', async () => {
    nock(RXNAV)
      .get('/REST/drugs.json')
      .query({ name: 'aspirin' })
      .reply(200, rxnormDrugs([['1191', 'aspirin']]));

    const handler = toolRegistry.getHandler('find_equivalent')!;
    const result = await handler({ term: 'aspirin', target_terminologies: ['rxnorm'] });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('(rank 1, score 1.000)');
    expect(text).toContain('computed by this server');
  });
});
