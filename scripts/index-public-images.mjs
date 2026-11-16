import { open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fingerprint, MAX_IMAGE_BYTES } from "../lib/vision/fingerprint.ts";

const [manifestFile, outputFile] = process.argv.slice(2);
if (!manifestFile || !outputFile) throw new Error("Usage: node --experimental-strip-types scripts/index-public-images.mjs manifest.json index.json");
if (resolve(manifestFile) === resolve(outputFile)) throw new Error("Use a separate destination file for the index");
const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
if (!Array.isArray(manifest) || !manifest.length || manifest.length > 10_000) throw new Error("Provide 1–10,000 approved source entries");

const results = [];
for (const [i, entry] of manifest.entries()) {
  try {
    const { image, pageUrl, observedAt } = entry;
    if (typeof image !== "string" || typeof pageUrl !== "string" || pageUrl.length > 2048 ||
      typeof observedAt !== "string" || !Number.isFinite(Date.parse(observedAt)) ||
      Date.parse(observedAt) > Date.now()) throw new Error("Provide a local image path, HTTPS page URL and observed timestamp");
    const url = new URL(pageUrl);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid page URL");
    const file = await open(resolve(dirname(manifestFile), image), "r");
    let hash;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) throw new Error("Image exceeds the size limit or is not a regular file");
      const bytes = Buffer.alloc(stat.size + 1);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset !== stat.size) throw new Error("Source file changed during read");
      hash = await fingerprint(bytes.subarray(0, offset));
    } finally { await file.close(); }
    url.hash = "";
    results.push({ url: url.href, observedAt: new Date(observedAt).toISOString(), sha256: hash.sha256, dhash: hash.dhash });
  } catch (error) {
    throw new Error(`Manifest entry ${i + 1}: ${error.message}`, { cause: error });
  }
}
const body = JSON.stringify(results);
if (Buffer.byteLength(body) > 5_000_000) throw new Error("Index exceeds 5 MB");
const temporary = `${outputFile}.${randomUUID()}.tmp`;
try {
  await writeFile(temporary, body, { flag: "wx", mode: 0o600 });
  await rename(temporary, outputFile);
} finally { await rm(temporary, { force: true }); }
console.log(`Indexed ${results.length} approved source entries`);
