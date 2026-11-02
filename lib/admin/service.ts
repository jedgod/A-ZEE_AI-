// ============================================================
// 15_ADMIN / CRUD SERVICE & APPROVAL REVIEW
// ============================================================
import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool, transaction } from "./db";
import { authorize, type Actor } from "./security";
import { fail } from "./errors";
import { parsePayload, type Module, type PayloadMap, type Resource } from "./contracts";

function dto<K extends Module>(row: any): Resource<K> {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    module: row.module,
    payload: row.payload,
    revision: row.revision,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function audit(db: PoolClient, actor: Actor, action: string, id: string) {
  await db.query(
    `INSERT INTO admin_audit (id, tenant_id, actor_id, action, resource_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), actor.tenantId, actor.userId, action, id]
  );
}

async function membership(db: PoolClient, actor: Actor, userId: string) {
  const result = await db.query(
    `SELECT 1 FROM admin_memberships
     WHERE tenant_id = $1 AND user_id = $2 AND status = 'active'`,
    [actor.tenantId, userId]
  );
  if (!result.rowCount) fail(422, "INVALID_MEMBER_REFERENCE");
}

async function validateReferences<K extends Module>(
  db: PoolClient,
  actor: Actor,
  module: K,
  payload: PayloadMap[K]
) {
  if (module === "incidents") {
    await membership(db, actor, (payload as PayloadMap["incidents"]).ownerUserId);
  }

  if (module === "approvals") {
    const target = await db.query(
      `SELECT revision, module
       FROM admin_records
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [actor.tenantId, (payload as PayloadMap["approvals"]).resourceId]
    );

    if (!target.rowCount || !["policies", "registry", "billing"].includes(target.rows[0].module)) {
      fail(422, "INVALID_APPROVAL_TARGET");
    }

    if (target.rows[0].revision !== (payload as PayloadMap["approvals"]).resourceRevision) {
      fail(409, "STALE_RESOURCE");
    }
  }

  if (module === "roles" && actor.role !== "owner") {
    fail(403, "OWNER_REQUIRED");
  }
}

export class AdminService<K extends Module> {
  constructor(private readonly module: K) {}

  async list(actor: Actor, limit: number, offset: number) {
    authorize(actor, "read");
    const result = await pool.query(
      `SELECT * FROM admin_records
       WHERE tenant_id = $1 AND module = $2 AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC
       LIMIT $3 OFFSET $4`,
      [actor.tenantId, this.module, limit, offset]
    );
    return result.rows.map((row) => dto<K>(row));
  }

  async get(actor: Actor, id: string) {
    authorize(actor, "read");
    const result = await pool.query(
      `SELECT * FROM admin_records
       WHERE tenant_id = $1 AND module = $2 AND id = $3 AND deleted_at IS NULL`,
      [actor.tenantId, this.module, id]
    );
    if (!result.rowCount) fail(404, "NOT_FOUND");
    return dto<K>(result.rows[0]);
  }

  async create(actor: Actor, raw: unknown) {
    authorize(actor, `${this.module}.write` as any);
    const payload = parsePayload(this.module, raw);

    return transaction(async (db) => {
      await validateReferences(db, actor, this.module, payload);
      const id = randomUUID();
      const result = await db.query(
        `INSERT INTO admin_records (id, tenant_id, module, payload, created_by)
         VALUES ($1, $2, $3, $4::jsonb, $5)
         RETURNING *`,
        [id, actor.tenantId, this.module, JSON.stringify(payload), actor.userId]
      );

      if (this.module === "approvals") {
        await db.query(
          `INSERT INTO admin_decisions (record_id, tenant_id, requester_id, status)
           VALUES ($1, $2, $3, 'pending')`,
          [id, actor.tenantId, actor.userId]
        );
      }

      if (this.module === "users") {
        const userPayload = payload as PayloadMap["users"];
        await db.query(
          `INSERT INTO admin_memberships (tenant_id, user_id, role, status)
           VALUES ($1, $2, $3, $4)`,
          [actor.tenantId, userPayload.userId, userPayload.role, userPayload.status]
        );
      }

      await audit(db, actor, `${this.module}.create`, id);
      return dto<K>(result.rows[0]);
    });
  }

  async update(actor: Actor, id: string, revision: number, raw: unknown) {
    authorize(actor, `${this.module}.write` as any);
    if (this.module === "approvals") fail(405, "APPROVALS_ARE_IMMUTABLE");

    const payload = parsePayload(this.module, raw);

    return transaction(async (db) => {
      const existing = await db.query(
        `SELECT * FROM admin_records
         WHERE tenant_id = $1 AND module = $2 AND id = $3 AND deleted_at IS NULL FOR UPDATE`,
        [actor.tenantId, this.module, id]
      );
      const row = existing.rows[0];
      if (!row) fail(404, "NOT_FOUND");
      if (row.revision !== revision) fail(409, "REVISION_CONFLICT");

      await validateReferences(db, actor, this.module, payload);

      if (this.module === "users") {
        const userPayload = payload as PayloadMap["users"];
        if (userPayload.userId !== row.payload.userId) fail(422, "IDENTITY_IMMUTABLE");
        if (userPayload.userId === actor.userId) fail(403, "SELF_MEMBERSHIP_CHANGE_DENIED");

        const updated = await db.query(
          `UPDATE admin_memberships
           SET role = $3, status = $4
           WHERE tenant_id = $1 AND user_id = $2 AND role <> 'owner'`,
          [actor.tenantId, userPayload.userId, userPayload.role, userPayload.status]
        );

        if (!updated.rowCount) fail(403, "OWNER_MEMBERSHIP_PROTECTED");
      }

      const updated = await db.query(
        `UPDATE admin_records
         SET payload = $4::jsonb, revision = revision + 1, updated_at = now()
         WHERE tenant_id = $1 AND module = $2 AND id = $3 AND deleted_at IS NULL
         RETURNING *`,
        [actor.tenantId, this.module, id, JSON.stringify(payload)]
      );

      await audit(db, actor, `${this.module}.update`, id);
      return dto<K>(updated.rows[0]);
    });
  }

  async remove(actor: Actor, id: string, revision: number) {
    authorize(actor, `${this.module}.write` as any);
    if (this.module === "approvals") fail(405, "APPROVALS_ARE_IMMUTABLE");

    await transaction(async (db) => {
      const existing = await db.query(
        `SELECT payload, revision FROM admin_records
         WHERE tenant_id = $1 AND module = $2 AND id = $3 AND deleted_at IS NULL FOR UPDATE`,
        [actor.tenantId, this.module, id]
      );
      const row = existing.rows[0];
      if (!row) fail(404, "NOT_FOUND");
      if (row.revision !== revision) fail(409, "REVISION_CONFLICT");

      if (this.module === "users") {
        if (row.payload.userId === actor.userId) fail(403, "SELF_DELETE_DENIED");
        const changed = await db.query(
          `UPDATE admin_memberships
           SET status = 'suspended'
           WHERE tenant_id = $1 AND user_id = $2 AND role <> 'owner'`,
          [actor.tenantId, row.payload.userId]
        );
        if (!changed.rowCount) fail(403, "OWNER_MEMBERSHIP_PROTECTED");
      }

      await db.query(
        `UPDATE admin_records
         SET deleted_at = now(), revision = revision + 1
         WHERE tenant_id = $1 AND id = $2`,
        [actor.tenantId, id]
      );

      await audit(db, actor, `${this.module}.delete`, id);
    });
  }
}

export async function reviewApproval(
  actor: Actor,
  id: string,
  revision: number,
  decision: "approved" | "rejected"
) {
  authorize(actor, "approvals.review");

  return transaction(async (db) => {
    const result = await db.query(
      `SELECT r.*, d.requester_id, d.status
       FROM admin_records r
       JOIN admin_decisions d ON d.record_id = r.id AND d.tenant_id = r.tenant_id
       WHERE r.tenant_id = $1 AND r.id = $2 AND r.module = 'approvals' AND r.deleted_at IS NULL
       FOR UPDATE OF r, d`,
      [actor.tenantId, id]
    );

    const row = result.rows[0];
    if (!row) fail(404, "NOT_FOUND");
    if (row.requester_id === actor.userId) fail(403, "SELF_APPROVAL_DENIED");
    if (row.status !== "pending" || row.revision !== revision) fail(409, "APPROVAL_ALREADY_CHANGED");

    const target = await db.query(
      `SELECT revision
       FROM admin_records
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [actor.tenantId, row.payload.resourceId]
    );

    if (!target.rowCount || target.rows[0].revision !== row.payload.resourceRevision) {
      fail(409, "STALE_RESOURCE");
    }

    await db.query(
      `UPDATE admin_decisions
       SET status = $3, reviewer_id = $4, reviewed_at = now()
       WHERE tenant_id = $1 AND record_id = $2`,
      [actor.tenantId, id, decision, actor.userId]
    );

    await db.query(
      `UPDATE admin_records
       SET revision = revision + 1, updated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [actor.tenantId, id]
    );

    await audit(db, actor, `approval.${decision}`, id);
    return { id, decision, revision: revision + 1 };
  });
}

export class Service<K extends Module> extends AdminService<K> {
  constructor(module: K) {
    super(module);
  }

  async mutate(actor: Actor, id: string, revision: number, payload: unknown, remove: boolean) {
    if (remove) {
      await this.remove(actor, id, revision);
      return { id, deleted: true };
    }

    return this.update(actor, id, revision, payload);
  }
}

export { reviewApproval as decide };
