import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/auth"
import { db } from "@/lib/db"
import { getClientInfo, recordSignal } from "@/lib/device-signals"

// Call this from your signup handler or free-tier action
// POST /api/signals/record
// Body: { fingerprint?: string, cookieId?: string, action: "signup" | "free_usage" | "login" }
export async function POST(request: Request) {
  const session = await getServerSession()
  const body = await request.json().catch(() => ({}))
  const { fingerprint, cookieId, action = "free_usage" } = body

  const { ip, userAgent, deviceType } = getClientInfo(request)

  const signalId = await recordSignal({
    userId: session?.userId || null,
    ip,
    userAgent,
    deviceType,
    fingerprint,
    cookieId,
    action,
  })

  return NextResponse.json({ success: true, signalId })
}
