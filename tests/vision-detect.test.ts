import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { assessManifest, buildDetection, detectImage } from "@/lib/vision/detect";
import { fingerprint } from "@/lib/vision/fingerprint";
import { findMatches } from "@/lib/vision/matches";

const aiAction = {
  label: "c2pa.actions.v2",
  data: { actions: [{
    action: "c2pa.created",
    digitalSourceType: "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
  }] },
};

async function sample() {
  const source = Buffer.alloc(128 * 128 * 3);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const i = (y * 128 + x) * 3;
      source[i] = (x * 7 + y * 3) % 256;
      source[i + 1] = (x * 2 + y * 9) % 256;
      source[i + 2] = (x * 11 + y * 5) % 256;
    }
  }
  return sharp(source, { raw: { width: 128, height: 128, channels: 3 } }).png().toBuffer();
}

describe("image verification", () => {
  it("requires a trusted signer and a signed creation action", () => {
    expect(assessManifest("Trusted", [aiAction])).toBe("trusted_ai_creation");
    expect(assessManifest("Valid", [aiAction])).toBe("untrusted");
    expect(assessManifest("Invalid", [aiAction])).toBe("invalid");
    expect(assessManifest("Trusted", [{ ...aiAction, label: "custom" }])).toBe("trusted_other");
  });

  it("keeps matching copies and unsigned metadata separate from the verdict", () => {
    const result = buildDetection({ credential: "absent", publicIndex: { status: "checked", indexedImages: 1,
      matches: [{ url: "https://example.org/post", kind: "exact", observedAt: "2026-01-01" }] } }, true);
    expect(result).toMatchObject({ verdict: "INCONCLUSIVE", pixelScores: null, confidence: 0 });
  });

  it("rejects malformed bytes and identifies an unsigned real image as inconclusive", async () => {
    await expect(detectImage(new Uint8Array())).rejects.toThrow("EMPTY_FILE");
    await expect(detectImage(new Uint8Array(11 * 1024 * 1024))).rejects.toThrow("FILE_TOO_LARGE");
    await expect(detectImage(Buffer.from("c2pa trainedAlgorithmicMedia"))).rejects.toThrow("INVALID_IMAGE");
    const result = await detectImage(await sample());
    expect(result.verdict).toBe("INCONCLUSIVE");
    expect(result.verification.credential).toBe("absent");
  });

  it("finds exact and recompressed copies and excludes low-detail perceptual matches", async () => {
    const original = await sample();
    const query = await fingerprint(original);
    const resized = await fingerprint(await sharp(original).resize(96).jpeg({ quality: 45 }).toBuffer());
    const flat = await fingerprint(await sharp({ create: { width: 128, height: 128, channels: 3, background: "#f5f5f5" } }).png().toBuffer());
    expect(flat.dhash).toBeNull();
    const entries = [
      { ...resized, url: "https://example.org/repost", observedAt: "2026-02-01" },
      { ...query, url: "https://example.org/source", observedAt: "2026-01-01" },
      { ...flat, url: "https://example.org/unrelated", observedAt: "2026-01-01" },
    ];
    expect(findMatches(query, entries).map(m => m.kind)).toEqual(["exact", "possible"]);
  });
});
