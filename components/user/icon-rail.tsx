"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell, Clock, Folder, Library, Search, Sparkles, Star } from "lucide-react";

type Styles = Record<string, string>;

/** Unread count for the Bell. Zero for guests (the endpoint answers 401). Refreshes every minute and on demand. */
function useUnread() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/notifications/unread-count", { cache: "no-store" })
      .then(r => (r.ok ? r.json() : null)).then(d => { if (alive) setCount(d?.data?.count ?? 0); }).catch(() => undefined);
    load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") load(); }, 60_000);
    window.addEventListener("az:notifications", load);
    return () => { alive = false; clearInterval(timer); window.removeEventListener("az:notifications", load); };
  }, []);
  return count;
}

/**
 * The workspace's left icon rail: New chat and Recent act on the workspace itself; the rest open
 * their pages (which send guests to sign-in). Settings lives in the account menu, not here.
 */
export function UserIconRail({ styles, onNewChat, onRecent }: { styles: Styles; onNewChat: () => void; onRecent: () => void }) {
  const unread = useUnread();
  const link = (href: string, label: string, icon: React.ReactNode, badge?: number) => (
    <Link className={`${styles.railButton} relative`} href={href} aria-label={badge ? `${label} (${badge} unread)` : label} title={label}>
      {icon}
      {badge ? <span aria-hidden className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">{badge > 9 ? "9+" : badge}</span> : null}
    </Link>
  );
  return (
    <nav className={styles.rail} aria-label="Quick actions">
      <button className={styles.railButton} onClick={onNewChat} aria-label="New chat" title="New chat"><Sparkles size={20} /></button>
      <button className={styles.railButton} onClick={onRecent} aria-label="Recent conversations" title="Recent conversations"><Clock size={20} /></button>
      {link("/favorites", "Favorites", <Star size={20} />)}
      {link("/projects", "Projects", <Folder size={20} />)}
      {link("/search", "Search", <Search size={20} />)}
      {link("/notifications", "Notifications", <Bell size={20} />, unread)}
      {link("/library", "Prompt library", <Library size={20} />)}
    </nav>
  );
}
