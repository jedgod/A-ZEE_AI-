import "server-only";
import { pool } from "./db";
import { authorize, requireActor, type Actor } from "./security";
import type { Module, Resource } from "./contracts";
import { configuredProviders, health } from "@/lib/pipeline/registry";

// Read side of the /admin pages (server components). Every query is scoped to the signed-in
// tenant and checked with the same role grants the /api/admin routes enforce. Writes go through
// those API routes (same-origin, rate-limited, audited).

export async function consoleActor(): Promise<Actor> {
  const actor = await requireActor();
  authorize(actor, "read");
  return actor;
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

export async function records<K extends Module>(actor: Actor, module: K, limit = 50): Promise<(Resource<K> & { decision?: string | null })[]> {
  const result = await pool.query(
    `SELECT r.*, d.status AS decision
     FROM admin_records r
     LEFT JOIN admin_decisions d ON d.record_id = r.id AND d.tenant_id = r.tenant_id
     WHERE r.tenant_id = $1 AND r.module = $2 AND r.deleted_at IS NULL
     ORDER BY r.updated_at DESC, r.id DESC LIMIT $3`,
    [actor.tenantId, module, limit],
  );
  return result.rows.map(row => ({
    id: row.id, tenantId: row.tenant_id, module: row.module, payload: row.payload, revision: row.revision,
    createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)!, decision: row.decision ?? null,
  }));
}

/** Governance dashboard: real counts for this tenant plus pipeline activity (metadata only). */
export async function overview(actor: Actor) {
  const [admin, ops, members, subscriptions, audit] = await Promise.all([
    pool.query(
      `SELECT
         count(*) FILTER (WHERE r.module = 'approvals' AND (d.status IS NULL OR d.status = 'pending'))::int AS pending_approvals,
         count(*) FILTER (WHERE r.module = 'incidents' AND r.payload->>'status' IN ('open','investigating','blocked'))::int AS open_incidents,
         count(*) FILTER (WHERE r.module = 'policies' AND (r.payload->>'enabled')::boolean)::int AS enabled_policies,
         count(*) FILTER (WHERE r.module = 'registry' AND (r.payload->>'enabled')::boolean)::int AS enabled_registry
       FROM admin_records r
       LEFT JOIN admin_decisions d ON d.record_id = r.id AND d.tenant_id = r.tenant_id
       WHERE r.tenant_id = $1 AND r.deleted_at IS NULL`, [actor.tenantId]),
    pool.query(
      `SELECT
         count(*) FILTER (WHERE module = 'metrics' AND payload->>'name' = 'request_count')::int AS requests,
         count(*) FILTER (WHERE module = 'metrics' AND payload->>'name' = 'request_count' AND payload->>'outcome' = 'failure')::int AS failed,
         count(*) FILTER (WHERE module = 'error_logs' AND payload->>'category' = 'validation')::int AS blocked,
         count(*) FILTER (WHERE module = 'model_performance')::int AS model_calls
       FROM operations_records WHERE created_at > now() - interval '24 hours' AND expires_at > now()`),
    pool.query(`SELECT count(*)::int AS n FROM admin_memberships WHERE tenant_id = $1 AND status = 'active'`, [actor.tenantId]),
    pool.query(`SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending, count(*) FILTER (WHERE status IN ('active','trialing'))::int AS active FROM subscriptions`),
    pool.query(
      `SELECT a.action, a.created_at, coalesce(i.display_name, i.email, 'unknown') AS actor
       FROM admin_audit a LEFT JOIN admin_identities i ON i.id = a.actor_id
       WHERE a.tenant_id = $1 ORDER BY a.created_at DESC LIMIT 8`, [actor.tenantId]),
  ]);
  const incidents = (await records(actor, "incidents", 20)).filter(i => i.payload.status !== "resolved").slice(0, 5);
  const counts = admin.rows[0] as { pending_approvals: number; open_incidents: number; enabled_policies: number; enabled_registry: number };
  const activity = ops.rows[0] as { requests: number; failed: number; blocked: number; model_calls: number };
  return {
    ...counts, ...activity, members: members.rows[0].n as number,
    subscriptions: subscriptions.rows[0], incidents,
    audit: audit.rows.map(r => ({ action: r.action as string, actor: r.actor as string, at: iso(r.created_at)! })),
  };
}

/** Members of this tenant with their live session counts (Access registry). */
export async function members(actor: Actor) {
  const result = await pool.query(
    `SELECT m.user_id, m.role, m.status, i.email, i.display_name, m.updated_at,
            (SELECT count(*)::int FROM admin_sessions s
              WHERE s.user_id = m.user_id AND s.tenant_id = m.tenant_id AND s.revoked_at IS NULL AND s.expires_at > now()) AS sessions
     FROM admin_memberships m JOIN admin_identities i ON i.id = m.user_id
     WHERE m.tenant_id = $1
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'reviewer' THEN 2 WHEN 'operator' THEN 3 ELSE 4 END, lower(i.email)`,
    [actor.tenantId],
  );
  return result.rows.map(r => ({
    userId: r.user_id as string, name: (r.display_name || r.email) as string, email: r.email as string,
    role: r.role as string, status: r.status as string, sessions: r.sessions as number, updatedAt: iso(r.updated_at)!,
  }));
}

/** Tenants: platform admins see all; others see their own tenant only. */
export async function tenants(actor: Actor) {
  const result = await pool.query(
    `SELECT t.id, t.name, t.status, t.created_at, coalesce(o.display_name, o.email) AS owner,
            (SELECT count(*)::int FROM admin_memberships m WHERE m.tenant_id = t.id AND m.status = 'active') AS members
     FROM admin_tenants t LEFT JOIN admin_identities o ON o.id = t.owner_user_id
     WHERE t.deleted_at IS NULL AND ($1::boolean OR t.id = $2)
     ORDER BY t.name LIMIT 100`,
    [actor.platformAdmin, actor.tenantId],
  );
  return result.rows.map(r => ({ id: r.id as string, name: r.name as string, status: r.status as string, owner: (r.owner ?? "—") as string, members: r.members as number, createdAt: iso(r.created_at)! }));
}

/** Live model providers as the router sees them right now (05/04). */
export function liveProviders() {
  const disabled = new Set((process.env.AZ_DISABLED_PROVIDERS ?? "").split(",").map(s => s.trim()).filter(Boolean));
  return {
    configured: configuredProviders().map(p => ({ id: p.id, label: p.label, model: p.providerModel, coolingDown: health.coolingDown(p.id) })),
    disabled: [...disabled],
  };
}

/** Usage for the billing view: plan subscriptions and 24h provider calls (no prices invented). */
export async function usage() {
  const [plans, calls] = await Promise.all([
    pool.query(
      `SELECT p.name, count(s.*) FILTER (WHERE s.status IN ('active','trialing'))::int AS active,
              count(s.*) FILTER (WHERE s.status = 'pending')::int AS pending
       FROM plans p LEFT JOIN subscriptions s ON s.plan_id = p.id
       GROUP BY p.id, p.name, p.sort_order ORDER BY p.sort_order`),
    pool.query(
      `SELECT payload->>'modelId' AS provider, count(*)::int AS calls,
              sum((payload->>'inputTokens')::int)::int AS input_tokens, sum((payload->>'outputTokens')::int)::int AS output_tokens
       FROM operations_records WHERE module = 'model_performance' AND created_at > now() - interval '30 days' AND expires_at > now()
       GROUP BY 1 ORDER BY 2 DESC`),
  ]);
  return { plans: plans.rows as { name: string; active: number; pending: number }[], calls: calls.rows as { provider: string; calls: number; input_tokens: number | null; output_tokens: number | null }[] };
}
