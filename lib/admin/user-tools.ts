// ============================================================
// 15_ADMIN / USER TOOLS: tags, notes, saved views, bulk actions, promotion
// Every query is tenant-scoped; every change is audited in admin_audit (one row per user).
// ============================================================
import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool, transaction } from "./db";
import { fail } from "./errors";
import { authorize, type Actor } from "./security";

export const MAX_BULK = 100;
export const MAX_BULK_PROMOTE = 20;
export const PROMOTE_PHRASE = "PROMOTE";

const uuid = z.string().uuid();
const audit = (db: PoolClient, actor: Actor, action: string, resourceId: string) =>
  db.query(`INSERT INTO admin_audit (id, tenant_id, actor_id, action, resource_id) VALUES ($1,$2,$3,$4,$5)`,
    [randomUUID(), actor.tenantId, actor.userId, action, resourceId]);

async function requireMember(db: PoolClient, actor: Actor, userId: string) {
  const r = await db.query(`SELECT role FROM admin_memberships WHERE tenant_id=$1 AND user_id=$2`, [actor.tenantId, userId]);
  if (!r.rowCount) fail(404, "USER_NOT_FOUND");
  return r.rows[0].role as string;
}

// ---- tags ----
export const tagInput = z.object({ userId: uuid, name: z.string().trim().min(1).max(40) });
export async function addTag(actor: Actor, raw: unknown) {
  authorize(actor, "users.write");
  const { userId, name } = tagInput.parse(raw);
  return transaction(async db => {
    await requireMember(db, actor, userId);
    const tag = await db.query(
      `INSERT INTO admin_tags (id, tenant_id, name) VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id, name, color`,
      [randomUUID(), actor.tenantId, name.toLowerCase()]);
    await db.query(`INSERT INTO admin_user_tags (tenant_id, user_id, tag_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [actor.tenantId, userId, tag.rows[0].id]);
    await audit(db, actor, "users.tag_add", userId);
    return tag.rows[0] as { id: string; name: string; color: string };
  });
}
export async function removeTag(actor: Actor, userIdRaw: unknown, tagIdRaw: unknown) {
  authorize(actor, "users.write");
  const userId = uuid.parse(userIdRaw), tagId = uuid.parse(tagIdRaw);
  await transaction(async db => {
    await db.query(`DELETE FROM admin_user_tags WHERE tenant_id=$1 AND user_id=$2 AND tag_id=$3`, [actor.tenantId, userId, tagId]);
    await audit(db, actor, "users.tag_remove", userId);
  });
}
export type UserTag = { id: string; name: string; color: string };
export async function tagsByUser(actor: Actor) {
  const r = await pool.query(
    `SELECT ut.user_id, t.id, t.name, t.color FROM admin_user_tags ut JOIN admin_tags t ON t.id = ut.tag_id
     WHERE ut.tenant_id = $1 ORDER BY t.name`, [actor.tenantId]);
  const map = new Map<string, UserTag[]>();
  for (const row of r.rows) {
    const list = map.get(row.user_id) ?? [];
    list.push({ id: row.id, name: row.name, color: row.color });
    map.set(row.user_id, list);
  }
  return map;
}

// ---- notes ----
export async function listNotes(actor: Actor, userIdRaw: unknown) {
  authorize(actor, "read");
  const r = await pool.query(
    `SELECT n.id, n.content, n.created_at, coalesce(i.display_name, i.email) AS author
     FROM admin_user_notes n LEFT JOIN admin_identities i ON i.id = n.author_id
     WHERE n.tenant_id=$1 AND n.user_id=$2 ORDER BY n.created_at DESC LIMIT 100`, [actor.tenantId, uuid.parse(userIdRaw)]);
  return r.rows.map(n => ({ id: n.id as string, content: n.content as string, author: n.author as string, createdAt: new Date(n.created_at).toISOString() }));
}
export const noteInput = z.object({ userId: uuid, content: z.string().trim().min(1).max(2000) });
export async function addNote(actor: Actor, raw: unknown) {
  authorize(actor, "users.write");
  const { userId, content } = noteInput.parse(raw);
  return transaction(async db => {
    await requireMember(db, actor, userId);
    const id = randomUUID();
    await db.query(`INSERT INTO admin_user_notes (id, tenant_id, user_id, author_id, content) VALUES ($1,$2,$3,$4,$5)`,
      [id, actor.tenantId, userId, actor.userId, content]);
    await audit(db, actor, "users.note_add", userId);
    return id;
  });
}
export async function deleteNote(actor: Actor, idRaw: unknown) {
  authorize(actor, "users.write");
  const id = uuid.parse(idRaw);
  await transaction(async db => {
    // Authors delete their own notes; owners can delete any.
    const r = await db.query(
      `DELETE FROM admin_user_notes WHERE id=$1 AND tenant_id=$2 AND ($3::boolean OR author_id=$4) RETURNING user_id`,
      [id, actor.tenantId, actor.role === "owner", actor.userId]);
    if (!r.rowCount) fail(404, "NOT_FOUND");
    await audit(db, actor, "users.note_delete", r.rows[0].user_id);
  });
}

// ---- saved views (private to the admin who made them) ----
export const viewInput = z.object({
  name: z.string().trim().min(1).max(40),
  filters: z.object({ view: z.string().max(20).optional(), q: z.string().max(100).optional() }).strict(),
});
export async function listViews(actor: Actor) {
  authorize(actor, "read");
  const r = await pool.query(`SELECT id, name, filters FROM admin_saved_views WHERE tenant_id=$1 AND owner_id=$2 ORDER BY created_at DESC LIMIT 50`,
    [actor.tenantId, actor.userId]);
  return r.rows as { id: string; name: string; filters: { view?: string; q?: string } }[];
}
export async function saveView(actor: Actor, raw: unknown) {
  authorize(actor, "read");
  const { name, filters } = viewInput.parse(raw);
  const count = await pool.query(`SELECT count(*)::int AS n FROM admin_saved_views WHERE tenant_id=$1 AND owner_id=$2`, [actor.tenantId, actor.userId]);
  if (count.rows[0].n >= 50) fail(422, "TOO_MANY_VIEWS");
  const id = randomUUID();
  await pool.query(`INSERT INTO admin_saved_views (id, tenant_id, owner_id, name, filters) VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [id, actor.tenantId, actor.userId, name, JSON.stringify(filters)]);
  return { id, name, filters };
}
export async function deleteView(actor: Actor, idRaw: unknown) {
  authorize(actor, "read");
  await pool.query(`DELETE FROM admin_saved_views WHERE id=$1 AND tenant_id=$2 AND owner_id=$3`, [uuid.parse(idRaw), actor.tenantId, actor.userId]);
}

// ---- bulk actions: suspend / unsuspend / export (promotion is separate and owner-only) ----
export const bulkInput = z.object({ ids: z.array(uuid).min(1).max(MAX_BULK), action: z.enum(["suspend", "unsuspend", "export"]) });
const csvCell = (v: unknown) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export async function bulkAction(actor: Actor, raw: unknown) {
  authorize(actor, "users.write");
  const { ids: all, action } = bulkInput.parse(raw);
  const ids = [...new Set(all)].filter(id => id !== actor.userId);
  if (!ids.length) fail(422, "NO_VALID_TARGETS");

  if (action === "export") {
    const r = await pool.query(
      `SELECT i.email, coalesce(i.display_name,i.email) AS name, m.role, m.status, m.created_at
       FROM admin_memberships m JOIN admin_identities i ON i.id = m.user_id
       WHERE m.tenant_id=$1 AND m.user_id = ANY($2::uuid[]) ORDER BY lower(i.email)`, [actor.tenantId, ids]);
    const head = "name,email,role,status,member_since";
    const body = r.rows.map(u => [u.name, u.email, u.role, u.status, new Date(u.created_at).toISOString()].map(csvCell).join(","));
    return { csv: [head, ...body].join("\n"), affected: r.rowCount ?? 0 };
  }

  return transaction(async db => {
    // Owners are never touched; only members of this tenant are matched.
    const status = action === "suspend" ? "suspended" : "active";
    const r = await db.query(
      `UPDATE admin_memberships SET status=$3, updated_at=now()
       WHERE tenant_id=$1 AND user_id = ANY($2::uuid[]) AND role <> 'owner' AND status <> $3 RETURNING user_id`,
      [actor.tenantId, ids, status]);
    const changed: string[] = r.rows.map(x => x.user_id);
    if (action === "suspend" && changed.length) {
      await db.query(`UPDATE admin_sessions SET revoked_at=now() WHERE tenant_id=$1 AND user_id = ANY($2::uuid[]) AND revoked_at IS NULL`, [actor.tenantId, changed]);
    }
    for (const id of changed) await audit(db, actor, `users.bulk_${action}`, id);
    return { affected: changed.length };
  });
}

// ---- promotion to admin: owner-only (roles.write), never self, never an owner ----
async function promoteOne(db: PoolClient, actor: Actor, userId: string) {
  const r = await db.query(
    `UPDATE admin_memberships SET role='admin', updated_at=now()
     WHERE tenant_id=$1 AND user_id=$2 AND role IN ('reviewer','operator','viewer') AND status='active' RETURNING user_id`,
    [actor.tenantId, userId]);
  if (r.rowCount) await audit(db, actor, "users.promote_to_admin", userId);
  return !!r.rowCount;
}
export const promoteInput = z.object({ userId: uuid, confirm: z.literal(true) });
export async function promoteUser(actor: Actor, raw: unknown) {
  authorize(actor, "roles.write");
  const { userId } = promoteInput.parse(raw);
  if (userId === actor.userId) fail(403, "SELF_MEMBERSHIP_CHANGE_DENIED");
  return transaction(async db => {
    const role = await requireMember(db, actor, userId);
    if (role === "owner" || role === "admin") fail(422, "ALREADY_ADMIN");
    if (!(await promoteOne(db, actor, userId))) fail(422, "NOT_ELIGIBLE");
    return { userId, role: "admin" };
  });
}
export const bulkPromoteInput = z.object({ ids: z.array(uuid).min(1).max(MAX_BULK_PROMOTE), confirmPhrase: z.literal(PROMOTE_PHRASE) });
export async function bulkPromote(actor: Actor, raw: unknown) {
  authorize(actor, "roles.write");
  const { ids } = bulkPromoteInput.parse(raw);
  const targets = [...new Set(ids)].filter(id => id !== actor.userId);
  if (!targets.length) fail(422, "NO_VALID_TARGETS");
  return transaction(async db => {
    let promoted = 0;
    for (const id of targets) if (await promoteOne(db, actor, id)) promoted++;
    if (!promoted) fail(422, "NOT_ELIGIBLE");
    return { promoted };
  });
}
