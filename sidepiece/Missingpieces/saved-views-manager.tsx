"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Plus, Bookmark, X } from "lucide-react"

interface SavedView {
  id: string
  name: string
  filters: Record<string, any>
  is_default: boolean
}

interface Props {
  currentFilters: Record<string, any>
  onApply: (filters: Record<string, any>) => void
}

export function SavedViewsManager({ currentFilters, onApply }: Props) {
  const [views, setViews] = useState<SavedView[]>([])
  const [name, setName] = useState("")
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const res = await fetch("/api/admin/views", { credentials: "include" })
    if (res.ok) {
      const data = await res.json()
      setViews(data.views || [])
    }
  }

  useEffect(() => {
    load()
  }, [])

  const save = async () => {
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      const res = await fetch("/api/admin/views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), filters: currentFilters }),
        credentials: "include",
      })
      if (res.ok) {
        setName("")
        setOpen(false)
        load()
      }
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    await fetch(`/api/admin/views?id=${id}`, { method: "DELETE", credentials: "include" })
    load()
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {views.map((v) => (
        <div key={v.id} className="flex items-center gap-0.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onApply(v.filters)}
            className="gap-1"
          >
            <Bookmark className="h-3 w-3" />
            {v.name}
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => remove(v.id)}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="ghost">
            <Plus className="mr-1 h-3 w-3" />
            Save View
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2">
          <div className="space-y-2">
            <Input
              placeholder="View name..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
              className="h-8"
            />
            <Button size="sm" className="w-full" onClick={save} disabled={saving || !name.trim()}>
              Save current filters
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
