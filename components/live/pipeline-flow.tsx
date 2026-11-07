"use client";

import Link from "next/link";
import { useState } from "react";
import { LiveBadge, Sparkline } from "@/components/live/charts";
import { useLive } from "@/components/live/use-live";
import type { StageLive } from "@/lib/admin/live";

type Payload = { generatedAt: string; stages: StageLive[] };

const HEALTH: Record<StageLive["health"], { label: string; color: string }> = {
  healthy: { label: "Healthy", color: "var(--chart-good)" },
  degraded: { label: "Degraded", color: "var(--chart-bad)" },
  idle: { label: "No activity", color: "var(--chart-text)" },
  unwired: { label: "Not connected", color: "var(--chart-text)" },
};

function ago(iso: string | null) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`;
}

/** The 01–14 stages as a live flow: health, 24 h volume and errors per stage, with each module a click away. */
export function PipelineFlow({ initial }: { initial: Payload | null }) {
  const { data, updatedAt, error, paused, setPaused, loading, refresh } =
    useLive<Payload>("/api/admin/pipeline/stats", initial, 10_000, body => body.data);
  const [open, setOpen] = useState<string | null>(null);

  if (!data) return <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">{error ? `Couldn't load stage activity (${error}).` : "Loading stages…"}</p>;
  const totals = data.stages.reduce((a, s) => ({ runs: a.runs + (s.runs ?? 0), errors: a.errors + s.errors }), { runs: 0, errors: 0 });
  const busiest = Math.max(1, ...data.stages.map(s => s.runs ?? 0));
  const degraded = data.stages.filter(s => s.health === "degraded").length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded-full border px-3 py-1">{totals.runs.toLocaleString()} events · 24 h</span>
          <span className="rounded-full border px-3 py-1" style={{ color: totals.errors ? "var(--chart-bad)" : undefined }}>{totals.errors} errors</span>
          <span className="rounded-full border px-3 py-1" style={{ color: degraded ? "var(--chart-bad)" : "var(--chart-good)" }}>{degraded ? `${degraded} stage${degraded === 1 ? "" : "s"} degraded` : "All wired stages healthy"}</span>
        </div>
        <LiveBadge updatedAt={updatedAt} paused={paused} error={error} loading={loading} onToggle={() => setPaused(!paused)} onRefresh={refresh} />
      </div>

      <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.stages.map((s, i) => {
          const h = HEALTH[s.health];
          const expanded = open === s.stage;
          const share = s.runs ? Math.max(4, (s.runs / busiest) * 100) : 0;
          return (
            <li key={s.stage} className="relative rounded-2xl border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-xs text-muted-foreground">Stage {s.stage}</p>
                  <h3 className="mt-0.5 text-lg font-semibold">{s.name}</h3>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs" style={{ color: h.color }}>
                  <span className={`h-1.5 w-1.5 rounded-full ${s.health === "healthy" ? "animate-pulse" : ""}`} style={{ background: h.color }} />{h.label}
                </span>
              </div>

              <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                  <p className="text-2xl font-semibold tabular-nums">{s.runs === null ? "—" : s.runs.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">{s.runs === null ? "no stored metadata" : `events · ${s.errors} error${s.errors === 1 ? "" : "s"}`}</p>
                </div>
                <Sparkline values={s.hourly} label={`${s.name} activity, last 24 hours`} />
              </div>

              <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted" role="presentation"><div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${share}%`, background: s.errors ? "var(--chart-b)" : "var(--chart-a)" }} /></div>
              <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>Last activity: {ago(s.lastAt)}</span>
                <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : s.stage)} className="underline underline-offset-2 hover:text-foreground">
                  {s.modules.length} module{s.modules.length === 1 ? "" : "s"} {expanded ? "▴" : "▾"}
                </button>
              </div>

              {expanded && (
                <ul className="mt-3 space-y-1 border-t pt-3">
                  {s.modules.map(m => (
                    <li key={m.slug}>
                      <Link href={`/admin/pipeline/${m.slug}`} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                        <span>{m.title}</span>
                        <span className="text-xs text-muted-foreground">{m.status === "connected" ? "connected" : m.status === "partial" ? "partly" : "not connected"}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {i < data.stages.length - 1 && <span aria-hidden className="absolute -right-2 top-1/2 hidden text-muted-foreground xl:block">{(i + 1) % 3 === 0 ? "" : "›"}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
