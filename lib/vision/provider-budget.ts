import "server-only";
import { pool, transaction } from "@/lib/admin/db";
import type { ImageConsent } from "./provider-types";

/** Across all app workers: 20 attempts/account/24h, 200 globally/24h, 1 active/account and 6 active globally.
 * Failed attempts count too. Deleted scans cannot reset limits. Stale leases expire after 90s.
 */
export async function reserveProviders(owner: string, consent: ImageConsent): Promise<string | null> {
  return transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(18203047)");
    const result = await client.query<{ recent: number; active: number; global_active: number; global_recent: number }>(`
      SELECT
        (SELECT COALESCE(sum(attempts),0)::int FROM image_provider_usage WHERE bucket >= date_trunc('hour',now()) - interval '24 hours') AS global_recent,
        count(*) FILTER (WHERE owner_id = $1 AND created_at > now() - interval '24 hours')::int AS recent,
        count(*) FILTER (WHERE owner_id = $1 AND status = 'running' AND created_at > now() - interval '90 seconds')::int AS active,
        count(*) FILTER (WHERE status = 'running' AND created_at > now() - interval '90 seconds')::int AS global_active
      FROM image_provider_requests WHERE created_at > now() - interval '24 hours'`, [owner]);
    const usage = result.rows[0];
    if (usage.global_recent >= 200 || usage.recent >= 20 || usage.active >= 1 || usage.global_active >= 6) return null;
    // Anonymous counters cannot be reset by deleting an account. Hour buckets conservatively cover 24-25h.
    await client.query(`INSERT INTO image_provider_usage(bucket,attempts) VALUES(date_trunc('hour',now()),1)
      ON CONFLICT(bucket) DO UPDATE SET attempts=image_provider_usage.attempts+1`);
    const row = await client.query<{ id: string }>("INSERT INTO image_provider_requests(owner_id, consent) VALUES($1,$2::jsonb) RETURNING id", [owner, JSON.stringify(consent)]);
    return row.rows[0].id;
  });
}

export async function finishProviders(id: string, scanId?: string) {
  await pool.query("UPDATE image_provider_requests SET status=$2, scan_id=$3, finished_at=now() WHERE id=$1 AND status='running'", [id, scanId ? "completed" : "failed", scanId ?? null]);
}
