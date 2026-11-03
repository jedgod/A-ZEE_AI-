// ============================================================
// 11_POSTPROCESS / CITATIONS
// File: lib/operations/citations.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type Auth, type ArtifactRepository, type RecordRepository,
  requireAuth, artifactSchema, expiresIn
} from "../../lib/operations/contracts";

export interface SourceRepository {
  resolve(auth: Auth, ids: readonly string[]): Promise<Array<{
    sourceId: string; url: string;
  }>>;
}

export async function runCitations(
  auth: Auth, raw: unknown, repository: SourceRepository
) {
  requireAuth(auth);
  const ids = z.array(z.string().min(1).max(200)).max(30).parse(raw);
  const unique = [...new Set(ids)];
  const sources = await repository.resolve(auth, unique);
  return unique.map(id => {
    const source = sources.find(item => item.sourceId === id);
    if (!source) throw new Error("Unresolved citation");
    const url = new URL(source.url);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("Unsafe citation URL");
    }
    return { sourceId: id, url: url.href };
  });
}

// Resolution does not prove the source supports the claim.
// Preserve source versions and perform evidence checks separately.

// ------------------------------------------------------------
// Answer citations (wired into lib/pipeline/index.ts).
// Matches the source IDs the answer cites against what 07 search actually retrieved, and
// exposes only canonical http(s) URLs without credentials.
// ------------------------------------------------------------
export function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol)) return null;
    if (url.username || url.password || !url.hostname) return null;
    return url.href;
  } catch { return null; }
}

export type CitableSource = { sourceId: string; title?: string; url?: string };
export type Citation = { id: string; title: string; url: string | null };

// [doc:abc], [web:1], [memory:2] or [1]; not Markdown links like [text](url) or indexing like a[1].
const REFERENCE = /(?<![\w\])])\[((?:doc|memory|web):[^\]\s]{1,120}|\d{1,3})\](?!\()/g;
const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;

export function citationsFor(answer: string, sources: readonly CitableSource[]) {
  const prose = answer.replace(CODE, " ");
  const ids = [...new Set([...prose.matchAll(REFERENCE)].map(m => m[1]))];
  const byId = new Map(sources.map(s => [s.sourceId, s]));
  const citations: Citation[] = [];
  const unsupportedIds: string[] = [];
  for (const id of ids) {
    // Numeric references point at the n-th retrieved source.
    const source = /^\d+$/.test(id) ? sources[Number(id) - 1] : byId.get(id);
    if (!source) { unsupportedIds.push(id); continue; }
    if (citations.some(c => c.id === source.sourceId)) continue;
    citations.push({ id: source.sourceId, title: (source.title || source.sourceId).slice(0, 200), url: safeUrl(source.url) });
  }
  return { citations, unsupportedIds };
}
