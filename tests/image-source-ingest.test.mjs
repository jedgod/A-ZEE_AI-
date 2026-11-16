import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { fetchPublic, publicUrl } from "../scripts/image-sources/fetch-public.mjs";
import { commonsSources } from "../scripts/image-sources/commons.mjs";

test("remote imports require public HTTPS hostnames and explicit allowlisting", async () => {
  for (const url of ["http://example.org/a", "https://127.0.0.1/a", "https://[::1]/a",
    "https://user:secret@example.org/a", "https://example.org:444/a", "https://localhost/a"]) {
    assert.throws(() => publicUrl(url));
  }
  await assert.rejects(fetchPublic("https://example.org/image.png", { hosts: new Set() }), /allowlist/);
});

test("Commons follows continuation and returns only eligible Commons images", async () => {
  const urls = [];
  const listing = (name, mime, host = "upload.wikimedia.org") => ({
    imageinfo: [{ url: `https://${host}/${name}`, descriptionurl: `https://commons.wikimedia.org/wiki/File:${name}`,
      mime, size: 42, width: 10, height: 10 }],
  });
  const result = await commonsSources({
    category: "Category:Example", limit: 2, userAgent: "A-Zee Test (dev@example.org)", maxBytes: 1000,
    fetchBytes: async url => {
      urls.push(new URL(url));
      return Buffer.from(JSON.stringify(urls.length === 1 ?
        { query: { pages: [listing("a.jpg", "image/jpeg"), listing("b.svg", "image/svg+xml")] },
          continue: { continue: "||", gcmcontinue: "next" } } :
        { query: { pages: [listing("c.png", "image/png", "other.example.org"), listing("d.png", "image/png")] } }));
    },
  });
  assert.equal(urls[1].searchParams.get("gcmcontinue"), "next");
  assert.deepEqual(result.map(x => x.imageUrl), ["https://upload.wikimedia.org/a.jpg", "https://upload.wikimedia.org/d.png"]);
});

test("CLI preserves the earliest observation and leaves the current index intact on failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "azee-ingest-"));
  try {
    await sharp({ create: { width: 20, height: 20, channels: 3, background: "#27c" } }).png().toFile(join(dir, "image.png"));
    const input = join(dir, "sources.json");
    const output = join(dir, "index.json");
    const run = () => promisify(execFile)(process.execPath,
      ["--experimental-strip-types", "scripts/index-public-images.mjs", input, output]);
    const entry = { image: "image.png", pageUrl: "https://example.org/post", observedAt: "2024-01-01" };
    await writeFile(input, JSON.stringify([entry]));
    await run();
    const original = await readFile(output, "utf8");
    await writeFile(input, JSON.stringify([{ ...entry, observedAt: "2025-01-01" }]));
    await run();
    assert.equal(await readFile(output, "utf8"), original);
    await writeFile(input, JSON.stringify([{ ...entry, image: "missing.png" }]));
    await assert.rejects(run());
    assert.equal(await readFile(output, "utf8"), original);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("CLI stores evidence metadata and creates previews only with explicit permission", async () => {
  const dir = await mkdtemp(join(tmpdir(), "azee-ingest-preview-"));
  try {
    await sharp({ create: { width: 800, height: 720, channels: 3, background: "#27c" } }).png().toFile(join(dir, "image.png"));
    const input = join(dir, "sources.json");
    const output = join(dir, "index.json");
    const previews = join(dir, "previews");
    const run = () => promisify(execFile)(process.execPath,
      ["--experimental-strip-types", "scripts/index-public-images.mjs", input, output],
      { env: { ...process.env, AZ_IMAGE_PREVIEW_DIR: previews } });
    const entry = { image: "image.png", pageUrl: "https://example.org/post", observedAt: "2024-01-01", caption: "Flooding in Bowie", publisher: "Example archive" };
    await writeFile(input, JSON.stringify([entry]));
    await run();
    const [indexed] = JSON.parse(await readFile(output, "utf8"));
    const path = join(previews, `${indexed.sha256}.jpg`);
    await assert.rejects(readFile(path), { code: "ENOENT" });
    assert.equal(indexed.caption, entry.caption);
    assert.equal(indexed.publisher, entry.publisher);
    await writeFile(input, JSON.stringify([{ ...entry, comparisonAllowed: true }]));
    await run();
    const info = await sharp(await readFile(path)).metadata();
    assert.equal(info.format, "jpeg");
    assert.equal(info.width, 640);
    assert.equal(info.exif, undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("crop-enabled ingestion writes a bounded region signature alongside the legacy hash", async () => {
  const dir = await mkdtemp(join(tmpdir(), "azee-ingest-region-"));
  try {
    const rects = Array.from({ length: 120 }, (_, i) =>
      `<rect x="${i * 97 % 460}" y="${i * 47 % 310}" width="24" height="22" fill="hsl(${i * 49 % 360},85%,47%)"/>`).join("");
    await sharp(Buffer.from(`<svg width="480" height="320"><rect width="480" height="320" fill="white"/>${rects}</svg>`)).png().toFile(join(dir, "image.png"));
    const input = join(dir, "sources.json"), output = join(dir, "index.json");
    await writeFile(input, JSON.stringify([{ image: "image.png", pageUrl: "https://example.org/crop", observedAt: "2024-01-01" }]));
    await promisify(execFile)(process.execPath, ["--experimental-strip-types", "scripts/index-public-images.mjs", input, output],
      { env: { ...process.env, AZ_IMAGE_CROP_MATCH: "1" } });
    const [entry] = JSON.parse(await readFile(output, "utf8"));
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
    assert.ok(Buffer.from(entry.featuresV1, "base64").length <= 96 * 11);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
