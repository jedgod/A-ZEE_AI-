import { pool } from "@/lib/admin/db";
import { errorResponse, NO_STORE, requireStaff } from "@/lib/staff/route";

export const runtime = "nodejs";

/**
 * Paid plans awaiting payment (from subscription-access-rule's GET /api/admin/subscriptions/pending).
 * Same response shape; authorized by the staff admin session instead of a JWT.
 */
export async function GET() {
  try {
    await requireStaff(undefined, ["admin"]);
    const { rows } = await pool.query(`
      SELECT s.id, s.user_id, u.email, s.plan_id, p.name AS plan_name,
             s.status, s.created_at, s.provider, s.provider_subscription_id, s.billing
      FROM subscriptions s
      JOIN users u ON u.id = s.user_id
      JOIN plans p ON p.id = s.plan_id
      WHERE s.status = 'pending'
      ORDER BY s.created_at DESC
    `);
    return Response.json(rows, { headers: NO_STORE });
  } catch (error) { return errorResponse(error); }
}
