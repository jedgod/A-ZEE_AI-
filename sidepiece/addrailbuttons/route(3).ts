import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function GET(request: Request) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const q = searchParams.get("q") || ""

  const chats = await prisma.chat.findMany({
    where: {
      userId: session.userId,
      title: { contains: q, mode: "insensitive" },
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  })

  return NextResponse.json({ chats })
}
