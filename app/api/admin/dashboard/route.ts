// ============================================================
// 15_ADMIN / DASHBOARD OVERVIEW
// ============================================================
import { pool } from "@/lib/admin/db";
import { endpoint, json } from "@/lib/admin/errors";
import { authorize, rateLimit, requireActor } from "@/lib/admin/security";

export const runtime = "nodejs";

export function GET() {
  return endpoint(async () => {
    const actor = await requireActor();
    authorize(actor, "read");
    await rateLimit(actor, false);

    const [totals, modules, approvals, incidents, audit] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*)::int AS tenants,
           (SELECT COUNT(*)::int FROM admin_records WHERE tenant_id = $1 AND deleted_at IS NULL) AS records,
           (SELECT COUNT(*)::int FROM admin_records WHERE tenant_id = $1 AND module = 'approvals' AND deleted_at IS NULL) AS approvals,
           (SELECT COUNT(*)::int FROM admin_records WHERE tenant_id = $1 AND module = 'policies' AND deleted_at IS NULL) AS policies,
           (SELECT COUNT(*)::int FROM admin_records WHERE tenant_id = $1 AND module = 'incidents' AND deleted_at IS NULL) AS incidents
         FROM admin_tenants
         WHERE id = $1 AND deleted_at IS NULL`,
        [actor.tenantId]
      ),
      pool.query(
        `SELECT module, COUNT(*)::int AS count
         FROM admin_records
         WHERE tenant_id = $1 AND deleted_at IS NULL
         GROUP BY module
         ORDER BY count DESC, module ASC`,
        [actor.tenantId]
      ),
      pool.query(
        `SELECT r.id, r.payload, r.updated_at
         FROM admin_records r
         LEFT JOIN admin_decisions d ON d.record_id = r.id AND d.tenant_id = r.tenant_id
         WHERE r.tenant_id = $1 AND r.module = 'approvals' AND r.deleted_at IS NULL AND (d.status IS NULL OR d.status = 'pending')
         ORDER BY r.updated_at DESC
         LIMIT 5`,
        [actor.tenantId]
      ),
      pool.query(
        `SELECT id, payload, updated_at
         FROM admin_records
         WHERE tenant_id = $1 AND module = 'incidents' AND deleted_at IS NULL
         ORDER BY updated_at DESC
         LIMIT 5`,
        [actor.tenantId]
      ),
      pool.query(
        `SELECT id, actor_id, action, resource_id, created_at
         FROM admin_audit
         WHERE tenant_id = $1
         ORDER BY created_at DESC
         LIMIT 10`,
        [actor.tenantId]
      ),
    ]);

    return json({
      actor: {
        tenantId: actor.tenantId,
        role: actor.role,
      },
      summary: totals.rows[0] ?? {
        tenants: 0,
        records: 0,
        approvals: 0,
        policies: 0,
        incidents: 0,
      },
      moduleCounts: modules.rows,
      approvalsPending: approvals.rows,
      incidentsRecent: incidents.rows,
      recentAudit: audit.rows,
    });
  });
}
