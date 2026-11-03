// Trust and verification for A-Zee Search (no server-only: pure functions, unit-tested).
//
// Citation-span validation: the model must quote the exact text that supports each claim. A claim
// is "verified" only when its quote is actually present in the cited source's retrieved text.
// This catches invented citations and misattributed quotes; it does not prove the source is right.

export type ClaimCitation = { n: number; quote: string };
export type CheckedCitation = ClaimCitation & { found: boolean };
export type ClaimStatus = "verified" | "unverified" | "uncited";
export type CheckedClaim = { text: string; citations: CheckedCitation[]; status: ClaimStatus };
export type Verification = { verified: number; unverified: number; uncited: number; total: number };

const MIN_QUOTE_WORDS = 4;

export function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase()
    .replace(/[‘’“”"'`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The quote appears in the source text (ignoring case, punctuation and spacing). */
export function quoteFound(quote: string, sourceText: string): boolean {
  const q = normalize(quote);
  if (q.split(" ").filter(Boolean).length < MIN_QUOTE_WORDS) return false;
  return normalize(sourceText).includes(q);
}

export function checkClaims(claims: { text: string; citations: ClaimCitation[] }[], sources: { content: string }[]): CheckedClaim[] {
  return claims.map(claim => {
    const citations = claim.citations.map(c => {
      const source = sources[c.n - 1];
      return { ...c, found: !!source && quoteFound(c.quote, source.content) };
    });
    const status: ClaimStatus = !citations.length ? "uncited" : citations.some(c => c.found) ? "verified" : "unverified";
    return { text: claim.text, citations, status };
  });
}

export function summarize(claims: { status: ClaimStatus }[]): Verification {
  return {
    verified: claims.filter(c => c.status === "verified").length,
    unverified: claims.filter(c => c.status === "unverified").length,
    uncited: claims.filter(c => c.status === "uncited").length,
    total: claims.length,
  };
}

/** [n] markers in the answer that point at no retrieved source. */
export function unknownCitations(answer: string, sourceCount: number): number[] {
  const prose = answer.replace(/```[\s\S]*?(?:```|$)|`[^`\n]*`/g, " ");
  const ids = [...prose.matchAll(/(?<![\w\])])\[(\d{1,3})\](?!\()/g)].map(m => Number(m[1]));
  return [...new Set(ids.filter(n => n < 1 || n > sourceCount))];
}

export type Freshness = "fresh" | "recent" | "older" | "unknown";
export function freshness(publishedAt: string | null, now = Date.now()): { label: Freshness; ageDays: number | null } {
  if (!publishedAt) return { label: "unknown", ageDays: null };
  const ageDays = Math.max(0, Math.floor((now - Date.parse(publishedAt)) / 86_400_000));
  return { label: ageDays <= 30 ? "fresh" : ageDays <= 365 ? "recent" : "older", ageDays };
}
