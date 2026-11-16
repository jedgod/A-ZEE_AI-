import { open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { commonsSources, commonsImageHosts } from "./image-sources/commons.mjs";
import { fetchPublic, publicUrl } from "./image-sources/fetch-public.mjs";
import { fingerprint, MAX_IMAGE_BYTES } from "../lib/vision/fingerprint.ts";

const [manifestFile, outputFile] = process.argv.slice(2);
if (!manifestFile || !outputFile) throw new Error("Usage: node --experimental-strip-types scripts/index-public-images.mjs manifest.json index.json");
if (resolve(manifestFile) === resolve(outputFile)) throw new Error("Use a separate destination file for the index");
const input = JSON.parse(await readFile(manifestFile, "utf8"));
const config = Array.isArray(input) ? { sources: input } : input;
if (!config || !Array.isArray(config.sources) || config.sources.length > 10_000 ||
    config.commons !== undefined && (!Array.isArray(config.commons) || config.commons.length > 5)) {
  throw new Error("Provide up to 10,000 source entries and at most five Commons categories");
}
const userAgent = process.env.AZ_IMAGE_INDEX_USER_AGENT ?? "AZeeImageIndex/1.0";
const hosts = new Set((process.env.AZ_IMAGE_INDEX_ALLOWED_HOSTS ?? "").split(",").map(host => host.trim().toLowerCase()).filter(Boolean));
const manifest = config.sources.map(entry => ({ ...entry, provider: entry?.imageUrl ? "Approved public source" : "Imported source" }));
for (const source of config.commons ?? []) {
  const discovered = await commonsSources({ category: source.category, limit: source.limit, userAgent, maxBytes: MAX_IMAGE_BYTES });
  if (!discovered.length) throw new Error("Commons category returned no eligible images");
  manifest.push(...discovered);
}
if (!manifest.length || manifest.length > 10_000) throw new Error("Provide 1–10,000 total source entries");
if (manifest.filter(entry => entry.imageUrl).length > 500) throw new Error("Index at most 500 remote images per run");

let previous = [];
try {
  const file = await open(outputFile, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 5_000_000) throw new Error("Invalid previous index");
    const bytes = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== stat.size) throw new Error("Previous index changed during read");
    previous = JSON.parse(bytes.subarray(0, offset).toString("utf8"));
    if (!Array.isArray(previous) || previous.length > 10_000) throw new Error("Invalid previous index");
  } finally { await file.close(); }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const observed = new Map(previous.map(entry => [JSON.stringify([entry.url, entry.sha256]), entry.observedAt]));

async function readLocal(image) {
  const file = await open(resolve(dirname(manifestFile), image), "r");
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
    return bytes.subarray(0, offset);
  } finally { await file.close(); }
}
const results = new Map();
for (const [i, entry] of manifest.entries()) {
  try {
    const { image, imageUrl, pageUrl, provider } = entry;
    const remote = typeof imageUrl === "string";
    const local = typeof image === "string" && image.length > 0;
    if (remote === local) throw new Error("Provide exactly one image path or download URL");
    if ((local || entry.observedAt !== undefined) && (typeof entry.observedAt !== "string" ||
        !Number.isFinite(Date.parse(entry.observedAt)) || Date.parse(entry.observedAt) > Date.now())) {
      throw new Error("Provide a valid historical observation timestamp");
    }
    const url = publicUrl(pageUrl).href;
    if (local && resolve(dirname(manifestFile), image) === resolve(outputFile)) throw new Error("The index cannot be the source image");
    if (remote) await new Promise(resolve => setTimeout(resolve, 250));
    const bytes = remote ? await fetchPublic(imageUrl, {
      hosts: provider === "Wikimedia Commons" ? commonsImageHosts : hosts,
      maxBytes: MAX_IMAGE_BYTES, userAgent, accept: "image/jpeg,image/png,image/webp",
    }) : await readLocal(image);
    const { sha256, dhash, ratio } = await fingerprint(bytes);
    const key = JSON.stringify([url, sha256]);
    const oldTime = Date.parse(observed.get(key) ?? "");
    const declaredTime = entry.observedAt ? Date.parse(entry.observedAt) : Date.now();
    const current = results.get(key)?.observedAt;
    const time = Math.min(Number.isFinite(oldTime) ? oldTime : Infinity, declaredTime, current ? Date.parse(current) : Infinity);
    results.set(key, { url, observedAt: new Date(time).toISOString(), sha256, dhash, ratio, provider });
  } catch (error) {
    throw new Error(`Manifest entry ${i + 1}: ${error.message}`, { cause: error });
  }
}
const body = JSON.stringify([...results.values()]);
if (Buffer.byteLength(body) > 5_000_000) throw new Error("Index exceeds 5 MB");
const temporary = `${outputFile}.${randomUUID()}.tmp`;
try {
  await writeFile(temporary, body, { flag: "wx", mode: 0o600 });
  await rename(temporary, outputFile);
} finally { await rm(temporary, { force: true }); }
console.log(`Indexed ${results.size} approved source entries`);
