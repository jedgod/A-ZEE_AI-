import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { firstPageUrl, htmlToText, isPublicAddress, pageSources } from "@/lib/pipeline/page-context";
import { splitFollowUps } from "@/lib/followups";

describe("page context", () => {
  it("finds only a plain https link", () => {
    expect(firstPageUrl("summarise https://example.com/a?b=1.")).toBe("https://example.com/a?b=1");
    expect(firstPageUrl("http://example.com")).toBeNull();
    expect(firstPageUrl("https://user:pw@example.com/")).toBeNull();
    expect(firstPageUrl("https://example.com:8443/")).toBeNull();
    expect(firstPageUrl("no link here")).toBeNull();
  });
  it("refuses private, loopback, metadata and reserved addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) expect(isPublicAddress(ip), ip).toBe(false);
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) expect(isPublicAddress(ip), ip).toBe(true);
  });
  it("never opens an internal address", async () => {
    const r = await pageSources("summarise https://169.254.169.254/latest/meta-data/");
    expect(r.sources).toEqual([]);
    expect(r.note).toMatch(/private or internal/);
    expect((await pageSources("what is https://localhost/")).sources).toEqual([]);
  });
  it("extracts readable text and drops scripts, menus and markup", () => {
    const { title, text } = htmlToText("<html><head><title>Hi &amp; bye</title><meta name=\"description\" content=\"Short desc\"></head><body><nav>Menu</nav><script>alert(1)</script><h1>Heading</h1><p>Body copy here.</p></body></html>");
    expect(title).toBe("Hi & bye");
    expect(text).toContain("Short desc"); expect(text).toContain("Heading"); expect(text).toContain("Body copy here.");
    expect(text).not.toMatch(/Menu|alert/);
  });
});

describe("follow-up block", () => {
  it("splits searches and keywords off the end", () => {
    const r = splitFollowUps("Answer text.\n\nRelated searches:\n- what is x\n- how does y work\nKeywords: alpha, beta, gamma");
    expect(r.body).toBe("Answer text.");
    expect(r.searches).toEqual(["what is x", "how does y work"]);
    expect(r.keywords).toEqual(["alpha", "beta", "gamma"]);
  });
  it("leaves ordinary answers untouched", () => {
    const t = "Just an answer.\n\nSee related searches in your browser.";
    expect(splitFollowUps(t)).toEqual({ body: t, searches: [], keywords: [] });
  });
});

describe("follow-up block as models actually write it", () => {
  it("handles a rule before it, a blank line before Keywords, and stray source markers", () => {
    const r = splitFollowUps("Bitcoin is up [market:1].\n\n---\n\nRelated searches:\n- one thing\n- another thing\n\nKeywords: Bitcoin price, gold price");
    expect(r.body).toBe("Bitcoin is up.");
    expect(r.searches).toEqual(["one thing", "another thing"]);
    expect(r.keywords).toEqual(["Bitcoin price", "gold price"]);
  });
});
