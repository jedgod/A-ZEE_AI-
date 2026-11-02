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
  }): Promise<Array<{ sourceId: string; text: string }>>;
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
    trust: "untrusted" as const,
  }));
}

// Validate adapter results and retain source version metadata.
// Apply rate limits, deadlines, and source-level ACLs.
