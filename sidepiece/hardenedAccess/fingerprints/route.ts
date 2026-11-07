import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/auth"
import { db } from "@/lib/db"
import { requireAdmin, verifyCsrf } from "@/lib/admin-guards"

// POST /api/admin/linked-accounts/allow
// Body: { userId: string }
// Marks an account as explicitly allowed (false-positive override). Always wins over automatic checks.
export async function POST(request: Request) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const csrfOk = await verifyCsrf(request)
  if (!csrfOk) return NextResponse.json({ error: "Invalid CSRF" }, { status: 403 })

  const allowed = await requireAdmin(session.userId)
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { userId } = await request.json()
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 })

  // Upsert allow flag (adjust table/column names if your schema differs)
  await db.query(
    `INSERT INTO account_overrides (user_id, allowed, allowed_by, allowed_at)
     VALUES ($1, true, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET allowed = true, allowed_by = $2, allowed_at = NOW()`,
    [userId, session.userId]
  )

  // Audit
  await db.query(
    `INSERT INTO admin_audit_log (admin_id, action, target_ids, metadata)
     VALUES ($1, $2, $3, $4)`,
    [session.userId, "allow_linked_account", [userId], JSON.stringify({ reason: "false_positive_override" })]
  )

  return NextResponse.json({ success: true })
}
