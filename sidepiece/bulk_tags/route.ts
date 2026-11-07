import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/auth" // your existing auth
import { db } from "@/lib/db" // your existing Postgres client
import { requireAdmin, verifyCsrf } from "@/lib/admin-guards" // your existing guards

// POST /api/admin/tags
// Body: { userId: string, name: string }
export async function POST(request: Request) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const csrfOk = await verifyCsrf(request)
  if (!csrfOk) return NextResponse.json({ error: "Invalid CSRF" }, { status: 403 })

  const allowed = await requireAdmin(session.userId)
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { userId, name } = await request.json()
  if (!userId || !name?.trim()) {
    return NextResponse.json({ error: "Missing userId or name" }, { status: 400 })
  }

  const tagName = name.trim().toLowerCase()

  // Upsert tag
  const tag = await db.query(
    `INSERT INTO tags (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, name, color`,
    [tagName]
  )

  const tagId = tag.rows[0].id

  // Link to user
  await db.query(
    `INSERT INTO user_tags (user_id, tag_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [userId, tagId]
  )

  return NextResponse.json({ success: true, tag: tag.rows[0] })
}

// DELETE /api/admin/tags?userId=...&tagId=...
export async function DELETE(request: Request) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const csrfOk = await verifyCsrf(request)
  if (!csrfOk) return NextResponse.json({ error: "Invalid CSRF" }, { status: 403 })

  const allowed = await requireAdmin(session.userId)
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const userId = searchParams.get("userId")
  const tagId = searchParams.get("tagId")

  if (!userId || !tagId) {
    return NextResponse.json({ error: "Missing userId or tagId" }, { status: 400 })
  }

  await db.query(
    `DELETE FROM user_tags WHERE user_id = $1 AND tag_id = $2`,
    [userId, tagId]
  )

  return NextResponse.json({ success: true })
}
