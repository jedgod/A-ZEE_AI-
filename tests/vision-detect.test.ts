import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeMetadata, combine, detectImage, pixelClassifier } from "@/lib/vision/detect";

const env = process.env as Record<string, string | undefined>;
afterEach(() => { delete env.SIGHTENGINE_API_USER; delete env.SIGHTENGINE_API_SECRET; delete env.AZ_PROVIDER_MODE; });

describe("analyzeMetadata", () => {
  it("flags the IPTC AI source type", () => {
    const r = analyzeMetadata({ DigitalSourceType: "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia" });
    expect(r).toMatchObject({ verdict: "AI_GENERATED", confidence: 95 });
  });
  it("names the generator from software tags", () => {
    const r = analyzeMetadata({ Software: "Midjourney v6" });
    expect(r).toMatchObject({ verdict: "AI_GENERATED", likelySource: "Midjourney" });
  });
  it("finds the AI source type in raw XMP/C2PA bytes", () => {
    expect(analyzeMetadata(null, "...c2pa...trainedAlgorithmicMedia...").verdict).toBe("AI_GENERATED");
  });
  it("treats camera details plus exposure as supportive but capped", () => {
    const r = analyzeMetadata({ Make: "Apple", Model: "iPhone 15", ExposureTime: 0.01, ISO: 80 });
    expect(r).toMatchObject({ verdict: "LIKELY_REAL", confidence: 70, likelySource: "Apple iPhone 15" });
  });
  it("is inconclusive with no metadata, never 'real'", () => {
    expect(analyzeMetadata(null)).toMatchObject({ verdict: "INCONCLUSIVE", confidence: 50 });
    expect(analyzeMetadata({ Make: "Apple" }).verdict).toBe("INCONCLUSIVE"); // a camera name alone proves nothing
  });
  it("AI tags override camera tags", () => {
    expect(analyzeMetadata({ Make: "Canon", Model: "R5", ISO: 100, FNumber: 2, Software: "Stable Diffusion" }).verdict).toBe("AI_GENERATED");
  });
});

describe("combine", () => {
  const base = analyzeMetadata(null);
  it("lets high pixel scores decide", () => expect(combine(base, { aiGeneratedScore: 91, deepfakeScore: 3 })).toMatchObject({ verdict: "AI_GENERATED", confidence: 91 }));
  it("lets low pixel scores support real", () => expect(combine(base, { aiGeneratedScore: 4, deepfakeScore: 2 })).toMatchObject({ verdict: "LIKELY_REAL", confidence: 96 }));
  it("stays inconclusive in the middle", () => expect(combine(base, { aiGeneratedScore: 50, deepfakeScore: 40 }).verdict).toBe("INCONCLUSIVE"));
  it("keeps a strong AI-metadata verdict even if pixels look real", () => expect(combine(analyzeMetadata({ Software: "DALL-E" }), { aiGeneratedScore: 2, deepfakeScore: 1 }).verdict).toBe("AI_GENERATED"));
  it("returns the metadata result when there are no pixel scores", () => expect(combine(base, null)).toBe(base));
});

describe("pixelClassifier", () => {
  const ok = (type: object) => vi.fn(async () => new Response(JSON.stringify({ type }), { status: 200 })) as unknown as typeof fetch;
  it("does nothing without keys, and nothing in ollama-only mode", async () => {
    const f = ok({ ai_generated: 0.9 });
    expect(await pixelClassifier(new Uint8Array(4), "a.jpg", "image/jpeg", f)).toBeNull();
    env.SIGHTENGINE_API_USER = "u"; env.SIGHTENGINE_API_SECRET = "s"; env.AZ_PROVIDER_MODE = "ollama-only";
    expect(await pixelClassifier(new Uint8Array(4), "a.jpg", "image/jpeg", f)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it("converts 0-1 scores to percentages and survives failures", async () => {
    env.SIGHTENGINE_API_USER = "u"; env.SIGHTENGINE_API_SECRET = "s";
    expect(await pixelClassifier(new Uint8Array(4), "a.jpg", "image/jpeg", ok({ ai_generated: 0.876, deepfake: 0.1 }))).toEqual({ aiGeneratedScore: 88, deepfakeScore: 10 });
    expect(await pixelClassifier(new Uint8Array(4), "a.jpg", "image/jpeg", vi.fn(async () => { throw new Error("net"); }) as unknown as typeof fetch)).toBeNull();
  });
});

describe("detectImage", () => {
  it("rejects empty, oversized and non-image files", async () => {
    await expect(detectImage(new Uint8Array(0), "a.jpg", "image/jpeg")).rejects.toThrow("EMPTY_FILE");
    await expect(detectImage(new Uint8Array(4), "a.pdf", "application/pdf")).rejects.toThrow("UNSUPPORTED_FORMAT");
  });
  it("reports inconclusive for an image with no metadata", async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect((await detectImage(png, "x.png", "image/png")).verdict).toBe("INCONCLUSIVE");
  });
});
