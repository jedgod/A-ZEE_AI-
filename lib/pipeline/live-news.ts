import "server-only";
import { safeUrl } from "@/11_POSTPROCESS/citations/module";
import { searchConfigured, webSearch } from "@/lib/search/tavily";
import { ollamaOnly } from "./privacy";
import type { RetrievedSource } from "./context";

/**
 * Live information for open, time-sensitive questions ("what's the latest on…", "news today", "who won last night").
 * Without it the model answers from memory and says it cannot know. Headlines come from Tavily when TAVILY_API_KEY is set,
 * otherwise from Google News RSS (no key). Everything returned is untrusted data for the model to cite, never instructions.
 * Set LIVE_NEWS_DISABLED=1 to turn it off. Nothing leaves the server in ollama-only mode.
 */
const TIMEOUT_MS = 6000;
const MAX_ITEMS = 6;

const LIVE = /\b(news|headlines?|latest|breaking|today|tonight|yesterday|this (?:week|weekend|month)|right now|currently|recent(?:ly)?|latest updates?|happening|going on|who (?:won|is winning|leads?)|scores?|weather|forecast|stock market|election|announced|trending)\b/i;

/** True when the question is about something that changes, so a stale memory answer would be wrong. */
export function wantsLiveInfo(text: string): boolean {
  const t = text.trim();
  return t.length >= 8 && t.length <= 600 && LIVE.test(t);
}

const decode = (s: string) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/<[^>]+>/g, " ")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/\s+/g, " ").trim();
const tag = (item: string, name: string) => decode(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(item)?.[1] ?? "");

/** Parses Google News RSS items into headline, link, outlet and date. Exported for tests. */
export function parseRss(xml: string): { title: string; url: string; outlet: string; date: string | null }[] {
  const out: { title: string; url: string; outlet: string; date: string | null }[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const item = m[1];
    const url = safeUrl(tag(item, "link"));
    const outlet = tag(item, "source");
    let title = tag(item, "title");
    if (outlet && title.endsWith(` - ${outlet}`)) title = title.slice(0, -(outlet.length + 3));
    const t = Date.parse(tag(item, "pubDate"));
    if (!url || !title) continue;
    out.push({ title: title.slice(0, 300), url, outlet, date: Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null });
  }
  return out;
}

const searchTerms = (question: string) => question.replace(/\s+/g, " ").replace(/[^\p{L}\p{N}\s'&.,:%$/-]/gu, " ").trim().slice(0, 200);

export async function liveSources(question: string, fetchImpl: typeof fetch = fetch): Promise<RetrievedSource[]> {
  if (ollamaOnly() || process.env.LIVE_NEWS_DISABLED === "1" || !wantsLiveInfo(question)) return [];
  const q = searchTerms(question);
  if (q.length < 4) return [];
  try {
    if (searchConfigured()) {
      const results = await webSearch(q, { maxResults: MAX_ITEMS, depth: "basic", topic: "news", days: 14 }, fetchImpl);
      return results.map((r, i) => ({
        sourceId: `web:${i + 1}`, title: r.title, url: r.url, trust: "untrusted" as const,
        text: `${r.title} (${r.domain}${r.publishedAt ? `, ${r.publishedAt.slice(0, 10)}` : ""}): ${r.content.slice(0, 1200)}`,
      }));
    }
    const res = await fetchImpl(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`, {
      headers: { Accept: "application/rss+xml, application/xml" }, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const xml = (await res.text()).slice(0, 600_000);
    return parseRss(xml).slice(0, MAX_ITEMS).map((n, i) => ({
      sourceId: `web:${i + 1}`, title: n.title, url: n.url, trust: "untrusted" as const,
      text: `Headline: ${n.title}${n.outlet ? ` (${n.outlet}${n.date ? `, ${n.date}` : ""})` : n.date ? ` (${n.date})` : ""}`,
    }));
  } catch { return []; }
}
