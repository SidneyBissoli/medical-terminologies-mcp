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
  'term and each candidate title, or a synonym the source publishes for it when that scores ' +
  'higher (mean of term-token coverage and Sørensen–Dice over normalized, lightly stemmed word ' +
  'tokens; 1.0 = exact match after normalization). Upstream relevance orders are not ' +
  'comparable across terminologies and are not used.';

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
 * Light English suffix stripping, applied to BOTH sides of a comparison so a
 * word and its inflection meet ("dressed" ~ "Dressing", "walks" ~ "Walking").
 * Measured 2026-11-24 (PROGRESS.md 24.5): "getting dressed" scored 0 against
 * ICF d540 "Dressing". Deliberately crude and symmetric — it only decides
 * which tokens count as shared; `exact` still needs the unstemmed words to be
 * equal. Short tokens (≤ 4 chars) are left alone ("bus", "ICD", "type").
 */
export function stemToken(token: string): string {
  if (token.length <= 4) return token;
  for (const suffix of ['ing', 'ies', 'ed', 'es', 's']) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 3) {
      return token.slice(0, -suffix.length);
    }
  }
  return token;
}

function stemmedTokens(normalized: string): Set<string> {
  return new Set(normalized.split(' ').map(stemToken));
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

  const termTokens = stemmedTokens(t);
  const titleTokens = stemmedTokens(c);
  let overlap = 0;
  for (const token of termTokens) {
    if (titleTokens.has(token)) overlap++;
  }
  if (overlap === 0) return 0;

  const coverage = overlap / termTokens.size;
  const dice = (2 * overlap) / (termTokens.size + titleTokens.size);
  return Math.round(((coverage + dice) / 2) * 1000) / 1000;
}

/**
 * Match confidence for `harmonize_terms`, derived from the same normalization
 * and score as `find_equivalent` so the two tools never disagree:
 * - `exact` — the title equals the term after normalization (score 1.0);
 * - `strong` — EVERY term token is in the title and the score is ≥ 0.85
 *   (the title adds little beyond the term: "type 2 diabetes" →
 *   "Type 2 diabetes mellitus", 0.929);
 * - `needs_review` — anything else, including a generic term inside a longer
 *   title ("diabetes" → "Type 2 diabetes mellitus", 0.7) and LOINC names that
 *   pin a specimen or method the term did not state.
 * Why 0.85 and not 0.8 (measured live 2026-10-03): at 0.8 every one-word term
 * made any two-word title containing it "strong" (0.833) — "Tylenol" →
 * "Tylenol PM", a different product. A one-word term is ambiguous by nature:
 * it is exact or it goes to a person.
 * Lexical only: synonyms and abbreviations land in `needs_review` — the error
 * is deliberately on the side of asking a person.
 */
export type MatchType = 'exact' | 'strong' | 'needs_review';

export const STRONG_MATCH_MIN_SCORE = 0.85;

export const MATCH_TYPE_NOTE =
  'match_type is computed by this server from the lexical score: exact = title equals the ' +
  'term after normalization; strong = every term word is in the title (or the matched synonym) and match_score >= 0.85; ' +
  'needs_review = anything else. Lexical only — synonyms and abbreviations fall in needs_review.';

export function classifyMatch(term: string, title: string, score: number): MatchType {
  const t = normalizeForMatch(term);
  const c = normalizeForMatch(title);
  if (t.length > 0 && t === c) return 'exact';
  if (score < STRONG_MATCH_MIN_SCORE || t.length === 0) return 'needs_review';
  const titleTokens = stemmedTokens(c);
  const everyTermToken = [...stemmedTokens(t)].every((token) => titleTokens.has(token));
  return everyTermToken ? 'strong' : 'needs_review';
}

/**
 * Best label of a candidate for this term: its title or one of the synonyms
 * its SOURCE publishes (WHO matchingPVs, ICD-11/ICF inclusions and index
 * terms, LOINC related names, MeSH entry terms). Measured 2026-11-24
 * (PROGRESS.md 24.5): scoring by title alone pushed ICD-11 BA41 from the
 * WHO's 1st place to 6th for "heart attack"; with the WHO synonyms it is
 * exact and 1st. The score and the class come from the SAME label, which is
 * reported so a reader sees why a candidate ranked where it did.
 */
export function bestLabelScore(
  term: string,
  title: string,
  synonyms: readonly string[] = [],
): { score: number; label: string; matchType: MatchType } {
  let best = { score: lexicalScore(term, title), label: title };
  for (const s of synonyms) {
    if (!s) continue;
    const score = lexicalScore(term, s);
    if (score > best.score) best = { score, label: s };
  }
  return { ...best, matchType: classifyMatch(term, best.label, best.score) };
}
