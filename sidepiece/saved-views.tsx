"use client"

import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"

const DEFAULT_VIEWS = [
  { id: "all", name: "All Users", filters: {} },
  { id: "active", name: "Active", filters: { status: "active" } },
  { id: "invited", name: "Invited", filters: { status: "invited" } },
  { id: "admins", name: "Admins", filters: { role: "admin" } },
  { id: "high-usage", name: "High Usage", filters: { minUsage: "10000" } },
]

interface Props {
  activeView: string
  onChange: (id: string, filters: Record<string, any>) => void
}

export function SavedViews({ activeView, onChange }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {DEFAULT_VIEWS.map((v) => (
        <Button
          key={v.id}
          size="sm"
          variant={activeView === v.id ? "default" : "outline"}
          onClick={() => onChange(v.id, v.filters)}
        >
          {v.name}
        </Button>
      ))}
      <Button size="sm" variant="ghost">
        <Plus className="mr-1 h-3 w-3" />
        Save View
      </Button>
    </div>
  )
}
