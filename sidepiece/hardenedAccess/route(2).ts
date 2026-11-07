import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/auth"
import { db } from "@/lib/db"
import { requireAdmin } from "@/lib/admin-guards"

// GET /api/admin/linked-accounts?q=
export async function GET(request: Request) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const allowed = await requireAdmin(session.userId)
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const q = searchParams.get("q") || ""

  const result = await db.query(
    `SELECT
       u.id AS user_id,
       u.email,
       u.name,
       COUNT(DISTINCT ds.id) AS shared_signals,
       MAX(ds.created_at) AS last_seen
     FROM users u
     JOIN device_signals ds ON ds.user_id = u.id
     JOIN free_quota_events fqe ON fqe.user_id = u.id
     WHERE ($1 = '' OR u.email ILIKE '%' || $1 || '%' OR u.name ILIKE '%' || $1 || '%')
     GROUP BY u.id, u.email, u.name
     HAVING COUNT(DISTINCT ds.id) > 0
     ORDER BY shared_signals DESC, last_seen DESC
     LIMIT 200`,
    [q]
  )

  return NextResponse.json({ accounts: result.rows })
}
