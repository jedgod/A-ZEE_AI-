"use client"

import { Button } from "@/components/ui/button"
import { X, Shield, Ban, Download } from "lucide-react"

interface Props {
  selected: string[]
  onClear: () => void
  onActionComplete: () => void
}

export function BulkActionsBar({ selected, onClear, onActionComplete }: Props) {
  if (selected.length === 0) return null

  const run = async (action: string) => {
    await fetch("/api/admin/users/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: selected, action }),
    })
    onActionComplete()
  }

  return (
    <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border bg-background px-4 py-3 shadow-lg">
      <span className="text-sm font-medium">{selected.length} selected</span>
      <Button size="sm" variant="outline" onClick={() => run("make-admin")}>
        <Shield className="mr-1 h-3 w-3" /> Make Admin
      </Button>
      <Button size="sm" variant="outline" onClick={() => run("suspend")}>
        <Ban className="mr-1 h-3 w-3" /> Suspend
      </Button>
      <Button size="sm" variant="outline" onClick={() => run("export")}>
        <Download className="mr-1 h-3 w-3" /> Export
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
