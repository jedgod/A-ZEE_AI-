"use client"

import { useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Shield } from "lucide-react"

interface Props {
  selected: string[]
  onSuccess: () => void
}

export function BulkPromoteToAdmin({ selected, onSuccess }: Props) {
  const [open, setOpen] = useState(false)
  const [phrase, setPhrase] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  if (selected.length === 0) return null

  const promote = async (e: React.MouseEvent) => {
    e.preventDefault() // keep dialog open until done
    if (phrase !== "PROMOTE" || loading) return

    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/admin/users/bulk-promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selected, confirmPhrase: "PROMOTE" }),
        credentials: "include",
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Failed to promote")
        return
      }

      setOpen(false)
      setPhrase("")
      onSuccess()
    } catch {
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setPhrase("")
          setError("")
          setOpen(true)
        }}
      >
        <Shield className="mr-1 h-3 w-3" />
        Promote to Admin
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bulk Promote to Admin</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to promote <strong>{selected.length}</strong> user
              {selected.length === 1 ? "" : "s"} to admin.
              <br />
              <br />
              This grants full console access. The action is logged.
              <br />
              <br />
              Type <strong>PROMOTE</strong> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <Input
            placeholder="Type PROMOTE"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            disabled={loading}
            autoFocus
          />

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={loading}
              onClick={() => {
                setPhrase("")
                setError("")
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={promote}
              disabled={loading || phrase !== "PROMOTE"}
            >
              {loading ? "Promoting..." : "Confirm Bulk Promotion"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
