import "server-only";
import { open, stat } from "node:fs/promises";
import { LocalIndex } from "./local-index";
import { distance, isLocalFeatures, MAX_INDEX_BYTES, type fingerprint } from "./fingerprint";

export type Match = { url: string; observedAt: string; kind: "exact" | "possible"; provider?: string; caption?: string; publisher?: string; previewId?: string; method?: "region" };
export type IndexEntry = { url: string; observedAt: string; sha256: string; dhash: string | null; provider?: string; ratio?: number; caption?: string; publisher?: string; comparisonAllowed?: boolean; featuresV1?: string };
type Fingerprint = Awaited<ReturnType<typeof fingerprint>>;

function isEntry(value: unknown): value is IndexEntry {
  if (!value || typeof value !== "object") return false;
  const { url, observedAt, sha256, dhash, provider, ratio, caption, publisher, comparisonAllowed, featuresV1 } = value as Partial<IndexEntry>;
  if (typeof url !== "string" || url.length > 2048 || typeof observedAt !== "string" ||
    !Number.isFinite(Date.parse(observedAt)) ||
    featuresV1 !== undefined && !isLocalFeatures(featuresV1) ||
    caption !== undefined && (typeof caption !== "string" || caption.length > 1000) ||
    publisher !== undefined && (typeof publisher !== "string" || publisher.length > 160) ||
    comparisonAllowed !== undefined && typeof comparisonAllowed !== "boolean" ||
    provider !== undefined && (typeof provider !== "string" || provider.length > 80) ||
    ratio !== undefined && (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio <= 0) || typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256) ||
    !(dhash === null || (typeof dhash === "string" && /^[a-f0-9]{16}$/.test(dhash)))) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch { return false; }
}

export function findMatches(query: Fingerprint, entries: IndexEntry[], local?: LocalIndex): Match[] {
  const regions = local && query.featuresV1 ? local.find(query.featuresV1) : undefined;
  const ranked = entries.flatMap<Match & { score: number }>(({ url, observedAt, sha256, dhash, provider, ratio, caption, publisher, comparisonAllowed }, id) => {
    const source = { url, observedAt, provider, caption, publisher, previewId: comparisonAllowed ? sha256 : undefined };
    if (query.sha256 === sha256) return [{ ...source, kind: "exact" as const, score: -1 }];
    const compatible = !ratio || Math.abs(Math.log(query.ratio / ratio)) <= 0.08;
    const score = compatible && query.dhash && dhash ? distance(query.dhash, dhash) : 65;
    const points = regions?.get(id);
    if (points) return [{ ...source, kind: "possible" as const, method: "region" as const, score: 1 / points }];
    return score <= 8 ? [{ ...source, kind: "possible" as const, score }] : [];
  });
  ranked.sort((a, b) => a.score - b.score || Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const unique = new Map<string, Match>();
  for (const { score: _score, ...match } of ranked) {
    if (!unique.has(match.url)) unique.set(match.url, match);
    if (unique.size === 8) break;
  }
  return [...unique.values()];
}

let index: { key: string; entries: Promise<{ entries: IndexEntry[]; local?: LocalIndex }> } | undefined;

async function loadIndex(path: string) {
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    const { size } = stat;
    if (!stat.isFile() || size > MAX_INDEX_BYTES) throw new Error("Invalid image index file");
    const bytes = Buffer.alloc(size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== size) throw new Error("Image index changed during read");
    const entries: unknown = JSON.parse(bytes.subarray(0, size).toString("utf8"));
    if (!Array.isArray(entries) || entries.length > 10_000 || !entries.every(isEntry)) throw new Error("Invalid image index entries");
    return { entries, local: process.env.AZ_IMAGE_CROP_MATCH === "1" && entries.some(entry => entry.featuresV1) ? new LocalIndex(entries) : undefined };
  } finally { await file.close(); }
}

async function currentEntries(path: string) {
  const info = await stat(path);
  const key = JSON.stringify([path, info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs, process.env.AZ_IMAGE_CROP_MATCH === "1"]);
  if (index?.key !== key) {
    const pending = loadIndex(path).catch(error => {
      if (index?.key === key) index = undefined;
      throw error;
    });
    index = { key, entries: pending };
  }
  return index.entries;
}

export async function comparisonIsAllowed(source: string, matches: Match[]): Promise<boolean> {
  const path = process.env.AZ_IMAGE_INDEX_FILE;
  if (!path) return false;
  const pages = new Set(matches.filter(match => match.previewId === source).map(match => match.url));
  if (!pages.size) return false;
  try {
    return (await currentEntries(path)).entries.some(entry =>
      entry.comparisonAllowed === true && entry.sha256 === source && pages.has(entry.url));
  } catch { return false; }
}

export async function lookupMatches(query: Fingerprint) {
  const path = process.env.AZ_IMAGE_INDEX_FILE;
  if (!path) return { status: "not_configured" as const, matches: [] };
  try {
    const { entries, local } = await currentEntries(path);
    return { status: "checked" as const, matches: findMatches(query, entries, local), indexedImages: entries.length };
  } catch { return { status: "unavailable" as const, matches: [] }; }
}
