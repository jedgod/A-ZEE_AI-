"use client";

import { useState } from "react";
import { Bar, LiveBadge } from "@/components/live/charts";
import { useLive } from "@/components/live/use-live";
import type { ProviderRow } from "@/lib/admin/providers";

type Payload = { generatedAt: string; days: number; providers: ProviderRow[] };
const ms = (v: number | null) => (v === null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);

/** Admin-only: configured AI providers, fallback state and performance. */
export function ProvidersPanel({ initial }: { initial: Payload | null }) {
  const [days, setDays] = useState<1 | 7>(1);
  const { data, updatedAt, error, paused, setPaused, loading, refresh } =
    useLive<Payload>(`/api/admin/providers?days=${days}`, days === 1 ? initial : null, 15_000, body => body.data);
  const slowest = Math.max(1, ...(data?.providers ?? []).map(p => p.p95Ms ?? 0));

  return (
    <section className="mb-8 rounded-2xl border bg-card p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">AI providers</h2>
          <p className="text-xs text-muted-foreground">Visible to owners and admins only. Requests fall through this list automatically when one fails.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-full border p-0.5 text-sm" role="tablist" aria-label="Period">
            {([1, 7] as const).map(d => (
              <button key={d} role="tab" aria-selected={days === d} onClick={() => setDays(d)}
                className={`rounded-full px-3 py-1 ${days === d ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{d === 1 ? "24 h" : "7 days"}</button>
            ))}
          </div>
          <LiveBadge updatedAt={updatedAt} paused={paused} error={error} loading={loading} onToggle={() => setPaused(!paused)} onRefresh={refresh} />
        </div>
      </div>
      {!data ? <p className="py-6 text-center text-sm text-muted-foreground">{error ? `Couldn't load providers (${error}).` : "Loading providers…"}</p>
        : !data.providers.length ? <p className="py-6 text-center text-sm text-muted-foreground">No provider has an API key configured.</p>
        : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground"><tr><th className="pb-2 font-medium">Provider</th><th className="pb-2 font-medium">Model</th><th className="pb-2 font-medium">State</th><th className="pb-2 font-medium">Success</th><th className="pb-2 text-right font-medium">Attempts</th><th className="pb-2 text-right font-medium">p95</th></tr></thead>
              <tbody>
                {data.providers.map(p => {
                  const rate = p.attempts ? Math.round((100 * p.successes) / p.attempts) : null;
                  return (
                    <tr key={p.id} className="border-t">
                      <td className="py-2 pr-3 font-medium">{p.label}</td>
                      <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">{p.model}</td>
                      <td className="py-2 pr-3"><span className="inline-flex items-center gap-1.5 text-xs" style={{ color: p.cooling ? "var(--chart-bad)" : "var(--chart-good)" }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />{p.cooling ? "Cooling down" : "Available"}</span></td>
                      <td className="py-2 pr-3"><div className="flex items-center gap-2"><div className="w-16"><Bar value={rate ?? 0} max={100} tone={rate === null || rate >= 90 ? "good" : "b"} /></div><span className="tabular-nums">{rate === null ? "—" : `${rate}%`}</span></div></td>
                      <td className="py-2 text-right tabular-nums">{p.attempts}</td>
                      <td className="py-2 text-right tabular-nums"><span className="text-muted-foreground">{ms(p.p95Ms)}</span><div className="ml-auto mt-1 w-16"><Bar value={p.p95Ms ?? 0} max={slowest} /></div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
    </section>
  );
}
