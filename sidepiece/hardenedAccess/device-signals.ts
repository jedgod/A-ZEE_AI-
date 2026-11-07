import { db } from "@/lib/db" // your existing Postgres client

export function getClientInfo(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")
  const ip =
    forwarded?.split(",")[0]?.trim() ||
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    "unknown"

  const ua = request.headers.get("user-agent") || ""
  let deviceType = "desktop"
  if (/mobile/i.test(ua)) deviceType = "mobile"
  else if (/tablet|ipad/i.test(ua)) deviceType = "tablet"

  return { ip, userAgent: ua, deviceType }
}

export async function recordSignal(opts: {
  userId?: string | null
  ip: string
  userAgent: string
  deviceType: string
  fingerprint?: string | null
  cookieId?: string | null
  action: "signup" | "free_usage" | "login"
}) {
  const { userId, ip, userAgent, deviceType, fingerprint, cookieId, action } = opts

  // Skip invalid IPs
  if (!ip || ip === "unknown") return null

  const result = await db.query(
    `INSERT INTO device_signals
       (user_id, ip_address, user_agent, device_type, fingerprint, cookie_id, action)
     VALUES ($1, $2::inet, $3, $4, $5, $6, $7)
     RETURNING id`,
    [userId || null, ip, userAgent, deviceType, fingerprint || null, cookieId || null, action]
  )

  return result.rows[0]?.id as string | undefined
}

export async function markQuotaExhausted(userId: string, signalId?: string) {
  await db.query(
    `INSERT INTO free_quota_events (user_id, signal_id) VALUES ($1, $2)`,
    [userId, signalId || null]
  )
}
