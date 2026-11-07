import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function POST(request: Request) {
  const { ids, action } = await request.json()

  if (!ids?.length || !action) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  switch (action) {
    case "make-admin":
      await prisma.user.updateMany({
        where: { id: { in: ids } },
        data: { role: "admin" },
      })
      break
    case "suspend":
      await prisma.user.updateMany({
        where: { id: { in: ids } },
        data: { status: "suspended" },
      })
      break
    case "export":
      // In real app, generate CSV and return download URL
      break
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
