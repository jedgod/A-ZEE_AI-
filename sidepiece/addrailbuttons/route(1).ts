import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const count = await prisma.notification.count({
    where: { userId: session.userId, read: false },
  })

  return NextResponse.json({ count })
}
