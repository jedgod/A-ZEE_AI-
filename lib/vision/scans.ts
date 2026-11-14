import "server-only";
import { pool } from "@/lib/admin/db";
import type { Detection, PixelScores, Verdict } from "./detect";

export type Scan = { scanId: string; verdict: Verdict; confidence: number; pixelScores: PixelScores | null; likelySource: string; signals: string[]; createdAt: string };

const COLUMNS = `id AS "scanId", verdict, confidence, pixel_scores AS "pixelScores", COALESCE(likely_source, 'Unknown') AS "likelySource", signals, created_at AS "createdAt"`;

export async function saveScan(ownerId: string, d: Detection): Promise<Scan> {
  const r = await pool.query(
    `INSERT INTO image_scans (owner_id, verdict, confidence, pixel_scores, likely_source, signals) VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
    [ownerId, d.verdict, d.confidence, d.pixelScores ? JSON.stringify(d.pixelScores) : null, d.likelySource.slice(0, 200), JSON.stringify(d.signals.slice(0, 20))],
  );
  return r.rows[0];
}

/** The account's own recent scans, newest first. */
export async function listScans(ownerId: string, limit = 20): Promise<Scan[]> {
  return (await pool.query(`SELECT ${COLUMNS} FROM image_scans WHERE owner_id = $1 ORDER BY created_at DESC LIMIT $2`, [ownerId, Math.min(Math.max(limit, 1), 50)])).rows;
}

/** Deletes one of the account's own scans. False when it does not exist or belongs to someone else. */
export async function deleteScan(ownerId: string, id: string): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return false;
  return (await pool.query(`DELETE FROM image_scans WHERE id = $1 AND owner_id = $2`, [id, ownerId])).rowCount === 1;
}

/** Deletes all of the account's scans and returns how many. */
export async function clearScans(ownerId: string): Promise<number> {
  return (await pool.query(`DELETE FROM image_scans WHERE owner_id = $1`, [ownerId])).rowCount ?? 0;
}
