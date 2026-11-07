import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/auth"
import { db } from "@/lib/db"

// GET /api/free-tier/check-linked
// Returns whether this free account appears linked to others that already exhausted free quota
export async function GET(request: Request) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const fingerprint = searchParams.get("fingerprint")
  const cookieId = searchParams.get("cookieId")

  // Get the most recent signals for this user
  const recent = await db.query(
    `SELECT fingerprint, cookie_id, ip_address
     FROM device_signals
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 5`,
    [session.userId]
  )

  const fps = new Set<string>()
  const cookies = new Set<string>()
  const ips = new Set<string>()

  for (const row of recent.rows) {
    if (row.fingerprint) fps.add(row.fingerprint)
    if (row.cookie_id) cookies.add(row.cookie_id)
    if (row.ip_address) ips.add(row.ip_address)
  }
  if (fingerprint) fps.add(fingerprint)
  if (cookieId) cookies.add(cookieId)

  if (fps.size === 0 && cookies.size === 0 && ips.size === 0) {
    return NextResponse.json({ linked: false, count: 0, accounts: [] })
  }

  // Find other users who share signals and have exhausted free quota
  const linked = await db.query(
    `SELECT DISTINCT ds.user_id, u.email, u.name
     FROM device_signals ds
     JOIN users u ON u.id = ds.user_id
     JOIN free_quota_events fqe ON fqe.user_id = ds.user_id
     WHERE ds.user_id != $1
       AND ds.created_at > NOW() - INTERVAL '30 days'
       AND (
         ($2::text[] IS NOT NULL AND ds.fingerprint = ANY($2))
         OR ($3::text[] IS NOT NULL AND ds.cookie_id = ANY($3))
         OR ($4::inet[] IS NOT NULL AND ds.ip_address = ANY($4))
       )`,
    [
      session.userId,
      fps.size ? Array.from(fps) : null,
      cookies.size ? Array.from(cookies) : null,
      ips.size ? Array.from(ips) : null,
    ]
  )

  return NextResponse.json({
    linked: linked.rows.length > 0,
    count: linked.rows.length,
    accounts: linked.rows,
  })
}
