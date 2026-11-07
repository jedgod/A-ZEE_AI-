import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const search = searchParams.get("search") || ""
  const status = searchParams.get("status")
  const role = searchParams.get("role")
  const minUsage = searchParams.get("minUsage")

  const users = await prisma.user.findMany({
    where: {
      AND: [
        search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
              ],
            }
          : {},
        status ? { status } : {},
        role ? { role } : {},
        minUsage ? { tokenUsage: { gte: Number(minUsage) } } : {},
      ],
    },
    include: {
      tags: { include: { tag: true } },
    },
    orderBy: { lastActive: "desc" },
  })

  const mapped = users.map((u) => ({
    ...u,
    tags: u.tags.map((ut) => ut.tag),
  }))

  return NextResponse.json({ users: mapped })
}
