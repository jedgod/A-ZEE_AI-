import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/auth"
import { db } from "@/lib/db"
import { requireAdmin, verifyCsrf } from "@/lib/admin-guards"

const MAX_BULK_PROMOTE = 20

// POST /api/admin/users/bulk-promote
// Body: { ids: string[], confirmPhrase: "PROMOTE" }
export async function POST(request: Request) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const csrfOk = await verifyCsrf(request)
  if (!csrfOk) return NextResponse.json({ error: "Invalid CSRF" }, { status: 403 })

  const allowed = await requireAdmin(session.userId)
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { ids, confirmPhrase } = await request.json()

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids required" }, { status: 400 })
  }
  if (ids.length > MAX_BULK_PROMOTE) {
    return NextResponse.json(
      { error: `Maximum ${MAX_BULK_PROMOTE} users per bulk promote` },
      { status: 400 }
    )
  }
  if (confirmPhrase !== "PROMOTE") {
    return NextResponse.json(
      { error: 'Type "PROMOTE" to confirm' },
      { status: 400 }
    )
  }

  // Exclude self
  const safeIds = ids.filter((id: string) => id !== session.userId)
  if (safeIds.length === 0) {
    return NextResponse.json({ error: "No valid users to promote" }, { status: 400 })
  }

  // Only promote non-admins
  const targets = await db.query(
    `SELECT id, name, email, role FROM users
     WHERE id = ANY($1::text[]) AND role != 'admin'`,
    [safeIds]
  )

  if (targets.rows.length === 0) {
    return NextResponse.json({ error: "No eligible users found" }, { status: 400 })
  }

  const eligibleIds = targets.rows.map((r: any) => r.id)

  await db.query(
    `UPDATE users SET role = 'admin' WHERE id = ANY($1::text[])`,
    [eligibleIds]
  )

  // Audit
  await db.query(
    `INSERT INTO admin_audit_log (admin_id, action, target_ids, metadata)
     VALUES ($1, $2, $3, $4)`,
    [
      session.userId,
      "bulk_promote_to_admin",
      eligibleIds,
      JSON.stringify({
        count: eligibleIds.length,
        targets: targets.rows.map((r: any) => ({
          id: r.id,
          name: r.name,
          email: r.email,
          previousRole: r.role,
        })),
      }),
    ]
  )

  return NextResponse.json({
    success: true,
    promoted: eligibleIds.length,
  })
}
