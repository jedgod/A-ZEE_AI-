"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Trash2, MessageSquare } from "lucide-react"

interface Note {
  id: string
  content: string
  author_id: string
  created_at: string
}

interface Props {
  userId: string
}

export function UserNotes({ userId }: Props) {
  const [notes, setNotes] = useState<Note[]>([])
  const [content, setContent] = useState("")
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  const load = async () => {
    const res = await fetch(`/api/admin/notes?userId=${userId}`, { credentials: "include" })
    if (res.ok) {
      const data = await res.json()
      setNotes(data.notes || [])
    }
  }

  useEffect(() => {
    if (open) load()
  }, [open, userId])

  const add = async () => {
    if (!content.trim() || loading) return
    setLoading(true)
    try {
      const res = await fetch("/api/admin/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, content: content.trim() }),
        credentials: "include",
      })
      if (res.ok) {
        setContent("")
        load()
      }
    } finally {
      setLoading(false)
    }
  }

  const remove = async (id: string) => {
    await fetch(`/api/admin/notes?id=${id}`, { method: "DELETE", credentials: "include" })
    load()
  }

  return (
    <div>
      <Button variant="ghost" size="sm" onClick={() => setOpen(!open)}>
        <MessageSquare className="mr-1 h-3 w-3" />
        Notes {notes.length > 0 && `(${notes.length})`}
      </Button>

      {open && (
        <div className="mt-2 space-y-2 rounded-md border p-3">
          <ScrollArea className="max-h-40">
            {notes.length === 0 ? (
              <p className="text-xs text-muted-foreground">No notes yet</p>
            ) : (
              notes.map((n) => (
                <div key={n.id} className="mb-2 flex items-start justify-between gap-2 text-sm">
                  <div>
                    <p>{n.content}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(n.created_at).toLocaleString()}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => remove(n.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))
            )}
          </ScrollArea>
          <div className="flex gap-2">
            <Textarea
              placeholder="Add a note..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[60px] text-sm"
            />
            <Button size="sm" onClick={add} disabled={loading || !content.trim()}>
              Add
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
