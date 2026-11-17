import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/chat/web", () => ({ chatAllowed: async () => true }));
vi.mock("@/lib/sidebar-route", () => ({
  sidebarOwner: async () => "test-account",
  handle: (fn: () => Promise<Response>) => fn(),
  NO_STORE: { "Cache-Control": "no-store" },
}));
vi.mock("@/lib/vision/scans", () => ({ saveScan: async (_owner: string, result: unknown) => result }));

const google = vi.hoisted(() => vi.fn(async () => ({ status: "ran", model: "test", observations: {} })));
vi.mock("@/lib/vision/gemini", () => ({ googleObservations: google, geminiVisionReady: () => true }));
const external = vi.hoisted(() => ({
  classify: vi.fn(async () => ({ status: "skipped", provider: "sightengine", reason: "test" })),
  discover: vi.fn(async () => ({ status: "skipped", provider: "google_vision", reason: "test" })),
  reserve: vi.fn(async () => "provider-request" as string | null),
  finish: vi.fn(async () => undefined),
}));
vi.mock("@/lib/vision/providers", () => ({ classifyImage: external.classify, discoverImage: external.discover, classifierReady: () => true, discoveryReady: () => true }));
vi.mock("@/lib/vision/provider-budget", () => ({ reserveProviders: external.reserve, finishProviders: external.finish }));
beforeEach(() => { external.classify.mockClear(); external.discover.mockClear(); external.reserve.mockClear().mockResolvedValue("provider-request"); external.finish.mockClear(); });
beforeEach(() => google.mockClear());

import { POST } from "@/app/api/vision/detect-ai/route";
import sharp from "sharp";

describe("image scan multipart route", () => {
  it("accepts an actual image even if the mobile client sends a generic MIME type", async () => {
    const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#222" } }).png().toBuffer();
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(png)]), "image");
    const response = await POST(new Request("http://localhost/api/vision/detect-ai", { method: "POST", body: form }));
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    expect(data.verification.credential).toBe("absent");
    expect(data.verification.google.status).toBe("skipped");
    expect(google).not.toHaveBeenCalled();
  }, 15_000); // Cold native C2PA startup can exceed the default 5s on Windows.

  it("rejects an oversized multipart body without depending on Content-Length", async () => {
    const init = { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=test" },
      body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(11 * 1024 * 1024)); c.close(); } }), duplex: "half" };
    const response = await POST(new Request("http://localhost/api/vision/detect-ai", init));
    expect(response.status).toBe(413);
  });
});

describe("per-image Google consent enforcement", () => {
  async function upload(consents: string[], valid = true) {
    const bytes = valid
      ? await sharp({ create: { width: 32, height: 32, channels: 3, background: "#222" } }).png().toBuffer()
      : Buffer.from("not an image");
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(bytes)]), "image.png");
    consents.forEach(value => form.append("googleConsent", value));
    return POST(new Request("http://localhost/api/vision/detect-ai", { method: "POST", body: form }));
  }
  it.each([{ consent: [] }, { consent: ["false"] }])("does not invoke external processing for $consent", async ({ consent }) => {
    const response = await upload(consent);
    expect(response.status).toBe(200);
    expect(google).not.toHaveBeenCalled();
  });
  it("uses Google only for this explicitly consented image and passes the actual MIME", async () => {
    expect((await upload(["true"])).status).toBe(200);
    expect(google).toHaveBeenCalledWith(expect.any(Uint8Array), "image/png", true);
    google.mockClear();
    expect((await upload([])).status).toBe(200);
    expect(google).not.toHaveBeenCalled();
  });
  it.each([{ consent: ["yes"] }, { consent: ["TRUE"] }, { consent: ["true", "false"] }, { consent: ["true", "true"] }])("rejects ambiguous or malformed consent $consent", async ({ consent }) => {
    expect((await upload(consent)).status).toBe(400);
    expect(google).not.toHaveBeenCalled();
  });
  it("validates image bytes before any consented external processing", async () => {
    expect((await upload(["true"], false)).status).toBe(422);
    expect(google).not.toHaveBeenCalled();
  });
});

describe("independent provider choices and budget", () => {
  async function request(fields: Record<string, string>) {
    const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#222" } }).png().toBuffer();
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(png)]), "image.png");
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return POST(new Request("http://localhost/api/vision/detect-ai", { method: "POST", body: form }));
  }
  it("defaults each provider to false, separately from Google Gemini", async () => {
    const response = await request({ googleConsent: "true" });
    expect(response.status).toBe(200);
    expect(external.classify).toHaveBeenCalledWith(expect.any(Uint8Array), "image/png", false);
    expect(external.discover).toHaveBeenCalledWith(expect.any(Uint8Array), false);
    expect((await response.json()).data.verification.consent).toEqual({ googleGemini: true, sightengine: false, googleVision: false });
  });
  it("reserves a database lease before separately consented classifier and discovery calls", async () => {
    const response = await request({ classifierConsent: "true", discoveryConsent: "true" });
    expect(response.status).toBe(200);
    expect(google).not.toHaveBeenCalled();
    expect(external.reserve).toHaveBeenCalledWith("test-account", { googleGemini: false, sightengine: true, googleVision: true });
    expect(external.classify).toHaveBeenCalledWith(expect.any(Uint8Array), "image/png", true);
    expect(external.discover).toHaveBeenCalledWith(expect.any(Uint8Array), true);
    expect(external.reserve.mock.invocationCallOrder[0]).toBeLessThan(external.classify.mock.invocationCallOrder[0]);
  });
  it("does no external work when the database budget refuses the request", async () => {
    external.reserve.mockResolvedValue(null);
    expect((await request({ classifierConsent: "true", discoveryConsent: "true" })).status).toBe(429);
    expect(external.classify).not.toHaveBeenCalled();
    expect(external.discover).not.toHaveBeenCalled();
    expect(google).not.toHaveBeenCalled();
  });
  it.each(["classifierConsent", "discoveryConsent"])("rejects malformed %s before processing", async field => {
    expect((await request({ [field]: "yes" })).status).toBe(400);
    expect(external.reserve).not.toHaveBeenCalled();
    expect(external.classify).not.toHaveBeenCalled();
    expect(external.discover).not.toHaveBeenCalled();
  });
});
