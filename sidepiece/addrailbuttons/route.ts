import { NextResponse } from "next/server"
import { getServerSession } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const prompts = await prisma.prompt.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json({ prompts })
}

export async function POST(request: Request) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { title, content } = await request.json()
  if (!title?.trim() || !content?.trim()) {
    return NextResponse.json({ error: "title and content required" }, { status: 400 })
  }

  const prompt = await prisma.prompt.create({
    data: { userId: session.userId, title: title.trim(), content: content.trim() },
  })

  return NextResponse.json({ prompt })
}
