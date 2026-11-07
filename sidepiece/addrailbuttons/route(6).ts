import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const chats = await prisma.chat.findMany({
    where: { userId: session.userId },
    orderBy: { updatedAt: "desc" },
    take: 50,
  })

  return NextResponse.json({ chats })
}

export async function POST() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const chat = await prisma.chat.create({
    data: { userId: session.userId, title: "New chat" },
  })

  return NextResponse.json({ chat })
}
