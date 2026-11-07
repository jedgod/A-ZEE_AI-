"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Plus, X } from "lucide-react"

interface Tag {
  id: string
  name: string
  color: string
}

interface Props {
  userId: string
  tags: Tag[]
  onChange: () => void
}

export function TagPicker({ userId, tags, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [newTag, setNewTag] = useState("")
  const [loading, setLoading] = useState(false)

  const addTag = async () => {
    if (!newTag.trim() || loading) return
    setLoading(true)
    try {
      const res = await fetch("/api/admin/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, name: newTag.trim() }),
        credentials: "include",
      })
      if (res.ok) {
        setNewTag("")
        setOpen(false)
        onChange()
      }
    } finally {
      setLoading(false)
    }
  }

  const removeTag = async (tagId: string) => {
    const res = await fetch(`/api/admin/tags?userId=${userId}&tagId=${tagId}`, {
      method: "DELETE",
      credentials: "include",
    })
    if (res.ok) onChange()
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((t) => (
        <Badge key={t.id} variant="secondary" className="gap-1 pr-1 text-xs">
          <span style={{ color: t.color }}>●</span>
          {t.name}
          <button
            onClick={() => removeTag(t.id)}
            className="ml-0.5 rounded-full hover:bg-muted"
            aria-label={`Remove ${t.name}`}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="h-6 w-6">
            <Plus className="h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-52 p-2" align="start">
          <div className="flex gap-1">
            <Input
              placeholder="Tag name..."
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTag()}
              className="h-8 text-sm"
              disabled={loading}
            />
            <Button size="sm" onClick={addTag} disabled={loading || !newTag.trim()}>
              Add
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
