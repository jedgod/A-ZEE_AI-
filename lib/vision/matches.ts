import "server-only";
import { open, stat } from "node:fs/promises";
import { distance, type fingerprint } from "./fingerprint";

export type Match = { url: string; observedAt: string; kind: "exact" | "possible"; provider?: string };
export type IndexEntry = { url: string; observedAt: string; sha256: string; dhash: string | null; provider?: string; ratio?: number };
type Fingerprint = Awaited<ReturnType<typeof fingerprint>>;

function isEntry(value: unknown): value is IndexEntry {
  if (!value || typeof value !== "object") return false;
  const { url, observedAt, sha256, dhash, provider, ratio } = value as Partial<IndexEntry>;
  if (typeof url !== "string" || url.length > 2048 || typeof observedAt !== "string" ||
    !Number.isFinite(Date.parse(observedAt)) ||
    provider !== undefined && (typeof provider !== "string" || provider.length > 80) ||
    ratio !== undefined && (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio <= 0) || typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256) ||
    !(dhash === null || (typeof dhash === "string" && /^[a-f0-9]{16}$/.test(dhash)))) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch { return false; }
}

export function findMatches(query: Fingerprint, entries: IndexEntry[]): Match[] {
  const ranked = entries.flatMap<Match & { score: number }>(({ url, observedAt, sha256, dhash, provider, ratio }) => {
    if (query.sha256 === sha256) return [{ url, observedAt, provider, kind: "exact" as const, score: -1 }];
    if (ratio && Math.abs(Math.log(query.ratio / ratio)) > 0.08) return [];
    const score = query.dhash && dhash ? distance(query.dhash, dhash) : 65;
    return score <= 8 ? [{ url, observedAt, provider, kind: "possible" as const, score }] : [];
  });
  ranked.sort((a, b) => a.score - b.score || Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const unique = new Map<string, Match>();
  for (const { url, observedAt, kind, provider } of ranked) {
    if (!unique.has(url)) unique.set(url, { url, observedAt, kind, ...(provider ? { provider } : {}) });
    if (unique.size === 8) break;
  }
  return [...unique.values()];
}

let index: { key: string; entries: Promise<IndexEntry[]> } | undefined;

async function loadIndex(path: string): Promise<IndexEntry[]> {
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    const { size } = stat;
    if (!stat.isFile() || size > 5_000_000) throw new Error("Invalid image index file");
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
    return entries;
  } finally { await file.close(); }
}

export async function lookupMatches(query: Fingerprint) {
  const path = process.env.AZ_IMAGE_INDEX_FILE;
  if (!path) return { status: "not_configured" as const, matches: [] };
  try {
    const info = await stat(path);
    const key = JSON.stringify([path, info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs]);
    if (index?.key !== key) {
      const pending = loadIndex(path).catch(error => {
        if (index?.key === key) index = undefined;
        throw error;
      });
      index = { key, entries: pending };
    }
    const entries = await index.entries;
    return { status: "checked" as const, matches: findMatches(query, entries), indexedImages: entries.length };
  } catch { return { status: "unavailable" as const, matches: [] }; }
}
