import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function POST(request: Request) {
  const { userId, name } = await request.json()

  if (!userId || !name) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 })
  }

  let tag = await prisma.tag.findUnique({ where: { name } })
  if (!tag) {
    tag = await prisma.tag.create({
      data: { name, color: "#6366f1" },
    })
  }

  await prisma.userTag.upsert({
    where: { userId_tagId: { userId, tagId: tag.id } },
    update: {},
    create: { userId, tagId: tag.id },
  })

  return NextResponse.json({ success: true })
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url)
  const userId = searchParams.get("userId")
  const tagId = searchParams.get("tagId")

  if (!userId || !tagId) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 })
  }

  await prisma.userTag.delete({
    where: { userId_tagId: { userId, tagId } },
  })

  return NextResponse.json({ success: true })
}
