import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { classifyImage, discoverImage, platformForUrl, safePublicUrl } from "@/lib/vision/providers";

let image: Uint8Array;
beforeAll(async () => { image = new Uint8Array(await sharp({ create: { width: 32, height: 32, channels: 3, background: "#345" } }).png().toBuffer()); });
beforeEach(() => {
  vi.stubEnv("SIGHTENGINE_API_USER", "test-user"); vi.stubEnv("SIGHTENGINE_API_SECRET", "test-secret");
  vi.stubEnv("GOOGLE_VISION_API_KEY", "test-key"); vi.stubEnv("AZ_PROVIDER_MODE", "default");
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
const transport = (body: unknown) => vi.fn<typeof fetch>(async () => Response.json(body));

describe("provider egress gates", () => {
  it("never calls a provider without its own consent", async () => {
    const send = transport({});
    expect((await classifyImage(image, "image/png", false, send)).status).toBe("skipped");
    expect((await discoverImage(image, false, send)).status).toBe("skipped");
    expect(send).not.toHaveBeenCalled();
  });
  it("fails closed in private mode and with missing credentials", async () => {
    const send = transport({});
    vi.stubEnv("AZ_PROVIDER_MODE", "ollama-only");
    expect((await classifyImage(image, "image/png", true, send)).status).toBe("unavailable");
    expect((await discoverImage(image, true, send)).status).toBe("unavailable");
    vi.stubEnv("AZ_PROVIDER_MODE", "default"); vi.stubEnv("SIGHTENGINE_API_SECRET", ""); vi.stubEnv("GOOGLE_VISION_API_KEY", "");
    expect((await classifyImage(image, "image/png", true, send)).status).toBe("not_configured");
    expect((await discoverImage(image, true, send)).status).toBe("not_configured");
    expect(send).not.toHaveBeenCalled();
  });
});

describe("AI classifier", () => {
  it.each([{ score: 0.95, label: "LIKELY_AI" }, { score: 0.5, label: "INCONCLUSIVE" }, { score: 0.03, label: "LOW_AI_SIGNAL" }])("classifies score $score as $label without claiming calibration", async ({ score, label }) => {
    const send = transport({ status: "success", type: { ai_generated: score } });
    expect(await classifyImage(image, "image/png", true, send)).toMatchObject({ status: "checked", score, label, calibrated: false, model: "genai" });
    const [url, init] = send.mock.calls[0];
    expect(url).toBe("https://api.sightengine.com/1.0/check.json");
    expect(init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" });
    expect((init!.body as FormData).get("models")).toBe("genai");
  });
  it.each([-0.1, 1.1, "0.95", null])("rejects invalid provider score %j", async score => {
    expect((await classifyImage(image, "image/png", true, transport({ status: "success", type: { ai_generated: score } }))).status).toBe("unavailable");
  });
  it("bounds response size and rejects upstream failures without exposing their text", async () => {
    const huge = vi.fn<typeof fetch>(async () => new Response("x".repeat(1_000_001)));
    expect((await classifyImage(image, "image/png", true, huge)).status).toBe("unavailable");
    const failed = vi.fn<typeof fetch>(async () => new Response("secret-upstream-error", { status: 403 }));
    const result = await classifyImage(image, "image/png", true, failed);
    expect(result.status).toBe("unavailable"); expect(JSON.stringify(result)).not.toContain("secret-upstream-error");
  });
  it("aborts a stalled request", async () => {
    vi.useFakeTimers();
    const stalled = vi.fn<typeof fetch>(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    const result = classifyImage(image, "image/png", true, stalled);
    await vi.advanceTimersByTimeAsync(12_001);
    expect((await result).status).toBe("unavailable");
  });
});

describe("public web discovery", () => {
  it("returns bounded, deduplicated visual evidence and labels actual social domains", async () => {
    const send = transport({ responses: [{ webDetection: {
      pagesWithMatchingImages: [{ url: "https://www.tiktok.com/@user/video/1" }, { url: "https://x.com/user/status/2" }, { url: "https://127.0.0.1/private" }, { url: "javascript:alert(1)" }],
      fullMatchingImages: [{ url: "https://x.com/user/status/2" }, { url: "https://cdn.real-site.com/pic.jpg" }],
      partialMatchingImages: [{ url: "https://linkedin.com.evil.com/image" }],
    } }] });
    const result = await discoverImage(image, true, send);
    expect(result).toMatchObject({ status: "checked", scope: "provider_public_index" });
    if (result.status !== "checked") throw new Error("not checked");
    expect(result.matches.map(m => m.platform)).toEqual(["TikTok", "X", "Public web", "Public web"]);
    expect(result.matches).toHaveLength(4);
    expect(send).toHaveBeenCalledTimes(1); // Returned URLs are never fetched.
    const [url, init] = send.mock.calls[0];
    expect(url).toBe("https://vision.googleapis.com/v1/images:annotate");
    expect(init!.headers).toMatchObject({ "X-Goog-Api-Key": "test-key" });
    expect(JSON.parse(init!.body as string).requests[0].features[0].type).toBe("WEB_DETECTION");
  });
  it("distinguishes a successful empty annotation from missing/error responses", async () => {
    expect(await discoverImage(image, true, transport({ responses: [{ webDetection: {} }] }))).toMatchObject({ status: "checked", matches: [] });
    expect((await discoverImage(image, true, transport({ responses: [{}] }))).status).toBe("unavailable");
    expect((await discoverImage(image, true, transport({ responses: [{ error: { code: 403 } }] }))).status).toBe("unavailable");
  });
  it("limits results to twenty and never treats pages as byte-exact matches", async () => {
    const pages = Array.from({ length: 40 }, (_, i) => ({ url: `https://www.public-site.com/${i}` }));
    const result = await discoverImage(image, true, transport({ responses: [{ webDetection: { pagesWithMatchingImages: pages } }] }));
    expect(result.status).toBe("checked");
    if (result.status === "checked") { expect(result.matches).toHaveLength(20); expect(result.matches.every(m => m.kind === "matching_page")).toBe(true); }
  });
  it.each(["http://facebook.com/x", "https://user:secret@facebook.com/x", "https://10.0.0.1/a", "https://[::1]/", "https://localhost/a", "https://host.internal/a", "https://site.com:8080/a"])('rejects unsafe URL %s', url => {
    expect(safePublicUrl(url)).toBeUndefined();
  });
  it("uses domain boundaries when assigning platforms", () => {
    expect(platformForUrl("https://m.youtube.com/watch?v=1")).toBe("YouTube");
    expect(platformForUrl("https://facebook.com.attacker.com/a")).toBe("Public web");
    expect(platformForUrl("https://t.me/public_post/1")).toBe("Telegram");
  });
});
