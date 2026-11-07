import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/auth"
import { db } from "@/lib/db"
import { requireAdmin, verifyCsrf } from "@/lib/admin-guards"

// POST /api/admin/users/promote
// Body: { userId: string, confirm: true }
// Single-user only. Requires explicit confirmation flag.
export async function POST(request: Request) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const csrfOk = await verifyCsrf(request)
  if (!csrfOk) return NextResponse.json({ error: "Invalid CSRF" }, { status: 403 })

  const allowed = await requireAdmin(session.userId)
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { userId, confirm } = await request.json()

  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 })
  }
  if (confirm !== true) {
    return NextResponse.json({ error: "Explicit confirmation required" }, { status: 400 })
  }
  if (userId === session.userId) {
    return NextResponse.json({ error: "Cannot change your own role" }, { status: 400 })
  }

  // Check target exists and is not already admin
  const target = await db.query(
    `SELECT id, name, email, role FROM users WHERE id = $1`,
    [userId]
  )
  if (target.rows.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }
  if (target.rows[0].role === "admin") {
    return NextResponse.json({ error: "User is already an admin" }, { status: 400 })
  }

  // Promote
  await db.query(
    `UPDATE users SET role = 'admin' WHERE id = $1`,
    [userId]
  )

  // Audit
  await db.query(
    `INSERT INTO admin_audit_log (admin_id, action, target_ids, metadata)
     VALUES ($1, $2, $3, $4)`,
    [
      session.userId,
      "promote_to_admin",
      [userId],
      JSON.stringify({
        targetName: target.rows[0].name,
        targetEmail: target.rows[0].email,
        previousRole: target.rows[0].role,
      }),
    ]
  )

  return NextResponse.json({
    success: true,
    user: { id: userId, role: "admin" },
  })
}
