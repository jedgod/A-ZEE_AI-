import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/auth"
import { db } from "@/lib/db"
import { requireAdmin, verifyCsrf } from "@/lib/admin-guards"

const ALLOWED_ACTIONS = ["suspend", "unsuspend", "export"] as const
type BulkAction = (typeof ALLOWED_ACTIONS)[number]

// "make-admin" is intentionally excluded from bulk.
// Promote to admin should be a single-user action with explicit confirmation.

export async function POST(request: Request) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const csrfOk = await verifyCsrf(request)
  if (!csrfOk) return NextResponse.json({ error: "Invalid CSRF" }, { status: 403 })

  const allowed = await requireAdmin(session.userId)
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { ids, action } = await request.json()

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids required" }, { status: 400 })
  }
  if (!ALLOWED_ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  }
  if (ids.length > 100) {
    return NextResponse.json({ error: "Max 100 users per bulk action" }, { status: 400 })
  }

  // Prevent acting on yourself
  const safeIds = ids.filter((id: string) => id !== session.userId)

  if (action === "suspend") {
    await db.query(
      `UPDATE users SET status = 'suspended' WHERE id = ANY($1::text[])`,
      [safeIds]
    )
  } else if (action === "unsuspend") {
    await db.query(
      `UPDATE users SET status = 'active' WHERE id = ANY($1::text[])`,
      [safeIds]
    )
  } else if (action === "export") {
    const result = await db.query(
      `SELECT id, name, email, role, status, plan, last_active
       FROM users WHERE id = ANY($1::text[])`,
      [safeIds]
    )
    // Return CSV-ready data; frontend can download
    return NextResponse.json({ success: true, rows: result.rows })
  }

  // Audit log
  await db.query(
    `INSERT INTO admin_audit_log (admin_id, action, target_ids)
     VALUES ($1, $2, $3)`,
    [session.userId, action, safeIds]
  )

  return NextResponse.json({ success: true, affected: safeIds.length })
}
