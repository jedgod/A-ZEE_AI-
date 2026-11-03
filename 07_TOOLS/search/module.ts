// ============================================================
// 07_TOOLS / SEARCH
// File: lib/07_tools/search.ts
// SERVER-ONLY INTEGRATION TEMPLATE
// ============================================================

import "server-only";
import { z } from "zod";
import {
  AuthContext, requirePermission
} from "../../lib/execution/contracts";

const schema = z.object({
  query: z.string().trim().min(1).max(2000),
}).strict();

export interface SearchAdapter {
  search(input: {
    tenantId: string; userId: string; query: string; limit: number;
  }): Promise<Array<{ sourceId: string; text: string; title?: string; url?: string }>>;
}

export async function runSearch(
  auth: AuthContext, raw: unknown, adapter: SearchAdapter
) {
  requirePermission(auth, "tools:search");
  const input = schema.parse(raw);
  const results = await adapter.search({
    tenantId: auth.tenantId, userId: auth.userId,
    query: input.query, limit: 5,
  });
  return results.slice(0, 5).map(item => ({
    sourceId: item.sourceId,
    text: item.text.slice(0, 10000),
    // Title and URL are passed through for 11 citations, which validates the URL before showing it.
    ...(typeof item.title === "string" ? { title: item.title.slice(0, 200) } : {}),
    ...(typeof item.url === "string" ? { url: item.url.slice(0, 2048) } : {}),
    trust: "untrusted" as const,
  }));
}

// Validate adapter results and retain source version metadata.
// Apply rate limits, deadlines, and source-level ACLs.
