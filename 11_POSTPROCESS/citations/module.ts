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
