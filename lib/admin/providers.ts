import "server-only";
import { configuredProviders, health } from "@/lib/pipeline/registry";
import { pool } from "./db";
import { authorize, type Actor } from "./security";

// Admin-only view of the AI providers: what is configured, whether one is cooling down after a
// failure, and how each performed over the last day or week. Never exposed to chat users.

export type ProviderRow = {
  id: string; label: string; model: string; cooling: boolean;
  attempts: number; successes: number; avgMs: number | null; p95Ms: number | null; lastAt: string | null;
};

const round = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v)));

export async function loadProviders(actor: Actor, days: 1 | 7): Promise<{ generatedAt: string; days: number; providers: ProviderRow[] }> {
  authorize(actor, "users.write"); // owners and admins
  const stats = new Map<string, { n: number; ok: number; avg: unknown; p95: unknown; last: unknown }>();
  if (process.env.DATABASE_URL) {
    const r = await pool.query(
      `SELECT payload->>'modelId' AS id, count(*)::int AS n,
              count(*) FILTER (WHERE payload->>'outcome'='success')::int AS ok,
              avg((payload->>'durationMs')::float) FILTER (WHERE payload->>'outcome'='success') AS avg,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY (payload->>'durationMs')::float) FILTER (WHERE payload->>'outcome'='success') AS p95,
              max(created_at) AS last
       FROM operations_records WHERE module='model_performance' AND created_at > now() - make_interval(days => $1) AND expires_at > now() GROUP BY 1`, [days]).catch(() => ({ rows: [] as any[] }));
    for (const row of r.rows) stats.set(row.id, { n: row.n, ok: row.ok, avg: row.avg, p95: row.p95, last: row.last });
  }
  const providers = configuredProviders().map<ProviderRow>(p => {
    const s = stats.get(p.id);
    return {
      id: p.id, label: p.label, model: p.providerModel, cooling: health.coolingDown(p.id),
      attempts: s?.n ?? 0, successes: s?.ok ?? 0, avgMs: round(s?.avg), p95Ms: round(s?.p95), lastAt: s?.last ? new Date(s.last as string).toISOString() : null,
    };
  });
  return { generatedAt: new Date().toISOString(), days, providers };
}
