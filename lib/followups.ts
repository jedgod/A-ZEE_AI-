/**
 * Splits the machine-readable follow-up block off the end of an answer:
 *
 *   Related searches:
 *   - first
 *   - second
 *   Keywords: a, b, c
 *
 * Either part may be missing. Anything that doesn't match exactly is left in the answer, so a normal answer is never changed.
 */
export type FollowUps = { body: string; searches: string[]; keywords: string[] };

const BLOCK = /\n{1,3}(?:[-*_]{3,}\s*\n+)?(?:\*\*)?Related searches:?(?:\*\*)?:?[ \t]*\n((?:[ \t]*[-*•][ \t]+.+\n?)+)?\s*(?:(?:\*\*)?Keywords:?(?:\*\*)?:?[ \t]*(.+))?\s*$/i;
const KEYWORDS_ONLY = /\n{1,3}(?:[-*_]{3,}\s*\n+)?(?:\*\*)?Keywords:?(?:\*\*)?:?[ \t]*(.+)\s*$/i;
/** Internal source markers such as [market:1] mean nothing to a reader. */
const MARKERS = /[ \t]?\[market:\d+\]/g;

const clean = (s: string) => s.replace(/^[-*•\s]+/, "").replace(/[*_`]/g, "").trim();

export function splitFollowUps(raw: string): FollowUps {
  const content = raw.replace(MARKERS, "");
  const m = BLOCK.exec(content);
  if (m && (m[1] || m[2])) {
    return {
      body: content.slice(0, m.index).trimEnd(),
      searches: (m[1] ?? "").split("\n").map(clean).filter(s => s.length >= 3 && s.length <= 120).slice(0, 4),
      keywords: (m[2] ?? "").split(",").map(clean).filter(s => s.length >= 2 && s.length <= 40).slice(0, 6),
    };
  }
  const k = KEYWORDS_ONLY.exec(content);
  if (k) return { body: content.slice(0, k.index).trimEnd(), searches: [], keywords: k[1].split(",").map(clean).filter(s => s.length >= 2 && s.length <= 40).slice(0, 6) };
  return { body: content, searches: [], keywords: [] };
}
