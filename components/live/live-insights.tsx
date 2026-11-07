"use client";

import { AreaChart, Bar, Delta, LiveBadge, Sparkline } from "@/components/live/charts";
import { useLive } from "@/components/live/use-live";
import type { Insights } from "@/lib/pipeline/insights";

const ms = (v: number | null) => (v === null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);
const pct = (part: number, whole: number) => (whole ? Math.round((100 * part) / whole) : null);

function Tile({ label, value, sub, spark, delta }: { label: string; value: string; sub?: string; spark?: number[]; delta?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border p-4" style={{ background: "var(--chart-surface)", borderColor: "var(--chart-grid)" }}>
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--chart-text)" }}>{label}</p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <p className="text-3xl font-semibold tabular-nums" style={{ color: "var(--chart-ink)" }}>{value}</p>
        {spark && <Sparkline values={spark} label={`${label} trend`} />}
      </div>
      <div className="mt-1 flex min-h-5 flex-wrap items-center gap-x-2 text-xs" style={{ color: "var(--chart-text)" }}>{delta}{sub && <span>{sub}</span>}</div>
    </div>
  );
}

function Card({ title, note, children, className = "" }: { title: string; note?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border p-5 ${className}`} style={{ background: "var(--chart-surface)", borderColor: "var(--chart-grid)" }}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold" style={{ color: "var(--chart-ink)" }}>{title}</h2>
        {note && <span className="text-xs" style={{ color: "var(--chart-text)" }}>{note}</span>}
      </div>
      {children}
    </section>
  );
}

function SpeedBars({ series, bucket }: { series: Insights["series"]; bucket: "hour" | "day" }) {
  const max = Math.max(1, ...series.map(p => p.p50Ms ?? 0));
  const fmt = (iso: string) => { const d = new Date(iso); return bucket === "hour" ? d.toLocaleTimeString([], { hour: "numeric" }) : d.toLocaleDateString([], { month: "short", day: "numeric" }); };
  if (!series.some(p => p.p50Ms !== null)) return <Empty>No timings yet.</Empty>;
  return (
    <div>
      <div className="flex h-28 items-end gap-0.5" role="img" aria-label="Typical answer time per period">
        {series.map(p => (
          <div key={p.at} className="flex-1 rounded-t transition-[height] duration-500" title={`${fmt(p.at)}: ${p.p50Ms === null ? "no requests" : ms(p.p50Ms)}`}
            style={{ height: `${p.p50Ms === null ? 2 : Math.max(4, (p.p50Ms / max) * 100)}%`, background: p.p50Ms === null ? "var(--chart-grid)" : "var(--chart-a)", opacity: p.p50Ms === null ? 1 : 0.85 }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px]" style={{ color: "var(--chart-text)" }}><span>{fmt(series[0].at)}</span><span>{fmt(series[series.length - 1].at)}</span></div>
    </div>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="py-6 text-center text-sm" style={{ color: "var(--chart-text)" }}>{children}</p>;

export function LiveInsights({ days, initial }: { days: number; initial: Insights | null }) {
  const { data, updatedAt, error, paused, setPaused, loading, refresh } =
    useLive<Insights>(`/api/insights?days=${days}`, initial, 15_000, body => body.data);
  const windowLabel = days === 1 ? "24 hours" : `${days} days`;

  if (!data) {
    return <Empty>{error ? `Insights couldn't load (${error}). They need the PostgreSQL database and the 006 migration.` : "Loading insights…"}</Empty>;
  }
  const total = data.requests.success + data.requests.failure;
  const failRate = pct(data.requests.failure, total);
  const prevFail = data.previous.requests ? (100 * data.previous.failures) / data.previous.requests : null;
  const volume = data.series.map(p => p.success + p.failure);
  const lat = data.series.map(p => p.p50Ms ?? 0);
  const rated = data.feedback.up + data.feedback.down;
  const satisfaction = pct(data.feedback.up, rated);
  const slowest = Math.max(1, ...data.providers.map(p => p.p95Ms ?? 0));
  const topError = Math.max(1, ...data.errors.map(e => e.count));
  const taskMax = Math.max(1, ...data.tasks.map(t => t.count));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm" style={{ color: "var(--chart-text)" }}>Last {windowLabel}, compared with the {windowLabel} before.</p>
        <LiveBadge updatedAt={updatedAt} paused={paused} error={error} loading={loading} onToggle={() => setPaused(!paused)} onRefresh={refresh} />
      </div>

      {total === 0 ? (
        <Card title="No requests yet"><Empty>Nothing in the last {windowLabel}. Send a message in the workspace; this page updates by itself.</Empty></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Requests" value={total.toLocaleString()} spark={volume} delta={<Delta now={total} before={data.previous.requests} />} />
            <Tile label="Success rate" value={failRate === null ? "—" : `${100 - failRate}%`} sub={`${data.requests.failure} failed`}
              delta={<Delta now={failRate} before={prevFail} goodWhen="down" />} />
            <Tile label="Typical time" value={ms(data.requests.p50Ms)} sub={`p95 ${ms(data.requests.p95Ms)}`} spark={lat}
              delta={<Delta now={data.requests.p50Ms} before={data.previous.p50Ms} goodWhen="down" />} />
            <Tile label="Helpful ratings" value={satisfaction === null ? "—" : `${satisfaction}%`} sub={`${data.feedback.up} up · ${data.feedback.down} down · ${data.feedback.corrections} corrections`} />
          </div>

          <div className="grid gap-5 lg:grid-cols-[1.7fr_1fr]">
            <Card title="Request volume" note={data.bucket === "hour" ? "per hour" : "per day"}>
              <AreaChart bucket={data.bucket} aLabel="Answered" bLabel="Failed" points={data.series.map(p => ({ at: p.at, a: p.success, b: p.failure }))} />
              <div className="mt-2 flex gap-4 text-xs" style={{ color: "var(--chart-text)" }}>
                <span><span style={{ color: "var(--chart-a)" }}>●</span> Total</span><span><span style={{ color: "var(--chart-b)" }}>●</span> Failed</span>
              </div>
            </Card>
            <Card title="Answer speed" note="typical time per answer">
              <SpeedBars series={data.series} bucket={data.bucket} />
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                {[["Typical", ms(data.requests.p50Ms)], ["Slowest 5%", ms(data.requests.p95Ms)], ["Failed", `${data.requests.failure}`]].map(([k, v]) => (
                  <div key={k} className="rounded-lg border p-2" style={{ borderColor: "var(--chart-grid)" }}>
                    <dt className="text-[11px]" style={{ color: "var(--chart-text)" }}>{k}</dt>
                    <dd className="text-sm font-semibold tabular-nums" style={{ color: "var(--chart-ink)" }}>{v}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </div>

          <div className={`grid gap-5 ${data.providers.length > 0 ? "lg:grid-cols-2" : ""}`}>
            {data.providers.length > 0 && (
            <Card title="Providers" note="routing and fallback">
              {data.providers.length ? (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs" style={{ color: "var(--chart-text)" }}><th className="pb-2 font-medium">Provider</th><th className="pb-2 font-medium">Success</th><th className="pb-2 font-medium">Attempts</th><th className="pb-2 text-right font-medium">p95</th></tr></thead>
                  <tbody>
                    {data.providers.map(p => {
                      const rate = pct(p.successes, p.attempts) ?? 0;
                      return (
                        <tr key={p.id} className="border-t" style={{ borderColor: "var(--chart-grid)", color: "var(--chart-ink)" }}>
                          <td className="py-2 pr-3 font-medium">{p.id}</td>
                          <td className="py-2 pr-3"><div className="flex items-center gap-2"><div className="w-16"><Bar value={rate} max={100} tone={rate >= 90 ? "good" : "b"} /></div><span className="tabular-nums">{rate}%</span></div></td>
                          <td className="py-2 pr-3 tabular-nums">{p.attempts}</td>
                          <td className="py-2 text-right tabular-nums"><span style={{ color: "var(--chart-text)" }}>{ms(p.p95Ms)}</span><div className="ml-auto mt-1 w-16"><Bar value={p.p95Ms ?? 0} max={slowest} /></div></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : <Empty>No provider calls yet.</Empty>}
            </Card>
            )}
            <Card title="Errors" note="by category">
              {data.errors.length ? (
                <ul className="space-y-3">{data.errors.map(e => (
                  <li key={e.category}><div className="flex justify-between text-sm" style={{ color: "var(--chart-ink)" }}><span>{e.category}</span><span className="tabular-nums">{e.count}</span></div><Bar value={e.count} max={topError} tone="b" /></li>
                ))}</ul>
              ) : <Empty>No errors in this period.</Empty>}
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Card title="What people ask" note="task type">
              {data.tasks.length ? (
                <ul className="space-y-3">{data.tasks.map(t => (
                  <li key={t.type}><div className="flex justify-between text-sm" style={{ color: "var(--chart-ink)" }}><span className="capitalize">{(t.type ?? "other").replace(/_/g, " ")}</span><span className="tabular-nums">{t.count}</span></div><Bar value={t.count} max={taskMax} /></li>
                ))}</ul>
              ) : <Empty>No tasks yet.</Empty>}
              <p className="mt-3 text-xs" style={{ color: "var(--chart-text)" }}>{data.attachments} of {total} requests had an attachment.</p>
            </Card>
            <Card title="Structure vs ratings" note={`rubric ${data.quality.rubric}`} className="lg:col-span-2">
              <p className="mb-3 text-xs" style={{ color: "var(--chart-text)" }}>Visible structure only, not accuracy. {data.quality.scored} answers scored; uncalibrated until each band has enough rated answers.</p>
              <div className="grid grid-cols-5 gap-2">
                {data.quality.buckets.map(b => {
                  const rate = b.helpfulRate === null ? null : Math.round(b.helpfulRate * 100);
                  return (
                    <div key={b.low} className="text-center">
                      <div className="mx-auto flex h-24 w-full max-w-12 items-end rounded-lg" style={{ background: "var(--chart-grid)" }} title={rate === null ? "No rated answers" : `${rate}% helpful of ${b.count}`}>
                        <div className="w-full rounded-lg transition-[height] duration-500" style={{ height: `${rate ?? 0}%`, background: "var(--chart-good)" }} />
                      </div>
                      <p className="mt-1 text-xs tabular-nums" style={{ color: "var(--chart-ink)" }}>{rate === null ? "—" : `${rate}%`}</p>
                      <p className="text-[11px] tabular-nums" style={{ color: "var(--chart-text)" }}>{b.low}–{b.high === 100 ? 100 : b.high - 1} · {b.count}</p>
                    </div>
                  );
                })}
              </div>
              {data.styles.length > 0 && (
                <p className="mt-4 text-xs" style={{ color: "var(--chart-text)" }}>Styles used: {data.styles.map(s => `${s.style} (${s.count})`).join(", ")}</p>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
