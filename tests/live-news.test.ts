import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { liveSources, parseRss, wantsLiveInfo } from "@/lib/pipeline/live-news";

const rss = `<rss><channel><item><title>Markets rally on rate hopes - Reuters</title><link>https://news.google.com/rss/articles/abc</link><pubDate>Fri, 13 Nov 2026 14:00:00 GMT</pubDate><source url="https://reuters.com">Reuters</source></item>
<item><title><![CDATA[Fed &amp; banks: what next - CNBC]]></title><link>javascript:alert(1)</link><source>CNBC</source></item>
<item><title>Oil slips - AP</title><link>https://news.google.com/rss/articles/def</link><source>AP</source></item></channel></rss>`;

describe("live news for open questions", () => {
  it("only time-sensitive questions ask for live data", () => {
    expect(wantsLiveInfo("what is the latest news on the Fed?")).toBe(true);
    expect(wantsLiveInfo("who won the game yesterday")).toBe(true);
    expect(wantsLiveInfo("explain how a binary tree works")).toBe(false);
    expect(wantsLiveInfo("news")).toBe(false);
  });
  it("parses headlines, drops the outlet suffix and unsafe links", () => {
    const items = parseRss(rss);
    expect(items.map(i => i.title)).toEqual(["Markets rally on rate hopes", "Oil slips"]);
    expect(items[0]).toMatchObject({ outlet: "Reuters", date: "2026-11-13" });
  });
  it("returns numbered, untrusted web sources, and nothing for a timeless question or a failed fetch", async () => {
    const f = vi.fn().mockResolvedValue(new Response(rss, { status: 200 }));
    const out = await liveSources("what is the latest news on rates?", f as unknown as typeof fetch);
    expect(out.map(s => s.sourceId)).toEqual(["web:1", "web:2"]);
    expect(out[0]).toMatchObject({ trust: "untrusted", url: "https://news.google.com/rss/articles/abc" });
    expect(out[0].text).toContain("Reuters, 2026-11-13");
    f.mockClear();
    expect(await liveSources("explain recursion to me please", f as unknown as typeof fetch)).toEqual([]);
    expect(f).not.toHaveBeenCalled();
    expect(await liveSources("latest news on rates", (async () => { throw new Error("x"); }) as unknown as typeof fetch)).toEqual([]);
  });
});
