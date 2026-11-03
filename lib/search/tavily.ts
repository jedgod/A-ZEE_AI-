import "server-only";
import { z } from "zod";
import { safeUrl } from "@/11_POSTPROCESS/citations/module";

// Web discovery through Tavily (https://tavily.com). Set TAVILY_API_KEY in .env.local.
// TAVILY_BASE_URL overrides the endpoint (used by scripts/check-search.cjs with a local fake).
// Results are untrusted web content: callers pass them to models as data, never as instructions.

export type WebResult = { url: string; domain: string; title: string; content: string; publishedAt: string | null; relevance: number | null };

export class SearchNotConfiguredError extends Error {
  constructor() { super("SEARCH_NOT_CONFIGURED"); }
}
export class SearchUnavailableError extends Error {
  constructor(public status?: number) { super("SEARCH_UNAVAILABLE"); }
}

export const searchConfigured = () => Boolean(process.env.TAVILY_API_KEY?.trim());
export const SEARCH_PROVIDER = "tavily";
const MAX_CONTENT = 5_000;

const responseSchema = z.object({
  results: z.array(z.object({
    url: z.string(),
    title: z.string().nullish(),
    content: z.string().nullish(),
    score: z.number().nullish(),
    published_date: z.string().nullish(),
  })).max(50),
});

const dateOf = (value: string | null | undefined) => {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) && t <= Date.now() + 86_400_000 ? new Date(t).toISOString() : null;
};

export async function webSearch(
  query: string,
  options: { maxResults?: number; depth?: "basic" | "advanced"; topic?: "general" | "news"; days?: number } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<WebResult[]> {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) throw new SearchNotConfiguredError();
  const base = (process.env.TAVILY_BASE_URL || "https://api.tavily.com").replace(/\/+$/, "");
  let response: Response;
  try {
    response = await fetchImpl(`${base}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        query: query.slice(0, 400),
        search_depth: options.depth ?? "advanced",
        topic: options.topic ?? "general",
        max_results: Math.min(Math.max(options.maxResults ?? 6, 1), 10),
        include_answer: false,
        include_raw_content: false,
        ...(options.days ? { days: options.days } : {}),
      }),
      signal: AbortSignal.timeout(Number(process.env.SEARCH_TIMEOUT_MS) || 20_000),
    });
  } catch {
    throw new SearchUnavailableError();
  }
  if (!response.ok) throw new SearchUnavailableError(response.status);
  let parsed;
  try { parsed = responseSchema.parse(await response.json()); }
  catch { throw new SearchUnavailableError(); }

  const seen = new Set<string>();
  const results: WebResult[] = [];
  for (const r of parsed.results) {
    const url = safeUrl(r.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const content = (r.content ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_CONTENT);
    if (!content) continue;
    results.push({
      url, domain: new URL(url).hostname.replace(/^www\./, ""),
      title: (r.title ?? "").trim().slice(0, 300) || new URL(url).hostname,
      content, publishedAt: dateOf(r.published_date), relevance: typeof r.score === "number" ? Math.max(0, Math.min(1, r.score)) : null,
    });
  }
  return results;
}
