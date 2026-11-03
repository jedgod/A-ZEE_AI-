import "server-only";
import { z } from "zod";
import { pool } from "@/lib/admin/db";
import type { WebResult } from "./tavily";

// Storage for A-Zee Search: retrieved sources and answer records (owner-scoped).

export type StoredSource = WebResult & { id: string; provider: string; retrievedAt: string };

const row = (r: Record<string, unknown>): StoredSource => ({
  id: r.id as string, url: r.url as string, domain: r.domain as string, title: r.title as string, content: r.excerpt as string,
  publishedAt: r.published_at ? new Date(r.published_at as string).toISOString() : null,
  relevance: r.relevance === null || r.relevance === undefined ? null : Number(r.relevance),
  provider: r.provider as string, retrievedAt: new Date(r.retrieved_at as string).toISOString(),
});

/** Saves (or refreshes) retrieved pages; returns them in the same order with ids and retrieval time. */
export async function saveSources(ownerId: string, results: WebResult[], provider: string): Promise<StoredSource[]> {
  const saved: StoredSource[] = [];
  for (const r of results) {
    const { rows } = await pool.query(
      `INSERT INTO search_sources (owner_id, url, domain, title, excerpt, published_at, relevance, provider)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (owner_id, url) DO UPDATE SET title = EXCLUDED.title, excerpt = EXCLUDED.excerpt,
         published_at = coalesce(EXCLUDED.published_at, search_sources.published_at), relevance = EXCLUDED.relevance,
         provider = EXCLUDED.provider, retrieved_at = now()
       RETURNING *`,
      [ownerId, r.url, r.domain, r.title, r.content, r.publishedAt, r.relevance, provider]);
    saved.push(row(rows[0]));
  }
  return saved;
}

export async function getSource(ownerId: string, id: string): Promise<StoredSource | null> {
  if (!z.string().uuid().safeParse(id).success) return null;
  const { rows } = await pool.query(`SELECT * FROM search_sources WHERE id = $1 AND owner_id = $2`, [id, ownerId]);
  return rows[0] ? row(rows[0]) : null;
}

export async function recordAnswer(ownerId: string, record: {
  kind: "query" | "verify" | "compare"; query: string; answer: string; sourceIds: string[];
  claims: unknown; verification: unknown; model: string | null; provider: string; retrievedAt: string;
}): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO search_answers (owner_id, kind, query, answer, source_ids, claims, verification, model, provider, retrieved_at)
     VALUES ($1, $2, $3, $4, $5::uuid[], $6::jsonb, $7::jsonb, $8, $9, $10) RETURNING id`,
    [ownerId, record.kind, record.query.slice(0, 2000), record.answer.slice(0, 60000), record.sourceIds,
      JSON.stringify(record.claims), JSON.stringify(record.verification), record.model, record.provider, record.retrievedAt]);
  return rows[0].id;
}
