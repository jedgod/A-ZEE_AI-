"use client"

import { useEffect, useState } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Search, Download, ShieldCheck } from "lucide-react"

interface LinkedAccount {
  user_id: string
  email: string
  name: string
  shared_signals: number
  last_seen: string
  allowed?: boolean
}

export default function LinkedAccountsPage() {
  const [accounts, setAccounts] = useState<LinkedAccount[]>([])
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [allowing, setAllowing] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    const res = await fetch(`/api/admin/linked-accounts?q=${encodeURIComponent(search)}`, {
      credentials: "include",
    })
    if (res.ok) {
      const data = await res.json()
      setAccounts(data.accounts || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const allow = async (userId: string) => {
    setAllowing(userId)
    try {
      const res = await fetch("/api/admin/linked-accounts/allow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userId }),
      })
      if (res.ok) load()
    } finally {
      setAllowing(null)
    }
  }

  const exportCsv = () => {
    if (!accounts.length) return
    const headers = ["user_id", "name", "email", "shared_signals", "last_seen", "allowed"]
    const rows = accounts.map((a) =>
      headers.map((h) => `"${String((a as any)[h] ?? "").replace(/"/g, '""')}"`).join(",")
    )
    const csv = [headers.join(","), ...rows].join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `linked-accounts-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Linked Free Accounts</h1>
          <p className="text-sm text-muted-foreground">
            Accounts sharing device signals that have exhausted free quota
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!accounts.length}>
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <div className="mb-4 flex gap-2 max-w-sm">
        <Input
          placeholder="Search email or name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <Button onClick={load} size="sm">
          <Search className="h-4 w-4" />
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Shared Signals</TableHead>
              <TableHead>Last Seen</TableHead>
              <TableHead className="w-[140px]">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">Loading...</TableCell>
              </TableRow>
            ) : accounts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">No linked accounts found</TableCell>
              </TableRow>
            ) : (
              accounts.map((a) => (
                <TableRow key={a.user_id}>
                  <TableCell className="font-medium">{a.name || "—"}</TableCell>
                  <TableCell>{a.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{a.shared_signals}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(a.last_seen).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {a.allowed ? (
                      <Badge variant="outline" className="text-green-600">Allowed</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={allowing === a.user_id}
                        onClick={() => allow(a.user_id)}
                      >
                        <ShieldCheck className="mr-1 h-3 w-3" />
                        {allowing === a.user_id ? "Allowing..." : "Allow"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
