"use client"

import { useEffect, useState } from "react"
import { IconRail } from "@/components/admin/icon-rail"
import { QuickStats } from "@/components/admin/quick-stats"
import { SavedViews } from "@/components/admin/saved-views"
import { UsersTable } from "@/components/admin/users-table"
import { BulkActionsBar } from "@/components/admin/bulk-actions-bar"
import type { User } from "@/types/user"

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [activeView, setActiveView] = useState<string>("all")
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)

  const fetchUsers = async (filters?: Record<string, any>) => {
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set("search", search)
    if (filters) {
      Object.entries(filters).forEach(([k, v]) => {
        if (v) params.set(k, String(v))
      })
    }
    const res = await fetch(`/api/admin/users?${params}`)
    const data = await res.json()
    setUsers(data.users || [])
    setLoading(false)
  }

  useEffect(() => {
    fetchUsers()
  }, [search])

  return (
    <div className="flex min-h-screen">
      <IconRail />

      <main className="ml-[68px] flex-1 p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground">
            Manage clientele, roles, tags, and access
          </p>
        </div>

        <QuickStats users={users} />

        <div className="my-4">
          <SavedViews
            activeView={activeView}
            onChange={(view, filters) => {
              setActiveView(view)
              fetchUsers(filters)
            }}
          />
        </div>

        <UsersTable
          users={users}
          loading={loading}
          search={search}
          onSearch={setSearch}
          selected={selected}
          onSelectedChange={setSelected}
          onRefresh={() => fetchUsers()}
        />

        <BulkActionsBar
          selected={selected}
          onClear={() => setSelected([])}
          onActionComplete={() => {
            setSelected([])
            fetchUsers()
          }}
        />
      </main>
    </div>
  )
}
