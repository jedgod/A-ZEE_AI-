import { pool } from "@/lib/admin/db";
import { errorResponse, NO_STORE, requireStaff, uuid } from "@/lib/staff/route";

export const runtime = "nodejs";

/**
 * Activates a pending subscription once payment is received (from subscription-access-rule's
 * POST /api/admin/subscriptions/:id/activate). Differences from the original:
 * - the user's current subscription is ended in the same transaction (otherwise the
 *   one-current-subscription unique index rejects the activation for anyone already on a plan);
 * - annual billing gets a one-year period;
 * - the account's plan and the operations activity log are updated.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let admin;
  try {
    admin = await requireStaff(request, ["admin"]);
  } catch (error) { return errorResponse(error); }
  const id = uuid.safeParse((await params).id);
  if (!id.success) return Response.json({ error: "PENDING_SUBSCRIPTION_NOT_FOUND" }, { status: 404, headers: NO_STORE });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const pending = (await client.query("SELECT id, user_id, plan_id, billing FROM subscriptions WHERE id = $1 AND status = 'pending' FOR UPDATE", [id.data])).rows[0];
    if (!pending) {
      await client.query("ROLLBACK");
      return Response.json({ error: "PENDING_SUBSCRIPTION_NOT_FOUND" }, { status: 404, headers: NO_STORE });
    }
    await client.query(
      "UPDATE subscriptions SET status = 'canceled', ends_at = now(), updated_at = now() WHERE user_id = $1 AND status IN ('active', 'trialing', 'past_due')",
      [pending.user_id],
    );
    const result = await client.query(
      `UPDATE subscriptions
       SET status = 'active',
           current_period_start = COALESCE(current_period_start, now()),
           current_period_end = COALESCE(current_period_end, now() + CASE WHEN billing = 'annual' THEN interval '1 year' ELSE interval '1 month' END),
           started_at = now(),
           updated_at = now()
       WHERE id = $1
       RETURNING id, user_id, plan_id, status, current_period_end`,
      [pending.id],
    );
    await client.query("UPDATE users SET plan = $2, updated_at = now() WHERE id = $1", [pending.user_id, pending.plan_id]);
    await client.query(
      "INSERT INTO complaint_events (tenant_id, complaint_id, actor_id, actor_label, action, detail) VALUES ($1, NULL, $2, $3, 'subscription_activated', $4::jsonb)",
      [admin.tenantId, admin.id, admin.name, JSON.stringify({ subscriptionId: pending.id, planId: pending.plan_id })],
    );
    await client.query("COMMIT");
    return Response.json({ activated: result.rows[0] }, { headers: NO_STORE });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return errorResponse(error);
  } finally {
    client.release();
  }
}
