"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LiveBadge } from "@/components/live/charts";
import { useLive } from "@/components/live/use-live";
import type { ActivityItem, ActivityKind } from "@/lib/admin/live";

type Payload = { items: ActivityItem[]; hasMore: boolean };
const FILTERS: { id: "all" | ActivityKind; label: string }[] = [
  { id: "all", label: "All" }, { id: "admin", label: "Admin changes" }, { id: "pipeline", label: "Pipeline" }, { id: "feedback", label: "Feedback" },
];
const DOT = { neutral: "var(--chart-text)", good: "var(--chart-good)", bad: "var(--chart-bad)" } as const;
const KIND_LABEL: Record<ActivityKind, string> = { admin: "Admin", pipeline: "Pipeline", feedback: "Feedback" };

function rel(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 10 ? "just now" : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

/** A live, filterable timeline. `compact` is the dashboard card; the full page adds filters and paging. */
export function ActivityFeed({ initial, compact = false }: { initial: Payload | null; compact?: boolean }) {
  const [filter, setFilter] = useState<"all" | ActivityKind>("all");
  // Keyed by filter so switching starts a clean feed instead of briefly showing the old one.
  return <Feed key={filter} filter={filter} setFilter={setFilter} initial={filter === "all" ? initial : null} compact={compact} />;
}

function Feed({ filter, setFilter, initial, compact }: { filter: "all" | ActivityKind; setFilter: (f: "all" | ActivityKind) => void; initial: Payload | null; compact: boolean }) {
  const [older, setOlder] = useState<ActivityItem[]>([]);
  const [hasMore, setHasMore] = useState(initial?.hasMore ?? false);
  const [loadingMore, setLoadingMore] = useState(false);
  const limit = compact ? 8 : 30;
  const kinds = filter === "all" ? "admin,pipeline,feedback" : filter;
  const url = `/api/admin/activity?kinds=${kinds}&limit=${limit}`;
  const { data, updatedAt, error, paused, setPaused, loading, refresh } = useLive<Payload>(url, initial, 8_000, body => body.data);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 15_000); return () => clearInterval(t); }, []);

  // Items that arrive after the first load glow briefly.
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!data) return;
    const ids = data.items.map(i => i.id);
    if (seen.current) {
      const known = seen.current;
      const incoming = ids.filter(id => !known.has(id));
      if (incoming.length) { setFresh(new Set(incoming)); setTimeout(() => setFresh(new Set()), 4000); }
    }
    seen.current = new Set([...(seen.current ?? []), ...ids]);
    if (!older.length) setHasMore(data.hasMore);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = [...(data?.items ?? []), ...older.filter(o => !(data?.items ?? []).some(i => i.id === o.id))];
  const loadMore = async () => {
    const last = items.at(-1);
    if (!last) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`${url}&before=${encodeURIComponent(last.at)}`, { cache: "no-store" });
      if (res.ok) { const body = (await res.json()).data as Payload; setOlder(o => [...o, ...body.items]); setHasMore(body.hasMore); }
    } finally { setLoadingMore(false); }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {!compact ? (
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Activity filter">
            {FILTERS.map(f => (
              <button key={f.id} role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}
                className={`rounded-full border px-3 py-1 text-sm ${filter === f.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{f.label}</button>
            ))}
          </div>
        ) : <span />}
        <LiveBadge updatedAt={updatedAt} paused={paused} error={error} loading={loading} onToggle={() => setPaused(!paused)} onRefresh={refresh} />
      </div>

      {!data && !error ? <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">Loading activity…</p>
        : !items.length ? <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">{error ? `Couldn't load activity (${error}).` : "Nothing here yet. Changes and pipeline events appear as they happen."}</p>
        : (
          <ol className="relative space-y-1 border-l pl-5" aria-live="polite">
            {items.map(item => {
              const body = (
                <div className={`rounded-lg px-3 py-2 transition-colors duration-1000 hover:bg-muted/60 ${fresh.has(item.id) ? "bg-primary/10" : ""}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="text-sm font-medium">{item.title}</p>
                    <time dateTime={item.at} className="text-xs text-muted-foreground" title={new Date(item.at).toLocaleString()}>{rel(item.at)}</time>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    <span className="rounded border px-1 py-px text-[10px] uppercase tracking-wide">{KIND_LABEL[item.kind]}</span>
                    {item.actor && <> · by {item.actor}</>}{item.detail && <> · {item.detail}</>}
                  </p>
                </div>
              );
              return (
                <li key={item.id} className="relative">
                  <span aria-hidden className="absolute -left-[26px] top-4 h-2.5 w-2.5 rounded-full ring-4 ring-background" style={{ background: DOT[item.tone] }} />
                  {item.href ? <Link href={item.href} className="block">{body}</Link> : body}
                </li>
              );
            })}
          </ol>
        )}

      {compact ? (
        <Link href="/admin/activity" className="mt-3 inline-block text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground">Open full activity →</Link>
      ) : hasMore && (
        <button onClick={loadMore} disabled={loadingMore} className="mt-4 rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">{loadingMore ? "Loading…" : "Load older"}</button>
      )}
    </div>
  );
}
