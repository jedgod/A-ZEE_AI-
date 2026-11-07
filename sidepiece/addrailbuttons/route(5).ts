import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const favorites = await prisma.favorite.findMany({
    where: { userId: session.userId },
    include: { chat: true },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json({ favorites })
}

export async function POST(request: Request) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { chatId } = await request.json()
  if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 })

  const fav = await prisma.favorite.upsert({
    where: { userId_chatId: { userId: session.userId, chatId } },
    update: {},
    create: { userId: session.userId, chatId },
  })

  return NextResponse.json({ favorite: fav })
}

export async function DELETE(request: Request) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const chatId = searchParams.get("chatId")
  if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 })

  await prisma.favorite.deleteMany({
    where: { userId: session.userId, chatId },
  })

  return NextResponse.json({ success: true })
}
