"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { X, Ban, CheckCircle, Download } from "lucide-react"

interface Props {
  selected: string[]
  onClear: () => void
  onActionComplete: () => void
}

export function BulkActionsBar({ selected, onClear, onActionComplete }: Props) {
  const [loading, setLoading] = useState(false)

  if (selected.length === 0) return null

  const run = async (action: "suspend" | "unsuspend" | "export") => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/users/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selected, action }),
        credentials: "include",
      })
      const data = await res.json()

      if (action === "export" && data.rows) {
        downloadCsv(data.rows)
      }

      if (res.ok) onActionComplete()
    } finally {
      setLoading(false)
    }
  }

  const downloadCsv = (rows: any[]) => {
    if (!rows.length) return
    const headers = Object.keys(rows[0]).join(",")
    const body = rows.map((r) => Object.values(r).join(",")).join("\n")
    const blob = new Blob([headers + "\n" + body], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `users-export-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border bg-background px-4 py-3 shadow-lg">
      <span className="text-sm font-medium">{selected.length} selected</span>
      <Button size="sm" variant="outline" disabled={loading} onClick={() => run("suspend")}>
        <Ban className="mr-1 h-3 w-3" /> Suspend
      </Button>
      <Button size="sm" variant="outline" disabled={loading} onClick={() => run("unsuspend")}>
        <CheckCircle className="mr-1 h-3 w-3" /> Unsuspend
      </Button>
      <Button size="sm" variant="outline" disabled={loading} onClick={() => run("export")}>
        <Download className="mr-1 h-3 w-3" /> Export
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear} disabled={loading}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
