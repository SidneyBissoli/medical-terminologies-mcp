/**
 * Plain text of a WHO search title.
 *
 * The WHO search marks matches with <em class='found'> even with highlighting
 * off in some fields. Drop that markup, then any stray angle bracket: a
 * multi-character tag regex alone leaves "<script" behind on input like
 * "<<b>script>" (CodeQL js/incomplete-multi-character-sanitization).
 */
export function plainTitle(title: string): string {
  return title.replace(/<\/?em\b[^>]*>/gi, '').replace(/[<>]/g, '');
}
