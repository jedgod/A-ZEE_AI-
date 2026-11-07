import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/auth"
import { db } from "@/lib/db"
import { requireAdmin, verifyCsrf } from "@/lib/admin-guards"

// GET /api/admin/notes?userId=...
export async function GET(request: Request) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const allowed = await requireAdmin(session.userId)
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const userId = searchParams.get("userId")
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 })

  const result = await db.query(
    `SELECT id, content, author_id, created_at
     FROM user_notes
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  )

  return NextResponse.json({ notes: result.rows })
}

// POST /api/admin/notes
// Body: { userId: string, content: string }
export async function POST(request: Request) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const csrfOk = await verifyCsrf(request)
  if (!csrfOk) return NextResponse.json({ error: "Invalid CSRF" }, { status: 403 })

  const allowed = await requireAdmin(session.userId)
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { userId, content } = await request.json()
  if (!userId || !content?.trim()) {
    return NextResponse.json({ error: "Missing userId or content" }, { status: 400 })
  }

  const result = await db.query(
    `INSERT INTO user_notes (user_id, author_id, content)
     VALUES ($1, $2, $3)
     RETURNING id, content, author_id, created_at`,
    [userId, session.userId, content.trim()]
  )

  return NextResponse.json({ note: result.rows[0] })
}

// DELETE /api/admin/notes?id=...
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

  await db.query(`DELETE FROM user_notes WHERE id = $1`, [id])

  return NextResponse.json({ success: true })
}
