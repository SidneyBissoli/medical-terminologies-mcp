// PROGRESS.md 24.5 / 24.5a gate: 15 term → code pairs with a known answer,
// measured through the REAL tools (find_equivalent per terminology), so the
// number is what a client gets. Not part of `npm test` (it hits live sources).
//
//   npx tsx scripts/measure-synonyms.mts            # local handlers (no WHO credential: icd11/icf rows error)
//   npx tsx scripts/measure-synonyms.mts --prod     # the hosted endpoint
//
// A pair passes when the expected code is the FIRST item of its terminology.
// Baseline (title-only ranking, 2026-11-24): 1 of 15 first with exact/strong.

const PROD = 'https://medical.sidneybissoli.com/mcp';
const useProd = process.argv.includes('--prod');

type Out = { results: Record<string, { error: string | null; items: { code: string; title: string; match_score: number; matched_label?: string | null }[] }> };

async function findEquivalent(term: string, terminology: string): Promise<Out> {
  const args = { term, target_terminologies: [terminology], limit: 10 };
  if (useProd) {
    await new Promise((r) => setTimeout(r, 400));
    const res = await fetch(PROD, {
      method: 'POST',
      headers: {
        'User-Agent': 'measurement-script',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'find_equivalent', arguments: args } }),
    });
    const t = await res.text();
    const line = t.split('\n').find((l) => l.startsWith('data:'));
    return JSON.parse(line ? line.slice(5) : t).result.structuredContent as Out;
  }
  const { toolRegistry } = await import('../src/server-core.ts');
  await import('../src/register.ts');
  const r = await toolRegistry.getHandler('find_equivalent')!(args);
  return r.structuredContent as unknown as Out;
}

const PAIRS: [string, string, string][] = [
  ['loinc', 'HbA1c', '4548-4'],
  ['loinc', 'blood sugar', '2339-0'],
  ['loinc', 'body weight', '29463-7'],
  ['loinc', 'heart rate', '8867-4'],
  ['loinc', 'pulse rate', '8867-4'],
  ['icd11', 'heart attack', 'BA41'],
  ['icd11', 'high blood pressure', 'BA00'],
  ['icd11', 'adult onset diabetes', '5A11'],
  ['icf', 'climbing stairs', 'd4551'],
  ['icf', 'walking speed', 'd450'],
  ['icf', 'getting dressed', 'd540'],
  ['icf', 'taking the bus', 'd4702'],
  ['mesh', 'heart attack', 'D009203'],
  ['mesh', 'high blood pressure', 'D006973'],
  ['mesh', 'bedsore', 'D003668'],
];
// Residual cases the 2026-11-24 measurement predicted the cheap path would NOT fix.
const RESIDUAL = new Set(['blood sugar', 'taking the bus', 'walking speed']);

const isGold = (code: string, gold: string) => code === gold || code.startsWith(`${gold}.`);
let first = 0;
let firstNonResidual = 0;
let nonResidual = 0;
for (const [src, term, gold] of PAIRS) {
  if (!RESIDUAL.has(term)) nonResidual++;
  try {
    const out = await findEquivalent(term, src);
    const r = out.results[src];
    if (!r || r.error) {
      console.log(`${src}\t${term}\t${gold}\tERROR ${r?.error ?? 'no result'}`);
      continue;
    }
    const pos = r.items.findIndex((i) => isGold(i.code, gold));
    const top = r.items[0];
    const ok = pos === 0;
    if (ok) first++;
    if (ok && !RESIDUAL.has(term)) firstNonResidual++;
    console.log(
      `${src}\t${term}\t${gold}\t${pos === -1 ? 'absent' : `#${pos + 1}`}\t` +
        `top=${top ? `${top.code} "${top.title}" ${top.match_score}${top.matched_label ? ` via "${top.matched_label}"` : ''}` : '—'}`,
    );
  } catch (e) {
    console.log(`${src}\t${term}\t${gold}\tERROR ${(e as Error).message.slice(0, 100)}`);
  }
}
console.log(`\nfirst: ${first}/${PAIRS.length}; non-residual first: ${firstNonResidual}/${nonResidual}`);
