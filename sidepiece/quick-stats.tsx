"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Users, UserCheck, Clock, AlertTriangle } from "lucide-react"
import type { User } from "@/types/user"

interface Props {
  users: User[]
}

export function QuickStats({ users }: Props) {
  const total = users.length
  const active = users.filter((u) => u.status === "active").length
  const invited = users.filter((u) => u.status === "invited").length
  const nearLimit = users.filter((u) => u.tokenUsage > 10000).length

  const stats = [
    { label: "Total Users", value: total, icon: Users, color: "text-blue-600" },
    { label: "Active", value: active, icon: UserCheck, color: "text-green-600" },
    { label: "Pending Invites", value: invited, icon: Clock, color: "text-amber-600" },
    { label: "Near Limit", value: nearLimit, icon: AlertTriangle, color: "text-red-600" },
  ]

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {stats.map((s) => (
        <Card key={s.label}>
          <CardContent className="flex items-center gap-3 p-4">
            <s.icon className={`h-5 w-5 ${s.color}`} />
            <div>
              <div className="text-2xl font-bold">{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
