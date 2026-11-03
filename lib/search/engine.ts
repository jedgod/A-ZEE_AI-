import "server-only";
import { z } from "zod";
import type { RequestActor } from "@/lib/pipeline/actor";
import { openSession } from "./session";
import { getSource, recordAnswer, saveSources, type StoredSource } from "./store";
import { SEARCH_PROVIDER, searchConfigured, SearchNotConfiguredError, webSearch } from "./tavily";
import { checkClaims, freshness, summarize, unknownCitations, type CheckedClaim } from "./verify";

// A-Zee Smart Search: live web retrieval (Tavily) → retrieval-augmented answer with numbered
// citations → citation-span verification → recorded with sources, retrieval time and model.

const citationSchema = z.object({ n: z.number().int().min(1).max(20), quote: z.string().min(1).max(600) });
const claimSchema = z.object({ text: z.string().min(1).max(1000), citations: z.array(citationSchema).max(5) });

export type PublicSource = {
  n: number; id: string; title: string; url: string; domain: string; publishedAt: string | null;
  retrievedAt: string; relevance: number | null; freshness: ReturnType<typeof freshness>;
};
const publicSource = (s: StoredSource, i: number): PublicSource => ({
  n: i + 1, id: s.id, title: s.title, url: s.url, domain: s.domain, publishedAt: s.publishedAt,
  retrievedAt: s.retrievedAt, relevance: s.relevance, freshness: freshness(s.publishedAt),
});
/** Sources as model input: numbered, dated, trimmed. Untrusted data. */
const forModel = (sources: StoredSource[]) => sources.map((s, i) => ({
  n: i + 1, title: s.title, url: s.url, published: s.publishedAt?.slice(0, 10) ?? "unknown", text: s.content.slice(0, 3_000),
}));

const QUERY_SYSTEM = [
  "You are A-Zee Search. Answer the question using ONLY the numbered sources provided.",
  "Write a concise Markdown answer. End EVERY sentence that states a fact with its source number(s) in square brackets, like: The plant is 40 cm tall [1]. Do not cite numbers that don't exist.",
  "If the sources don't answer something, say so plainly instead of guessing. Note disagreements between sources.",
  "Also list the answer's key factual claims. For every claim, give the source numbers and an EXACT quote (copied word for word, 8–40 words) from that source's text that supports it.",
  'Shape: {"answer": string, "claims": [{"text": string, "citations": [{"n": number, "quote": string}]}]}',
].join("\n");

export async function smartSearch(ownerId: string, actor: RequestActor, rawQuery: string, options: { recency?: "any" | "week" | "month" | "year" } = {}, fetchImpl: typeof fetch = fetch) {
  const query = z.string().trim().min(2).max(500).parse(rawQuery);
  if (!searchConfigured()) throw new SearchNotConfiguredError();   // before preflight, so the error says what to set up
  const session = await openSession(actor, query, ["messages"], fetchImpl);
  let ok = false;
  try {
    const days = { any: undefined, week: 7, month: 31, year: 365 }[options.recency ?? "any"];
    const retrievedAt = new Date().toISOString();
    const results = await webSearch(query, { maxResults: 6, depth: "advanced", ...(days ? { days, topic: "news" as const } : {}) }, fetchImpl);
    const sources = await saveSources(ownerId, results, SEARCH_PROVIDER);
    if (!sources.length) {
      ok = true;
      const id = await recordAnswer(ownerId, { kind: "query", query, answer: "", sourceIds: [], claims: [], verification: summarize([]), model: null, provider: SEARCH_PROVIDER, retrievedAt });
      return { id, query, answer: "No sources were found for this search. Try different words.", sources: [], claims: [], verification: summarize([]), unknownCitations: [], model: null, provider: SEARCH_PROVIDER, retrievedAt };
    }
    const out = await session.json(QUERY_SYSTEM, { question: query, sources: forModel(sources) },
      z.object({ answer: z.string().min(1).max(20_000), claims: z.array(claimSchema).max(12) }));
    await session.checkOutput(out.answer);
    const claims = checkClaims(out.claims, sources);
    const verification = summarize(claims);
    // An answer without inline [n] markers still shows what supports it: the sources whose quotes verified.
    const verifiedSources = [...new Set(claims.flatMap(c => c.citations.filter(x => x.found).map(x => x.n)))].sort((a, b) => a - b);
    if (!/(?<![\w\])])\[\d{1,3}\](?!\()/.test(out.answer) && verifiedSources.length) {
      out.answer = `${out.answer.trimEnd()}\n\nSources: ${verifiedSources.map(n => `[${n}]`).join(" ")}`;
    }
    const unknown = unknownCitations(out.answer, sources.length);
    const id = await recordAnswer(ownerId, {
      kind: "query", query, answer: out.answer, sourceIds: sources.map(s => s.id), claims, verification,
      model: session.model(), provider: SEARCH_PROVIDER, retrievedAt,
    });
    ok = true;
    return { id, query, answer: out.answer, sources: sources.map(publicSource), claims, verification, unknownCitations: unknown, model: session.model(), provider: SEARCH_PROVIDER, retrievedAt };
  } finally {
    await session.close(ok);
  }
}

const VERIFY_SYSTEM = [
  "You check a factual claim against the numbered sources provided (and nothing else).",
  'verdict: "supported" if the sources support it, "contradicted" if they contradict it, "not_found" if they don\'t address it.',
  "For supported or contradicted, give EXACT quotes (copied word for word, 8–40 words) from the sources.",
  'Shape: {"verdict": "supported"|"contradicted"|"not_found", "explanation": string, "citations": [{"n": number, "quote": string}]}',
].join("\n");

/** POST /api/v1/search/verify-claims: each claim checked against freshly retrieved sources. */
export async function verifyClaimsLive(ownerId: string, actor: RequestActor, rawClaims: unknown, fetchImpl: typeof fetch = fetch) {
  const claims = z.array(z.string().trim().min(5).max(500)).min(1).max(5).parse(rawClaims);
  if (!searchConfigured()) throw new SearchNotConfiguredError();
  const session = await openSession(actor, claims.join("\n"), ["messages"], fetchImpl);
  let ok = false;
  try {
    const retrievedAt = new Date().toISOString();
    const results = [];
    for (const claim of claims) {
      const sources = await saveSources(ownerId, await webSearch(claim, { maxResults: 4, depth: "advanced" }, fetchImpl), SEARCH_PROVIDER);
      if (!sources.length) { results.push({ claim, verdict: "not_found" as const, explanation: "No sources were found.", citations: [], sources: [] }); continue; }
      const out = await session.json(VERIFY_SYSTEM, { claim, sources: forModel(sources) }, z.object({
        verdict: z.enum(["supported", "contradicted", "not_found"]), explanation: z.string().max(2000), citations: z.array(citationSchema).max(5),
      }));
      const [checked] = checkClaims([{ text: claim, citations: out.citations }], sources);
      // A verdict without a quote that is really in a source can't stand: report it as unverified.
      const verdict = out.verdict !== "not_found" && checked.status !== "verified" ? "unverified" as const : out.verdict;
      results.push({ claim, verdict, explanation: out.explanation, citations: checked.citations, sources: sources.map(publicSource) });
    }
    const id = await recordAnswer(ownerId, {
      kind: "verify", query: claims.join("\n"), answer: "", sourceIds: results.flatMap(r => r.sources.map(s => s.id)),
      claims: results.map(r => ({ text: r.claim, verdict: r.verdict, citations: r.citations })), verification: { verdicts: results.map(r => r.verdict) },
      model: session.model(), provider: SEARCH_PROVIDER, retrievedAt,
    });
    ok = true;
    return { id, retrievedAt, model: session.model(), results };
  } finally {
    await session.close(ok);
  }
}

const COMPARE_SYSTEM = [
  "Compare the two options using ONLY the numbered sources. Build a comparison across the most decision-relevant aspects.",
  "Every cell must cite sources with EXACT quotes (copied word for word, 8–40 words). If the sources don't cover an aspect for an option, say \"not covered by sources\" and give no citation.",
  'Shape: {"summary": string (Markdown, cite as [n]), "rows": [{"aspect": string, "a": {"text": string, "citations": [{"n": number, "quote": string}]}, "b": {"text": string, "citations": [...]}}]}',
].join("\n");

/** POST /api/v1/search/compare: two options compared aspect by aspect, every cell verified. */
export async function compare(ownerId: string, actor: RequestActor, raw: unknown, fetchImpl: typeof fetch = fetch) {
  const input = z.object({ a: z.string().trim().min(1).max(200), b: z.string().trim().min(1).max(200), focus: z.string().trim().max(300).optional() }).strict().parse(raw);
  const question = `${input.a} vs ${input.b}${input.focus ? ` — ${input.focus}` : ""}`;
  if (!searchConfigured()) throw new SearchNotConfiguredError();
  const session = await openSession(actor, question, ["messages"], fetchImpl);
  let ok = false;
  try {
    const retrievedAt = new Date().toISOString();
    const found = [
      ...await webSearch(question, { maxResults: 4 }, fetchImpl),
      ...await webSearch(`${input.a} ${input.focus ?? ""}`.trim(), { maxResults: 3 }, fetchImpl),
      ...await webSearch(`${input.b} ${input.focus ?? ""}`.trim(), { maxResults: 3 }, fetchImpl),
    ].filter((r, i, all) => all.findIndex(x => x.url === r.url) === i).slice(0, 10);
    const sources = await saveSources(ownerId, found, SEARCH_PROVIDER);
    const cell = z.object({ text: z.string().max(2000), citations: z.array(citationSchema).max(4) });
    const out = await session.json(COMPARE_SYSTEM, { optionA: input.a, optionB: input.b, focus: input.focus ?? null, sources: forModel(sources) },
      z.object({ summary: z.string().max(10_000), rows: z.array(z.object({ aspect: z.string().max(200), a: cell, b: cell })).max(12) }), 4000);
    await session.checkOutput(out.summary);
    const rows = out.rows.map(r => ({
      aspect: r.aspect,
      a: checkClaims([{ text: r.a.text, citations: r.a.citations }], sources)[0],
      b: checkClaims([{ text: r.b.text, citations: r.b.citations }], sources)[0],
    }));
    const cells: CheckedClaim[] = rows.flatMap(r => [r.a, r.b]);
    const verification = summarize(cells);
    const id = await recordAnswer(ownerId, {
      kind: "compare", query: question, answer: out.summary, sourceIds: sources.map(s => s.id), claims: rows, verification,
      model: session.model(), provider: SEARCH_PROVIDER, retrievedAt,
    });
    ok = true;
    return { id, a: input.a, b: input.b, summary: out.summary, rows, sources: sources.map(publicSource), verification, model: session.model(), retrievedAt };
  } finally {
    await session.close(ok);
  }
}

/** GET /api/v1/search/sources/:id */
export async function sourceById(ownerId: string, id: string) {
  const source = await getSource(ownerId, id);
  return source ? { ...publicSource(source, 0), n: undefined, excerpt: source.content, provider: source.provider } : null;
}
