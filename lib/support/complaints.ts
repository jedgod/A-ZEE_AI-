import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "@/lib/admin/db";
import { hashPassword, temporaryPassword } from "@/lib/staff/password";
import { authorize, canView, displayNumber, nextStatus, type Action, type Actor, type Status } from "./policy";

export class OpsError extends Error {
  constructor(public status: number, public code: string, public detail?: string) { super(code); }
}

export type ComplaintRow = {
  id: string; number: string; display: string; subject: string; customerName: string; customerContact: string | null;
  category: string; source: string; priority: "low" | "medium" | "high"; status: Status;
  assignedTo: string | null; assigneeName: string | null; resolution: string | null; reviewNote: string | null;
  version: number; createdAt: string; updatedAt: string;
};

const SELECT = `
  SELECT c.id, c.number, c.subject, c.customer_name, c.customer_contact, c.category, c.source, c.priority, c.status,
         c.assigned_to, coalesce(a.display_name, split_part(a.email, '@', 1)) AS assignee_name,
         c.resolution, c.review_note, c.version, c.created_at, c.updated_at
  FROM complaints c LEFT JOIN admin_identities a ON a.id = c.assigned_to`;

function toRow(r: Record<string, unknown>): ComplaintRow {
  return {
    id: r.id as string, number: String(r.number), display: displayNumber(r.number as string), subject: r.subject as string,
    customerName: r.customer_name as string, customerContact: (r.customer_contact as string) ?? null,
    category: r.category as string, source: r.source as string, priority: r.priority as ComplaintRow["priority"],
    status: r.status as Status, assignedTo: (r.assigned_to as string) ?? null, assigneeName: (r.assignee_name as string) ?? null,
    resolution: (r.resolution as string) ?? null, reviewNote: (r.review_note as string) ?? null, version: r.version as number,
    createdAt: new Date(r.created_at as string).toISOString(), updatedAt: new Date(r.updated_at as string).toISOString(),
  };
}

async function inTransaction<T>(work: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await work(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

async function record(db: PoolClient | typeof pool, tenantId: string, complaintId: string | null, actor: { id: string | null; label: string }, action: string, detail: Record<string, unknown> = {}) {
  await db.query(
    "INSERT INTO complaint_events (tenant_id, complaint_id, actor_id, actor_label, action, detail) VALUES ($1, $2, $3, $4, $5, $6::jsonb)",
    [tenantId, complaintId, actor.id, actor.label, action, JSON.stringify(detail)],
  );
}

// ---------------------------------------------------------------------------
// Creating complaints (from the app, from feedback, or by staff)

export type NewComplaint = {
  tenantId: string; source: "app" | "feedback" | "staff"; category: "bug" | "support" | "feedback" | "other";
  reporterRef: string | null; customerName: string; customerContact: string | null; subject: string; body: string;
  priority?: "low" | "medium" | "high"; requestId?: string | null; assignTo?: string | null;
  createdBy?: { id: string; label: string };
};

export async function createComplaint(input: NewComplaint): Promise<ComplaintRow> {
  return inTransaction(async db => {
    if (input.assignTo) await requireAssignable(db, input.tenantId, input.assignTo);
    const id = randomUUID();
    await db.query(
      `INSERT INTO complaints (id, tenant_id, source, category, reporter_ref, customer_name, customer_contact, subject, body, priority, request_id, assigned_to, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, input.tenantId, input.source, input.category, input.reporterRef, input.customerName, input.customerContact,
        input.subject, input.body, input.priority ?? "medium", input.requestId ?? null, input.assignTo ?? null,
        input.assignTo ? "in_progress" : "open"],
    );
    await record(db, input.tenantId, id, input.createdBy ?? { id: null, label: input.customerName }, "created",
      { source: input.source, category: input.category, ...(input.assignTo ? { assignedTo: input.assignTo } : {}) });
    return toRow((await db.query(`${SELECT} WHERE c.id = $1`, [id])).rows[0]);
  });
}

async function requireAssignable(db: PoolClient, tenantId: string, userId: string) {
  const member = await db.query(
    "SELECT role FROM admin_memberships WHERE tenant_id = $1 AND user_id = $2 AND status = 'active' AND role IN ('owner','admin','operator','reviewer')",
    [tenantId, userId],
  );
  if (!member.rowCount) throw new OpsError(422, "ASSIGNEE_NOT_ACTIVE_STAFF");
}

// ---------------------------------------------------------------------------
// Reading

export async function listComplaints(actor: Actor): Promise<ComplaintRow[]> {
  const scoped = actor.role === "staff";
  const result = await pool.query(
    `${SELECT} WHERE c.tenant_id = $1 ${scoped ? "AND c.assigned_to = $2" : ""} ORDER BY c.created_at DESC LIMIT 500`,
    scoped ? [actor.tenantId, actor.id] : [actor.tenantId],
  );
  return result.rows.map(toRow);
}

export async function getComplaint(actor: Actor, id: string) {
  const found = await pool.query(
    `SELECT c.*, coalesce(a.display_name, split_part(a.email, '@', 1)) AS assignee_name
     FROM complaints c LEFT JOIN admin_identities a ON a.id = c.assigned_to WHERE c.id = $1`,
    [id],
  );
  const r = found.rows[0];
  if (!r || !canView(actor, { tenantId: r.tenant_id, status: r.status, assignedTo: r.assigned_to })) throw new OpsError(404, "NOT_FOUND");
  const events = await pool.query(
    "SELECT actor_label, action, detail, created_at FROM complaint_events WHERE complaint_id = $1 ORDER BY created_at DESC LIMIT 50",
    [id],
  );
  return {
    ...toRow(r),
    body: r.body as string,
    events: events.rows.map(e => ({ actor: e.actor_label, action: e.action, detail: e.detail, at: new Date(e.created_at).toISOString() })),
  };
}

export async function dashboard(actor: Actor) {
  const scope = actor.role === "staff" ? "AND assigned_to = $2" : "";
  const params = actor.role === "staff" ? [actor.tenantId, actor.id] : [actor.tenantId];
  const [counts, team, activity] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE assigned_to IS NULL AND status <> 'resolved')::int AS unassigned,
              count(*) FILTER (WHERE status = 'pending_review')::int AS pending,
              count(*) FILTER (WHERE status = 'resolved')::int AS resolved
       FROM complaints WHERE tenant_id = $1 ${scope}`,
      params,
    ),
    listStaff(actor.tenantId),
    actor.role === "staff" ? Promise.resolve({ rows: [] as Record<string, unknown>[] }) : pool.query(
      "SELECT e.actor_label, e.action, e.detail, e.created_at, c.number FROM complaint_events e LEFT JOIN complaints c ON c.id = e.complaint_id WHERE e.tenant_id = $1 ORDER BY e.created_at DESC LIMIT 30",
      [actor.tenantId],
    ),
  ]);
  return {
    counts: counts.rows[0] as { total: number; unassigned: number; pending: number; resolved: number },
    team,
    activity: activity.rows.map(e => ({
      actor: e.actor_label as string, action: e.action as string, detail: e.detail as Record<string, unknown>,
      complaint: e.number ? displayNumber(e.number as string) : null, at: new Date(e.created_at as string).toISOString(),
    })),
  };
}

/** A user's own requests (by their browser identity), with the approved resolution once resolved. */
export async function listForReporter(reporterRef: string) {
  const result = await pool.query(
    `SELECT number, subject, category, status, CASE WHEN status = 'resolved' THEN resolution END AS resolution, created_at, updated_at
     FROM complaints WHERE reporter_ref = $1 ORDER BY created_at DESC LIMIT 20`,
    [reporterRef],
  );
  return result.rows.map(r => ({
    id: displayNumber(r.number), subject: r.subject as string, category: r.category as string, status: r.status as Status,
    resolution: (r.resolution as string) ?? null, updatedAt: new Date(r.updated_at).toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Workflow transitions

export type TransitionInput = {
  version: number; assigneeId?: string; resolution?: string; note?: string; priority?: "low" | "medium" | "high";
};

export async function transition(actor: Actor & { name: string }, id: string, action: Action, input: TransitionInput): Promise<ComplaintRow> {
  return inTransaction(async db => {
    const found = await db.query("SELECT tenant_id, status, assigned_to, version, customer_contact, number FROM complaints WHERE id = $1 FOR UPDATE", [id]);
    const c = found.rows[0];
    const state = c && { tenantId: c.tenant_id as string, status: c.status as Status, assignedTo: (c.assigned_to as string) ?? null };
    if (!state || !canView(actor, state)) throw new OpsError(404, "NOT_FOUND");
    if (c.version !== input.version) throw new OpsError(409, "VERSION_CONFLICT", "Someone else changed this complaint. Reload and try again.");
    if (!authorize(actor, state, action)) throw new OpsError(403, "ACTION_NOT_ALLOWED");

    const status = nextStatus(state, action) ?? state.status;
    const sets: string[] = ["status = $2", "version = version + 1", "updated_at = now()"];
    const values: unknown[] = [id, status];
    const set = (column: string, value: unknown) => { values.push(value); sets.push(`${column} = $${values.length}`); };
    const detail: Record<string, unknown> = { from: state.status, to: status };

    switch (action) {
      case "assign":
        if (!input.assigneeId) throw new OpsError(422, "ASSIGNEE_REQUIRED");
        await requireAssignable(db, state.tenantId, input.assigneeId);
        set("assigned_to", input.assigneeId);
        detail.assignedTo = input.assigneeId;
        break;
      case "submit": {
        const resolution = input.resolution?.trim();
        if (!resolution) throw new OpsError(422, "RESOLUTION_REQUIRED", "Add a resolution note before submitting for review.");
        if (resolution.length > 5000) throw new OpsError(422, "RESOLUTION_TOO_LONG");
        set("resolution", resolution);
        set("review_note", null);
        break;
      }
      case "approve":
        set("approved_by", actor.id);
        sets.push("resolved_at = now()");
        break;
      case "return": {
        const note = input.note?.trim();
        if (!note) throw new OpsError(422, "NOTE_REQUIRED", "Tell staff what to change.");
        set("review_note", note.slice(0, 2000));
        break;
      }
      case "reopen":
        sets.push("approved_by = NULL", "resolved_at = NULL");
        break;
      case "reprioritize":
        if (!input.priority) throw new OpsError(422, "PRIORITY_REQUIRED");
        set("priority", input.priority);
        detail.priority = input.priority;
        break;
    }

    await db.query(`UPDATE complaints SET ${sets.join(", ")} WHERE id = $1`, values);
    await record(db, state.tenantId, id, { id: actor.id, label: actor.name }, action, detail);
    // Approval queues the customer notification; a worker must deliver it (none is bundled).
    if (action === "approve" && c.customer_contact && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.customer_contact)) {
      await db.query(
        "INSERT INTO notification_outbox (id, tenant_id, complaint_id, event, recipient) VALUES ($1, $2, $3, 'resolved', $4) ON CONFLICT (complaint_id, event) DO NOTHING",
        [randomUUID(), state.tenantId, id, c.customer_contact],
      );
    }
    return toRow((await db.query(`${SELECT} WHERE c.id = $1`, [id])).rows[0]);
  });
}

// ---------------------------------------------------------------------------
// Staff management (admins only; enforced by the routes)

export type StaffMember = { id: string; email: string; name: string; role: string; status: string; active: number; mustChangePassword: boolean };

export async function listStaff(tenantId: string): Promise<StaffMember[]> {
  const result = await pool.query(
    `SELECT i.id, i.email, coalesce(i.display_name, split_part(i.email, '@', 1)) AS name, m.role, m.status,
            coalesce(c.must_change, false) AS must_change,
            (SELECT count(*)::int FROM complaints x WHERE x.tenant_id = m.tenant_id AND x.assigned_to = i.id AND x.status <> 'resolved') AS active
     FROM admin_memberships m JOIN admin_identities i ON i.id = m.user_id LEFT JOIN admin_credentials c ON c.user_id = i.id
     WHERE m.tenant_id = $1 ORDER BY m.status, name`,
    [tenantId],
  );
  return result.rows.map(r => ({ id: r.id, email: r.email, name: r.name, role: r.role, status: r.status, active: r.active, mustChangePassword: r.must_change }));
}

const STAFF_ROLES = ["admin", "operator", "reviewer", "viewer"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Creates (or adds to this tenant) a staff identity with a one-time temporary password. */
export async function createStaff(admin: Actor & { name: string }, input: { email: string; name: string; role: StaffRole }) {
  const email = input.email.trim().toLowerCase();
  const password = temporaryPassword();
  const hash = await hashPassword(password);
  return inTransaction(async db => {
    const existing = await db.query("SELECT id FROM admin_identities WHERE lower(email) = $1", [email]);
    const id: string = existing.rows[0]?.id ?? randomUUID();
    if (existing.rowCount) {
      const already = await db.query("SELECT 1 FROM admin_memberships WHERE tenant_id = $1 AND user_id = $2", [admin.tenantId, id]);
      if (already.rowCount) throw new OpsError(409, "ALREADY_A_MEMBER");
      await db.query("UPDATE admin_identities SET display_name = coalesce(display_name, $2) WHERE id = $1", [id, input.name]);
    } else {
      await db.query("INSERT INTO admin_identities (id, email, display_name, platform_admin) VALUES ($1, $2, $3, false)", [id, email, input.name]);
    }
    await db.query("INSERT INTO admin_memberships (tenant_id, user_id, role, status) VALUES ($1, $2, $3, 'active')", [admin.tenantId, id, input.role]);
    // Existing identities keep their password (if they have one); new ones get the temporary one.
    const inserted = await db.query(
      `INSERT INTO admin_credentials (user_id, password_hash, must_change) VALUES ($1, $2, true)
       ON CONFLICT (user_id) DO NOTHING`,
      [id, hash],
    );
    await record(db, admin.tenantId, null, { id: admin.id, label: admin.name }, "staff_added", { userId: id, role: input.role });
    return { id, temporaryPassword: inserted.rowCount ? password : null };
  });
}

export async function updateStaff(admin: Actor & { name: string }, userId: string, change: { role?: StaffRole; status?: "active" | "suspended"; resetPassword?: boolean }) {
  if (userId === admin.id && (change.role && change.role !== "admin" || change.status === "suspended")) {
    throw new OpsError(422, "CANNOT_CHANGE_OWN_ACCESS", "Ask another administrator to change your own role or status.");
  }
  return inTransaction(async db => {
    const member = await db.query("SELECT role FROM admin_memberships WHERE tenant_id = $1 AND user_id = $2 FOR UPDATE", [admin.tenantId, userId]);
    if (!member.rowCount) throw new OpsError(404, "NOT_FOUND");
    if (member.rows[0].role === "owner") throw new OpsError(422, "OWNER_PROTECTED");
    if (change.role) await db.query("UPDATE admin_memberships SET role = $3, updated_at = now() WHERE tenant_id = $1 AND user_id = $2", [admin.tenantId, userId, change.role]);
    if (change.status) {
      await db.query("UPDATE admin_memberships SET status = $3, updated_at = now() WHERE tenant_id = $1 AND user_id = $2", [admin.tenantId, userId, change.status]);
      // Suspension takes effect immediately: end the member's sessions in this tenant.
      if (change.status === "suspended") await db.query("UPDATE admin_sessions SET revoked_at = now() WHERE user_id = $1 AND tenant_id = $2 AND revoked_at IS NULL", [userId, admin.tenantId]);
    }
    let temporary: string | null = null;
    if (change.resetPassword) {
      temporary = temporaryPassword();
      await db.query(
        `INSERT INTO admin_credentials (user_id, password_hash, must_change) VALUES ($1, $2, true)
         ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, must_change = true, failed_attempts = 0, locked_until = NULL, updated_at = now()`,
        [userId, await hashPassword(temporary)],
      );
      await db.query("UPDATE admin_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
    }
    await record(db, admin.tenantId, null, { id: admin.id, label: admin.name }, "staff_updated", { userId, ...change, resetPassword: Boolean(change.resetPassword) });
    return { temporaryPassword: temporary };
  });
}

/** CSV export (admins). Formula-looking cells are neutralized for spreadsheet safety. */
export async function exportCsv(actor: Actor): Promise<string> {
  const rows = await listComplaints(actor);
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/^[=+\-@\t\r]/, "'$&")}"`;
  const header = ["id", "subject", "customer", "category", "source", "status", "priority", "assigned_to", "created_at", "updated_at"];
  return [header.join(","), ...rows.map(r => [r.display, r.subject, r.customerName, r.category, r.source, r.status, r.priority, r.assigneeName ?? "Unassigned", r.createdAt, r.updatedAt].map(cell).join(","))].join("\n") + "\n";
}
