/**
 * Lexical similarity scoring for `find_equivalent` (D2 ranked unified search).
 *
 * The upstream terminologies do not expose comparable relevance scores
 * (ICD-11 returns an opaque internal score, Clinical Tables and RxNorm none
 * at all), so any cross-terminology ranking must be computed server-side
 * against the user's search term. This module is that computation — pure,
 * deterministic, dependency-free, so the same inputs always produce the
 * same ranking on Node and Workers.
 *
 * Because the score is server-derived (not upstream data), the provenance
 * block added in the provenance session will mark these fields
 * `derived: true` with a derivation note — see RANKING_METHOD_NOTE, which
 * is the single place that describes the method and is reused by the tool
 * output today and by the provenance block later.
 *
 * Formula: score = (coverage + dice) / 2 over normalized word tokens, where
 * - coverage = |A∩B| / |A| — how much of the SEARCH TERM's vocabulary the
 *   candidate title contains (A = term tokens, B = title tokens);
 * - dice = 2·|A∩B| / (|A|+|B|) — Sørensen–Dice, which penalizes titles
 *   with many extra tokens, so terse exact titles outrank verbose ones.
 * An exact normalized match short-circuits to 1.0. Scores are rounded to
 * 3 decimals to keep the wire output stable across float quirks.
 */

/** Human-readable description of the ranking method, reused in tool output
 * and (in the provenance session) as the `derivation_note` of the block. */
export const RANKING_METHOD_NOTE =
  'match_score and rank are computed by this server as lexical similarity between the search ' +
  'term and each candidate title (mean of term-token coverage and Sørensen–Dice over ' +
  'normalized word tokens; 1.0 = exact match after normalization). Upstream relevance ' +
  'orders are not comparable across terminologies and are not used.';

/**
 * Normalizes a string for comparison: lowercase, diacritics stripped
 * (NFD + combining-mark removal), punctuation collapsed to spaces,
 * whitespace collapsed. "Diabetes Mellitus, Type 2" → "diabetes mellitus type 2".
 */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Scores a candidate title against the search term. Returns a number in
 * [0, 1], rounded to 3 decimals. Empty or placeholder titles score 0.
 */
export function lexicalScore(term: string, title: string): number {
  const t = normalizeForMatch(term);
  const c = normalizeForMatch(title);
  if (t.length === 0 || c.length === 0) return 0;
  if (t === c) return 1;

  const termTokens = new Set(t.split(' '));
  const titleTokens = new Set(c.split(' '));
  let overlap = 0;
  for (const token of termTokens) {
    if (titleTokens.has(token)) overlap++;
  }
  if (overlap === 0) return 0;

  const coverage = overlap / termTokens.size;
  const dice = (2 * overlap) / (termTokens.size + titleTokens.size);
  return Math.round(((coverage + dice) / 2) * 1000) / 1000;
}
