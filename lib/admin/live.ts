// ============================================================
// 15_ADMIN / LIVE VIEWS: per-stage pipeline activity and the unified activity feed
// Read-only, metadata only (no prompts or answers). Admin audit is tenant-scoped; pipeline
// metadata follows the same rule as the dashboard (operations_records is server-wide).
// ============================================================
import "server-only";
import { pool } from "./db";
import { CATALOG, STAGE_NAMES } from "./pipeline-catalog";
import { authorize, type Actor } from "./security";

export type StageLive = {
  stage: string; name: string;
  modules: { slug: string; title: string; status: string; hasRecords: boolean }[];
  runs: number | null; errors: number; lastAt: string | null; hourly: number[];
  health: "healthy" | "degraded" | "idle" | "unwired";
};

const ERROR_SQL = `(payload->>'status'='error' OR payload->>'outcome'='failure' OR module='error_logs')`;

/** Last 24 h of metadata per pipeline stage, from the record modules the catalog maps to each stage. */
export async function loadStageLive(actor: Actor): Promise<{ generatedAt: string; stages: StageLive[] }> {
  authorize(actor, "read");
  const stageIds = [...new Set(CATALOG.map(m => m.stage))];
  const moduleOf = (m: (typeof CATALOG)[number]) => (m.view.kind === "records" ? m.view.module : null);
  const rows = process.env.DATABASE_URL ? await Promise.all([
    pool.query(`SELECT module, count(*)::int AS n, max(created_at) AS last, count(*) FILTER (WHERE ${ERROR_SQL})::int AS errors
                FROM operations_records WHERE created_at > now() - interval '24 hours' AND expires_at > now() GROUP BY module`),
    pool.query(`SELECT module, date_trunc('hour', created_at) AS t, count(*)::int AS n
                FROM operations_records WHERE created_at > now() - interval '24 hours' AND expires_at > now() GROUP BY 1, 2`),
  ]).catch(() => null) : null;
  const totals = new Map<string, { n: number; last: Date | null; errors: number }>();
  rows?.[0].rows.forEach(r => totals.set(r.module, { n: r.n, last: r.last ? new Date(r.last) : null, errors: r.errors }));
  const hourStep = 3_600_000, end = Math.floor(Date.now() / hourStep) * hourStep;

  const stages = stageIds.map<StageLive>(stage => {
    const mods = CATALOG.filter(m => m.stage === stage);
    const recordModules = [...new Set(mods.map(moduleOf).filter((m): m is string => !!m))];
    let runs = 0, errors = 0, last: Date | null = null;
    for (const name of recordModules) {
      const t = totals.get(name);
      if (!t) continue;
      runs += t.n; errors += t.errors;
      if (t.last && (!last || t.last > last)) last = t.last;
    }
    const hourly = Array.from({ length: 24 }, (_, i) => {
      const slot = end - (23 - i) * hourStep;
      return (rows?.[1].rows ?? []).filter(r => recordModules.includes(r.module) && Math.floor(new Date(r.t).getTime() / hourStep) * hourStep === slot)
        .reduce((a, r) => a + r.n, 0);
    });
    const anyConnected = mods.some(m => m.status !== "not_connected");
    const wired = recordModules.length > 0;
    const health: StageLive["health"] = !anyConnected ? "unwired" : !wired || runs === 0 ? "idle" : errors / runs > 0.1 ? "degraded" : "healthy";
    return {
      stage, name: STAGE_NAMES[stage] ?? stage,
      modules: mods.map(m => ({ slug: m.slug, title: m.title, status: m.status, hasRecords: !!moduleOf(m) })),
      runs: wired ? runs : null, errors, lastAt: last ? last.toISOString() : null, hourly, health,
    };
  });
  return { generatedAt: new Date().toISOString(), stages };
}

// ---- activity feed ----
export type ActivityKind = "admin" | "pipeline" | "feedback";
export type ActivityItem = { id: string; kind: ActivityKind; tone: "neutral" | "good" | "bad"; title: string; detail?: string; actor?: string; at: string; href?: string };

const ACTIONS: Record<string, string> = {
  "users.promote_to_admin": "Promoted a user to admin", "users.bulk_suspend": "Suspended a user", "users.bulk_unsuspend": "Unsuspended a user",
  "users.tag_add": "Tagged a user", "users.tag_remove": "Removed a tag from a user", "users.note_add": "Added a note on a user", "users.note_delete": "Deleted a note on a user",
};
const NOUN: Record<string, string> = { users: "user", tenants: "tenant", roles: "role", approvals: "approval", policies: "policy", registry: "registry item", billing: "billing item", incidents: "incident" };
const VERB: Record<string, string> = { create: "Created", update: "Updated", delete: "Removed", approve: "Approved", reject: "Rejected" };
const LINK: Record<string, string> = { users: "/admin/users", tenants: "/admin/tenants", roles: "/admin/roles", approvals: "/admin/approvals", policies: "/admin/policies", registry: "/admin/registry", billing: "/admin/billing", incidents: "/admin/incidents" };

export function describeAction(action: string): { title: string; href?: string } {
  if (ACTIONS[action]) return { title: ACTIONS[action], href: "/admin/users" };
  const [module, verb] = action.split(".");
  if (NOUN[module] && VERB[verb]) return { title: `${VERB[verb]} a ${NOUN[module]}`, href: LINK[module] };
  return { title: action.replace(/[._]/g, " ") };
}

const KINDS: ActivityKind[] = ["admin", "pipeline", "feedback"];
export const parseKinds = (raw: string | null) => {
  const list = (raw ?? "").split(",").filter((k): k is ActivityKind => (KINDS as string[]).includes(k));
  return list.length ? list : KINDS;
};

/** Newest first, merged from admin audit, pipeline errors/failures and user feedback. `before` pages backwards. */
export async function loadActivity(actor: Actor, opts: { kinds: ActivityKind[]; limit: number; before?: string | null }): Promise<{ items: ActivityItem[]; hasMore: boolean }> {
  authorize(actor, "read");
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit)));
  const before = opts.before && !Number.isNaN(Date.parse(opts.before)) ? new Date(opts.before) : new Date(Date.now() + 60_000);
  const want = (k: ActivityKind) => opts.kinds.includes(k);
  const none = { rows: [] as any[] };
  const [audit, pipeline, feedback] = await Promise.all([
    want("admin") ? pool.query(
      `SELECT a.id, a.action, a.created_at, coalesce(i.display_name, i.email, 'unknown') AS actor
       FROM admin_audit a LEFT JOIN admin_identities i ON i.id = a.actor_id
       WHERE a.tenant_id=$1 AND a.created_at < $2 ORDER BY a.created_at DESC LIMIT $3`, [actor.tenantId, before, limit + 1]) : none,
    want("pipeline") && process.env.DATABASE_URL ? pool.query(
      `SELECT id, module, payload, created_at FROM operations_records
       WHERE created_at < $1 AND expires_at > now()
         AND ((module='error_logs') OR (module='metrics' AND payload->>'name'='request_count' AND payload->>'outcome'='failure'))
       ORDER BY created_at DESC LIMIT $2`, [before, limit + 1]).catch(() => none) : none,
    want("feedback") && process.env.DATABASE_URL ? pool.query(
      `SELECT id, module, payload, created_at FROM operations_records
       WHERE created_at < $1 AND expires_at > now() AND module IN ('user_rating','correction_capture')
       ORDER BY created_at DESC LIMIT $2`, [before, limit + 1]).catch(() => none) : none,
  ]);
  const iso = (d: unknown) => new Date(d as string).toISOString();
  const items: ActivityItem[] = [
    ...audit.rows.map<ActivityItem>(r => ({ id: `a:${r.id}`, kind: "admin", tone: "neutral", ...describeAction(r.action), actor: r.actor, at: iso(r.created_at) })),
    ...pipeline.rows.map<ActivityItem>(r => r.module === "error_logs"
      ? { id: `p:${r.id}`, kind: "pipeline", tone: "bad", title: `Pipeline error: ${String(r.payload?.category ?? "unknown")}`, at: iso(r.created_at), href: "/insights" }
      : { id: `p:${r.id}`, kind: "pipeline", tone: "bad", title: "A request failed", at: iso(r.created_at), href: "/insights" }),
    ...feedback.rows.map<ActivityItem>(r => {
      const rating = Number(r.payload?.rating);
      return r.module === "correction_capture"
        ? { id: `f:${r.id}`, kind: "feedback", tone: "neutral", title: "A user submitted a correction", at: iso(r.created_at), href: "/insights" }
        : { id: `f:${r.id}`, kind: "feedback", tone: rating >= 4 ? "good" : rating <= 2 ? "bad" : "neutral", title: rating >= 4 ? "Answer rated helpful" : rating <= 2 ? "Answer rated not helpful" : "Answer rated neutral", at: iso(r.created_at), href: "/insights" };
    }),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return { items: items.slice(0, limit), hasMore: items.length > limit };
}
