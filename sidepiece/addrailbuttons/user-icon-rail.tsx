"use client"

import { cn } from "@/lib/utils"
import {
  Sparkles,
  Clock,
  Star,
  Folder,
  Search,
  Bell,
  Library,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Badge } from "@/components/ui/badge"
import { useRouter, usePathname } from "next/navigation"
import { useEffect, useState } from "react"

const items = [
  { id: "new", icon: Sparkles, label: "New Chat", href: "/chat/new" },
  { id: "recent", icon: Clock, label: "Recent", href: "/chat/recent" },
  { id: "favorites", icon: Star, label: "Favorites", href: "/chat/favorites" },
  { id: "projects", icon: Folder, label: "Projects", href: "/projects" },
  { id: "search", icon: Search, label: "Search", href: "/search" },
  { id: "notifications", icon: Bell, label: "Notifications", href: "/notifications" },
  { id: "library", icon: Library, label: "Prompt Library", href: "/library" },
]

export function UserIconRail() {
  const router = useRouter()
  const pathname = usePathname()
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    fetch("/api/notifications/unread-count", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setUnread(d.count || 0))
      .catch(() => {})
  }, [])

  return (
    <TooltipProvider delayDuration={0}>
      <aside className="fixed left-0 top-0 z-40 flex h-screen w-[68px] flex-col border-r bg-background">
        <nav className="flex flex-1 flex-col items-center gap-1 py-4">
          {items.map((item) => {
            const isActive = pathname?.startsWith(item.href)
            const Icon = item.icon
            const showBadge = item.id === "notifications" && unread > 0

            return (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>
                  <Button
                    variant={isActive ? "secondary" : "ghost"}
                    size="icon"
                    className={cn(
                      "relative h-10 w-10 rounded-lg",
                      isActive && "bg-primary/10 text-primary"
                    )}
                    onClick={() => router.push(item.href)}
                  >
                    <Icon className="h-5 w-5" />
                    {showBadge && (
                      <Badge
                        variant="destructive"
                        className="absolute -right-1 -top-1 h-5 min-w-5 rounded-full px-1 text-[10px]"
                      >
                        {unread > 9 ? "9+" : unread}
                      </Badge>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            )
          })}
        </nav>
      </aside>
    </TooltipProvider>
  )
}
