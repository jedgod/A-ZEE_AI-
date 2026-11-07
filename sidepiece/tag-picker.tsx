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

  const addTag = async () => {
    if (!newTag.trim()) return
    await fetch("/api/admin/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, name: newTag.trim() }),
    })
    setNewTag("")
    setOpen(false)
    onChange()
  }

  const removeTag = async (tagId: string) => {
    await fetch(`/api/admin/tags?userId=${userId}&tagId=${tagId}`, { method: "DELETE" })
    onChange()
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((t) => (
        <Badge key={t.id} variant="secondary" className="gap-1 pr-1">
          <span style={{ color: t.color }}>●</span>
          {t.name}
          <button onClick={() => removeTag(t.id)} className="ml-0.5 rounded-full hover:bg-muted">
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
        <PopoverContent className="w-56 p-2">
          <div className="flex gap-1">
            <Input
              placeholder="New tag..."
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTag()}
              className="h-8"
            />
            <Button size="sm" onClick={addTag}>
              Add
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
