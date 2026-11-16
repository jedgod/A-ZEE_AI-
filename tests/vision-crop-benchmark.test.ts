import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { fingerprint } from "@/lib/vision/fingerprint";
import { LocalIndex } from "@/lib/vision/local-index";
import { findMatches, lookupMatches, type IndexEntry } from "@/lib/vision/matches";

const manifestPath = process.env.AZ_IMAGE_BENCHMARK_MANIFEST;

type Source = { id: string; path: string };
type Query = { path: string; cohort: string; source: string | null };
type Corpus = { sources: Source[]; queries: Query[]; generateProfiles?: boolean };

async function createVariants(original: Buffer) {
  const landscape = await sharp(original).resize(640, 480, { fit: "cover" }).png().toBuffer();
  const crop = (left: number, top: number, width: number, height: number) =>
    sharp(landscape).extract({ left, top, width, height });
  const recompress = (quality: number) => sharp(landscape).resize(370).jpeg({ quality }).toBuffer();
  const screenshot = async (image: Buffer, width: number, height: number, left: number, top: number) =>
    sharp({ create: { width, height, channels: 3, background: "#1c222c" } })
      .composite([{ input: image, left, top }]).png().toBuffer();
  const marker = Buffer.from('<svg width="640" height="480"><rect x="386" y="383" width="220" height="54" fill="#012" opacity=".65"/><text x="405" y="419" fill="white" font-size="27">PHOTO CREDIT</text></svg>');
  const watermarked = await sharp(landscape).composite([{ input: marker }]).jpeg({ quality: 65 }).toBuffer();
  return {
    "WhatsApp-like JPEG": await recompress(43),
    "Facebook-like resized crop": await crop(73, 30, 490, 398).resize(435).jpeg({ quality: 59 }).toBuffer(),
    "TikTok-like portrait frame": await screenshot(await crop(112, 18, 398, 445).resize(340).jpeg({ quality: 47 }).toBuffer(), 360, 625, 10, 98),
    "Signal-like JPEG": await recompress(73),
    "Telegram-like JPEG": await recompress(62),
    "Social-media WebP crop": await crop(108, 87, 420, 322).resize(385).webp({ quality: 62 }).toBuffer(),
    "Screenshot with UI margins": await screenshot(await sharp(landscape).resize(490).png().toBuffer(), 600, 525, 54, 70),
    "Watermark overlay": watermarked,
    "Off-center crop": await crop(115, 62, 395, 307).jpeg({ quality: 64 }).toBuffer(),
    "Screenshot of a crop": await screenshot(await crop(93, 52, 440, 340).resize(410).png().toBuffer(), 485, 480, 30, 79),
  };
}

describe("crop-aware source matching", () => {
  it("checks geometric consistency and keeps region matches out of the exact tier", async () => {
    const original = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#334" } })
      .composite([{ input: Buffer.from('<svg width="640" height="480">' +
        Array.from({ length: 110 }, (_, i) => `<rect x="${i * 97 % 613}" y="${i * 173 % 452}" width="${12 + i * 11 % 45}" height="${10 + i * 7 % 73}" fill="hsl(${i * 47 % 360},75%,${33 + i % 44}%)"/>`).join("") + '</svg>') }]).png().toBuffer();
    const fp = await fingerprint(original, true);
    const entries: IndexEntry[] = [{ ...fp, url: "https://example.org/source", observedAt: "2024-10-02" }];
    const index = new LocalIndex(entries);
    const query = await fingerprint((await createVariants(original))["Facebook-like resized crop"], true);
    expect(findMatches(query, entries)).toEqual([]);
    expect(findMatches(query, entries, index)).toMatchObject([{ kind: "possible", method: "region" }]);
    expect(findMatches(fp, entries, index)).toMatchObject([{ kind: "exact" }]);
    const dir = await mkdtemp(join(tmpdir(), "azee-crop-test-"));
    try {
      const path = join(dir, "index.json");
      await writeFile(path, JSON.stringify(entries));
      vi.stubEnv("AZ_IMAGE_INDEX_FILE", path);
      vi.stubEnv("AZ_IMAGE_CROP_MATCH", "0");
      expect((await lookupMatches(query)).matches).toEqual([]);
      vi.stubEnv("AZ_IMAGE_CROP_MATCH", "1");
      expect((await lookupMatches(query)).matches).toMatchObject([{ method: "region" }]);
      await writeFile(path, JSON.stringify([{ ...entries[0], featuresV1: "malformed" }]));
      expect((await lookupMatches(query)).status).toBe("unavailable");
    } finally {
      vi.unstubAllEnvs();
      await rm(dir, { recursive: true, force: true });
    }
    const moved = Buffer.from(fp.featuresV1!, "base64");
    for (let offset = 0; offset < moved.length; offset += 11) {
      moved[offset] = (offset * 53 + offset * offset * 3) % 251;
      moved[offset + 1] = (offset * 23 + offset * offset * 5) % 251;
    }
    expect(new LocalIndex([{ featuresV1: moved.toString("base64") }]).find(fp.featuresV1!).size).toBe(0);
  }, 60_000); // builds and matches synthetic images with the real image library; slower machines need more than the 5 s default

  it.skipIf(!manifestPath)("benchmarks labeled positive and negative samples", { timeout: 120_000 }, async () => {
    const manifest = resolve(manifestPath!);
    const corpus: Corpus = JSON.parse(await readFile(manifest, "utf8"));
    const { sources, queries, generateProfiles } = corpus;
    const localPath = (path: string) => resolve(dirname(manifest), path);
    const entries: IndexEntry[] = [];
    const profiles: { bytes: Buffer; cohort: string; expected: string }[] = [];
    const ids = new Map<string, string>();
    for (const [i, source] of sources.entries()) {
      if (ids.has(source.id)) throw new Error(`Duplicate source: ${source.id}`);
      const url = `https://benchmark.invalid/image/${i}`;
      ids.set(source.id, url);
      const bytes = await readFile(localPath(source.path));
      const canonical = generateProfiles ? await sharp(bytes).resize(640, 480, { fit: "cover" }).png().toBuffer() : bytes;
      entries.push({ ...await fingerprint(canonical, true), url, observedAt: "2024-01-01" });
      if (generateProfiles) for (const [cohort, bytes] of Object.entries(await createVariants(canonical))) profiles.push({ cohort, bytes, expected: url });
    }
    const local = new LocalIndex(entries);
    const rows = new Map<string, { positive: number; negative: number; baselineHit: number; cropHit: number; baselineFalse: number; cropFalse: number }>();
    const evaluate = async (bytes: Buffer, cohort: string, expected: string | null) => {
      const row = rows.get(cohort) ?? { positive: 0, negative: 0, baselineHit: 0, cropHit: 0, baselineFalse: 0, cropFalse: 0 };
      const fp = await fingerprint(bytes, true);
      const base = findMatches(fp, entries);
      const crop = findMatches(fp, entries, local);
      if (expected) {
        row.positive++;
        row.baselineHit += Number(base.some(m => m.url === expected));
        row.cropHit += Number(crop.some(m => m.url === expected));
      } else row.negative++;
      row.baselineFalse += Number(base.some(m => m.url !== expected));
      row.cropFalse += Number(crop.some(m => m.url !== expected));
      rows.set(cohort, row);
    };
    for (const profile of profiles) await evaluate(profile.bytes, profile.cohort, profile.expected);
    for (const query of queries) {
      const expected = query.source === null ? null : ids.get(query.source);
      if (expected === undefined) throw new Error(`Unknown source: ${query.source}`);
      await evaluate(await readFile(localPath(query.path)), query.cohort, expected);
    }
    const report = { indexSize: entries.length, cohorts: Object.fromEntries(rows) };
    expect(rows.size).toBeGreaterThan(0);
    if (process.env.AZ_IMAGE_BENCHMARK_OUTPUT) await writeFile(process.env.AZ_IMAGE_BENCHMARK_OUTPUT, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
  });
});
