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
import { Search } from "lucide-react"

interface LinkedAccount {
  user_id: string
  email: string
  name: string
  shared_signals: number
  last_seen: string
}

export default function LinkedAccountsPage() {
  const [accounts, setAccounts] = useState<LinkedAccount[]>([])
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)

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

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Linked Free Accounts</h1>
        <p className="text-sm text-muted-foreground">
          Accounts that share device signals and have exhausted free quota
        </p>
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center">
                  Loading...
                </TableCell>
              </TableRow>
            ) : accounts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center">
                  No linked accounts found
                </TableCell>
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
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
