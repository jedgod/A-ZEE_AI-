import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/auth"
import { db } from "@/lib/db"
import { requireAdmin, verifyCsrf } from "@/lib/admin-guards"

// GET /api/admin/views — list views for current admin
export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const allowed = await requireAdmin(session.userId)
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const result = await db.query(
    `SELECT id, name, filters, is_default, created_at
     FROM saved_views
     WHERE admin_id = $1
     ORDER BY created_at DESC`,
    [session.userId]
  )

  return NextResponse.json({ views: result.rows })
}

// POST /api/admin/views
// Body: { name: string, filters: object }
export async function POST(request: Request) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const csrfOk = await verifyCsrf(request)
  if (!csrfOk) return NextResponse.json({ error: "Invalid CSRF" }, { status: 403 })

  const allowed = await requireAdmin(session.userId)
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { name, filters } = await request.json()
  if (!name?.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 })
  }

  const result = await db.query(
    `INSERT INTO saved_views (admin_id, name, filters)
     VALUES ($1, $2, $3)
     RETURNING id, name, filters, is_default`,
    [session.userId, name.trim(), JSON.stringify(filters || {})]
  )

  return NextResponse.json({ view: result.rows[0] })
}

// DELETE /api/admin/views?id=...
export async function DELETE(request: Request) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const csrfOk = await verifyCsrf(request)
  if (!csrfOk) return NextResponse.json({ error: "Invalid CSRF" }, { status: 403 })

  const allowed = await requireAdmin(session.userId)
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  await db.query(
    `DELETE FROM saved_views WHERE id = $1 AND admin_id = $2`,
    [id, session.userId]
  )

  return NextResponse.json({ success: true })
}
