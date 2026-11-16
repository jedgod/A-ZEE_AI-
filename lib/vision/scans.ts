import "server-only";
import { pool } from "@/lib/admin/db";
import type { CaptionResult } from "./caption";
import type { Detection, PixelScores, Verdict, Verification } from "./detect";

type CaptionCheck = { caption: string; result: CaptionResult; checkedAt: Date };

export type Scan = { scanId: string; verdict: Verdict; confidence: number; pixelScores: PixelScores | null; likelySource: string; signals: string[]; verification: Verification | null; createdAt: string };

const COLUMNS = `id AS "scanId", verdict, confidence, pixel_scores AS "pixelScores", COALESCE(likely_source, 'Unknown') AS "likelySource", signals, verification, created_at AS "createdAt"`;

export async function saveScan(ownerId: string, d: Detection): Promise<Scan> {
  const r = await pool.query(
    `INSERT INTO image_scans (owner_id, verdict, confidence, pixel_scores, likely_source, signals, verification) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUMNS}`,
    [ownerId, d.verdict, d.confidence, d.pixelScores ? JSON.stringify(d.pixelScores) : null, d.likelySource.slice(0, 200), JSON.stringify(d.signals.slice(0, 20)), JSON.stringify(d.verification)],
  );
  return r.rows[0];
}

/** The account's own recent scans, newest first. */
export async function listScans(ownerId: string, limit = 20): Promise<Scan[]> {
  return (await pool.query(`SELECT ${COLUMNS} FROM image_scans WHERE owner_id = $1 ORDER BY created_at DESC LIMIT $2`, [ownerId, Math.min(Math.max(limit, 1), 50)])).rows;
}

/** Deletes one of the account's own scans. False when it does not exist or belongs to someone else. */
export async function deleteScan(ownerId: string, id: string): Promise<boolean> {
  if (!SCAN_ID.test(id)) return false;
  return (await pool.query(`DELETE FROM image_scans WHERE id = $1 AND owner_id = $2`, [id, ownerId])).rowCount === 1;
}

/** Deletes all of the account's scans and returns how many. */
export async function clearScans(ownerId: string): Promise<number> {
  return (await pool.query(`DELETE FROM image_scans WHERE owner_id = $1`, [ownerId])).rowCount ?? 0;
}

const SCAN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getScan(ownerId: string, scanId: string): Promise<Scan | undefined> {
  if (!SCAN_ID.test(scanId)) return undefined;
  return (await pool.query<Scan>(`SELECT ${COLUMNS} FROM image_scans WHERE owner_id = $1 AND id = $2`, [ownerId, scanId])).rows[0];
}

export async function getCaption(ownerId: string, scanId: string) {
  if (!SCAN_ID.test(scanId)) return undefined;
  return (await pool.query<CaptionCheck | { caption: null; result: null; checkedAt: null }>(`
    SELECT c.caption, c.result, c.checked_at AS "checkedAt"
    FROM image_scans s LEFT JOIN image_caption_checks c ON c.scan_id = s.id
    WHERE s.owner_id = $1 AND s.id = $2`, [ownerId, scanId])).rows[0];
}

export async function saveCaption(ownerId: string, scanId: string, caption: string, result: CaptionResult) {
  const { rows } = await pool.query<CaptionCheck>(`
    INSERT INTO image_caption_checks (scan_id, caption, result)
    SELECT id, $3, $4 FROM image_scans WHERE owner_id = $1 AND id = $2 FOR KEY SHARE
    ON CONFLICT (scan_id) DO UPDATE SET caption = EXCLUDED.caption, result = EXCLUDED.result, checked_at = clock_timestamp()
    RETURNING caption, result, checked_at AS "checkedAt"`,
  [ownerId, scanId, caption, JSON.stringify(result)]);
  return rows[0];
}
