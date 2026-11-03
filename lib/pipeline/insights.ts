import "server-only";
import { ratingBuckets, STRUCTURE_RUBRIC } from "@/10_VALIDATION/quality_score/module";
import { pool } from "@/lib/admin/db";
import { currentStaff } from "@/lib/staff/auth";

// Read side of 13_FEEDBACK / 14_OBSERVABILITY: aggregates over operations_records.

export type Insights = {
  windowHours: number;
  requests: { success: number; failure: number; p50Ms: number | null; p95Ms: number | null };
  providers: { id: string; attempts: number; successes: number; avgMs: number | null; p95Ms: number | null }[];
  stages: { operation: string; count: number; avgMs: number; errors: number }[];
  feedback: { up: number; down: number; other: number; corrections: number };
  errors: { category: string; count: number }[];
  tasks: { type: string; count: number }[];
  attachments: number;
  // 10 structural score vs 13 ratings for the same answers (descriptive; the rubric is uncalibrated).
  quality: { rubric: string; scored: number; buckets: ReturnType<typeof ratingBuckets> };
  styles: { style: string; count: number }[];
};

/** Reporting periods offered by /insights and /api/insights (days). */
export const INSIGHT_DAYS = [1, 7, 30] as const;
export type InsightDays = (typeof INSIGHT_DAYS)[number];
export const parseDays = (value: unknown): InsightDays | null =>
  (INSIGHT_DAYS as readonly number[]).includes(Number(value)) ? Number(value) as InsightDays : null;

/**
 * Who may see pipeline insights: this machine's local user (same rule as chat), or a signed-in
 * staff admin who has finished the first-sign-in password change.
 */
export async function canViewInsights(local: boolean): Promise<boolean> {
  if (local) return true;
  const staff = await currentStaff().catch(() => null);
  return !!staff && staff.role === "admin" && !staff.mustChangePassword;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v)));

export async function loadInsights(windowHours = 24): Promise<Insights | null> {
  if (!process.env.DATABASE_URL) return null;
  const since = `now() - make_interval(hours => ${Math.max(1, Math.min(24 * 30, Math.floor(windowHours)))})`;
  const recent = `created_at > ${since} AND expires_at > now()`;
  const [requests, durations, providers, stages, feedback, corrections, errors, tasks, attachments, scored, rated, styles] = await Promise.all([
    pool.query(`SELECT payload->>'outcome' AS outcome, count(*)::int AS n FROM operations_records
                WHERE module='metrics' AND payload->>'name'='request_count' AND ${recent} GROUP BY 1`),
    pool.query(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (payload->>'value')::float) AS p50,
                       percentile_cont(0.95) WITHIN GROUP (ORDER BY (payload->>'value')::float) AS p95
                FROM operations_records WHERE module='metrics' AND payload->>'name'='request_duration_ms' AND ${recent}`),
    pool.query(`SELECT payload->>'modelId' AS id, count(*)::int AS attempts,
                       count(*) FILTER (WHERE payload->>'outcome'='success')::int AS successes,
                       avg((payload->>'durationMs')::float) FILTER (WHERE payload->>'outcome'='success') AS avg,
                       percentile_cont(0.95) WITHIN GROUP (ORDER BY (payload->>'durationMs')::float)
                         FILTER (WHERE payload->>'outcome'='success') AS p95
                FROM operations_records WHERE module='model_performance' AND ${recent} GROUP BY 1 ORDER BY 2 DESC`),
    pool.query(`SELECT payload->>'operation' AS operation, count(*)::int AS n, avg((payload->>'durationMs')::float) AS avg,
                       count(*) FILTER (WHERE payload->>'status'='error')::int AS errors
                FROM operations_records WHERE module='traces' AND ${recent} GROUP BY 1`),
    pool.query(`SELECT (payload->>'rating')::int AS rating, count(*)::int AS n FROM operations_records
                WHERE module='user_rating' AND ${recent} GROUP BY 1`),
    pool.query(`SELECT count(*)::int AS n FROM operations_records WHERE module='correction_capture' AND ${recent}`),
    pool.query(`SELECT payload->>'category' AS category, count(*)::int AS n FROM operations_records
                WHERE module='error_logs' AND ${recent} GROUP BY 1 ORDER BY 2 DESC`),
    pool.query(`SELECT payload->'task_type'->>'type' AS type, count(*)::int AS n FROM operations_records
                WHERE module='intake' AND ${recent} GROUP BY 1 ORDER BY 2 DESC`),
    pool.query(`SELECT count(*)::int AS n FROM operations_records
                WHERE module='intake' AND payload->'modality'->>'kind'='document' AND ${recent}`),
    pool.query(`SELECT count(*)::int AS n FROM operations_records
                WHERE module='request' AND payload->>'rubric'=$1 AND ${recent}`, [STRUCTURE_RUBRIC]),
    // Ratings 4–5 count as helpful, 1–2 as not helpful; neutral 3s are left out.
    pool.query(`SELECT (q.payload->>'quality')::int AS score, (r.payload->>'rating')::int >= 4 AS helpful
                FROM operations_records q
                JOIN operations_records r ON r.module='user_rating' AND r.request_id=q.request_id
                  AND r.tenant_id=q.tenant_id AND r.expires_at > now()
                WHERE q.module='request' AND q.payload->>'rubric'=$1 AND q.created_at > ${since} AND q.expires_at > now()
                  AND (r.payload->>'rating')::int <> 3`, [STRUCTURE_RUBRIC]),
    pool.query(`SELECT payload->>'style' AS style, count(*)::int AS n FROM operations_records
                WHERE module='request' AND payload ? 'style' AND ${recent} GROUP BY 1 ORDER BY 2 DESC`),
  ]);
  const count = (outcome: string) => requests.rows.find(r => r.outcome === outcome)?.n ?? 0;
  const ratings = feedback.rows as { rating: number; n: number }[];
  const order = ["retrieve", "generate", "validate", "deliver"];
  return {
    windowHours,
    requests: { success: count("success"), failure: count("failure"), p50Ms: num(durations.rows[0]?.p50), p95Ms: num(durations.rows[0]?.p95) },
    providers: providers.rows.map(r => ({ id: r.id, attempts: r.attempts, successes: r.successes, avgMs: num(r.avg), p95Ms: num(r.p95) })),
    stages: stages.rows
      .map(r => ({ operation: r.operation, count: r.n, avgMs: num(r.avg) ?? 0, errors: r.errors }))
      .sort((a, b) => order.indexOf(a.operation) - order.indexOf(b.operation)),
    feedback: {
      up: ratings.filter(r => r.rating >= 4).reduce((n, r) => n + r.n, 0),
      down: ratings.filter(r => r.rating <= 2).reduce((n, r) => n + r.n, 0),
      other: ratings.filter(r => r.rating === 3).reduce((n, r) => n + r.n, 0),
      corrections: corrections.rows[0]?.n ?? 0,
    },
    errors: errors.rows.map(r => ({ category: r.category, count: r.n })),
    tasks: tasks.rows.map(r => ({ type: r.type, count: r.n })),
    attachments: attachments.rows[0]?.n ?? 0,
    quality: {
      rubric: STRUCTURE_RUBRIC, scored: scored.rows[0]?.n ?? 0,
      buckets: ratingBuckets((rated.rows as { score: number; helpful: boolean }[]).filter(r => Number.isFinite(r.score))),
    },
    styles: styles.rows.map(r => ({ style: r.style, count: r.n })),
  };
}
