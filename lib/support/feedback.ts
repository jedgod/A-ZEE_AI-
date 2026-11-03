import "server-only";
import { createHash } from "node:crypto";
import { runImprovementQueue, type ImprovementRepository } from "@/13_FEEDBACK/improvement_queue/module";
import type { AuditSink } from "@/14_OBSERVABILITY/audit_trail/module";
import { pool } from "@/lib/admin/db";
import { expiresIn, type Auth } from "@/lib/operations/contracts";
import { OpsError } from "./complaints";

// 13_FEEDBACK improvement queue and 14_OBSERVABILITY audit trail for the operations workspace.

export type AnswerFeedback = {
  requestId: string; rating: number | null; correction: string | null; mode: string | null; provider: string | null;
  at: string; queued: boolean;
};

/** Unhelpful answers (rating 1–2) and corrections from the last 30 days. Corrections are stored redacted. */
export async function listAnswerFeedback(opsTenantId: string): Promise<AnswerFeedback[]> {
  const result = await pool.query(
    `WITH feedback AS (
       SELECT request_id,
              max((payload->>'rating')::int) FILTER (WHERE module = 'user_rating') AS rating,
              max(payload->>'correction') FILTER (WHERE module = 'correction_capture') AS correction,
              max(created_at) AS at
       FROM operations_records
       WHERE module IN ('user_rating', 'correction_capture') AND expires_at > now() AND created_at > now() - interval '30 days'
       GROUP BY request_id)
     SELECT f.*, r.payload->>'mode' AS mode, r.payload->>'provider' AS provider,
            EXISTS (SELECT 1 FROM operations_records q WHERE q.module = 'improvement_queue' AND q.tenant_id = $1 AND q.request_id = f.request_id) AS queued
     FROM feedback f
     LEFT JOIN LATERAL (SELECT payload FROM operations_records WHERE module = 'request' AND request_id = f.request_id LIMIT 1) r ON true
     WHERE f.rating <= 2 OR f.correction IS NOT NULL
     ORDER BY f.at DESC LIMIT 100`,
    [opsTenantId],
  );
  return result.rows.map(r => ({
    requestId: r.request_id, rating: r.rating, correction: r.correction, mode: r.mode, provider: r.provider,
    at: new Date(r.at).toISOString(), queued: r.queued,
  }));
}

/** Queues an answer's feedback for review (deduplicated per team + answer). */
export async function queueForImprovement(admin: Auth & { name: string }, requestId: string) {
  const exists = await pool.query("SELECT 1 FROM operations_records WHERE request_id = $1 AND module IN ('user_rating', 'correction_capture') LIMIT 1", [requestId]);
  if (!exists.rowCount) throw new OpsError(404, "NOT_FOUND");
  const repository: ImprovementRepository = {
    async enqueueReviewedCandidate({ auth, feedbackId, status }) {
      const id = createHash("sha256").update(`${auth.tenantId}|${feedbackId}|improvement`).digest("hex").slice(0, 32);
      await pool.query(
        `INSERT INTO operations_records (id, tenant_id, user_id, request_id, module, payload, expires_at)
         VALUES ($1, $2, $3, $4, 'improvement_queue', $5::jsonb, $6) ON CONFLICT (id) DO NOTHING`,
        [id, auth.tenantId, auth.userId, feedbackId, JSON.stringify({ feedbackId, status }), expiresIn(180)],
      );
      return { id };
    },
  };
  const queued = await runImprovementQueue({ userId: admin.userId, tenantId: admin.tenantId }, { feedbackId: requestId }, repository);
  await pool.query(
    "INSERT INTO complaint_events (tenant_id, complaint_id, actor_id, actor_label, action, detail) VALUES ($1, NULL, $2, $3, 'feedback_queued', $4::jsonb)",
    [admin.tenantId, admin.userId, admin.name, JSON.stringify({ requestId })],
  );
  return queued;
}

/** 14 audit trail sink: append-only rows in complaint_events, shown in the Activity log. */
export function auditSink(label: string): AuditSink {
  return {
    async append({ actor, action, resourceId, outcome, occurredAt }) {
      const result = await pool.query(
        `INSERT INTO complaint_events (tenant_id, complaint_id, actor_id, actor_label, action, detail, created_at)
         VALUES ($1, NULL, $2, $3, $4, $5::jsonb, $6) RETURNING id`,
        [actor.tenantId, actor.userId, label, `audit:${action}`, JSON.stringify({ resourceId, outcome }), occurredAt],
      );
      return { id: String(result.rows[0].id) };
    },
  };
}
