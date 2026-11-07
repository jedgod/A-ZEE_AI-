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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Shield } from "lucide-react"

interface Props {
  userId: string
  userName: string
  userEmail: string
  currentRole: string
  onSuccess: () => void
}

export function PromoteToAdmin({
  userId,
  userName,
  userEmail,
  currentRole,
  onSuccess,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  if (currentRole === "admin") return null

  const promote = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/users/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, confirm: true }),
        credentials: "include",
      })
      if (res.ok) {
        setOpen(false)
        onSuccess()
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Shield className="mr-1 h-3 w-3" />
          Promote to Admin
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Promote to Admin</AlertDialogTitle>
          <AlertDialogDescription>
            This will give <strong>{userName}</strong> ({userEmail}) full admin
            access to the console, including user management, billing, and settings.
            <br />
            <br />
            This action is logged and cannot be undone from this dialog.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={promote} disabled={loading}>
            {loading ? "Promoting..." : "Confirm Promotion"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
