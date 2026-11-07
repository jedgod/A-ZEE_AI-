"use client";

import { useEffect, useId, useState } from "react";

// Dependency-free SVG charts shared by Insights, Pipeline and Activity. They use CSS variables
// (--chart-a/--chart-b/--chart-grid/--chart-text) so each page themes them for light and dark.

export function Sparkline({ values, className, label }: { values: number[]; className?: string; label?: string }) {
  const id = useId();
  const w = 96, h = 28, max = Math.max(1, ...values);
  if (values.length < 2) return <svg className={className} width={w} height={h} aria-hidden />;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 2 - (v / max) * (h - 4)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg className={className} width={w} height={h} viewBox={`0 0 ${w} ${h}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--chart-a)" stopOpacity=".35" /><stop offset="1" stopColor="var(--chart-a)" stopOpacity="0" /></linearGradient></defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke="var(--chart-a)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export type Point = { at: string; a: number; b: number };

/** Stacked area: `a` (answered) under `b` (failed), with hover read-out and a visually-hidden table for screen readers. */
export function AreaChart({ points, bucket, aLabel, bLabel }: { points: Point[]; bucket: "hour" | "day"; aLabel: string; bLabel: string }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const w = 640, h = 220, pad = { l: 36, r: 8, t: 10, b: 24 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const totals = points.map(p => p.a + p.b);
  const rawMax = Math.max(1, ...totals);
  const max = Math.max(4, Math.ceil(rawMax / 4) * 4);
  const x = (i: number) => pad.l + (points.length < 2 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const path = (get: (p: Point) => number) => points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(get(p)).toFixed(1)}`).join(" ");
  const area = (get: (p: Point) => number, base: (p: Point) => number) =>
    `${path(get)} ${[...points].reverse().map((p, i) => `L${x(points.length - 1 - i).toFixed(1)},${y(base(p)).toFixed(1)}`).join(" ")} Z`;
  const fmt = (iso: string) => { const d = new Date(iso); return bucket === "hour" ? d.toLocaleTimeString([], { hour: "numeric" }) : d.toLocaleDateString([], { month: "short", day: "numeric" }); };
  const ticks = [0, 1, 2, 3, 4].map(i => (max / 4) * i);
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));
  const active = hover === null ? null : points[hover];

  if (!points.length) return null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label={`${aLabel} and ${bLabel} over time`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={e => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * w;
          setHover(Math.max(0, Math.min(points.length - 1, Math.round(((px - pad.l) / iw) * (points.length - 1)))));
        }}>
        <defs>
          <linearGradient id={`${id}a`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--chart-a)" stopOpacity=".45" /><stop offset="1" stopColor="var(--chart-a)" stopOpacity=".02" /></linearGradient>
          <linearGradient id={`${id}b`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--chart-b)" stopOpacity=".6" /><stop offset="1" stopColor="var(--chart-b)" stopOpacity=".1" /></linearGradient>
        </defs>
        {ticks.map(t => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeDasharray={t ? "3 4" : undefined} />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--chart-text)">{Math.round(t)}</text>
          </g>
        ))}
        <path d={area(p => p.a + p.b, () => 0)} fill={`url(#${id}a)`} />
        <path d={path(p => p.a + p.b)} fill="none" stroke="var(--chart-a)" strokeWidth="2" strokeLinejoin="round" />
        <path d={area(p => p.b, () => 0)} fill={`url(#${id}b)`} />
        <path d={path(p => p.b)} fill="none" stroke="var(--chart-b)" strokeWidth="1.5" strokeLinejoin="round" />
        {points.map((p, i) => i % labelEvery === 0 && (
          <text key={p.at} x={x(i)} y={h - 6} textAnchor="middle" fontSize="10" fill="var(--chart-text)">{fmt(p.at)}</text>
        ))}
        {hover !== null && active && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="var(--chart-text)" strokeOpacity=".4" />
            <circle cx={x(hover)} cy={y(active.a + active.b)} r="4" fill="var(--chart-a)" stroke="var(--chart-surface)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {hover !== null && active && (
        <div className="pointer-events-none absolute top-1 rounded-lg border px-2.5 py-1.5 text-xs shadow-md" style={{
          left: `${(x(hover) / w) * 100}%`, transform: `translateX(${hover > points.length / 2 ? "-105%" : "5%"})`,
          background: "var(--chart-surface)", borderColor: "var(--chart-grid)", color: "var(--chart-ink)" }}>
          <div className="font-medium">{fmt(active.at)}</div>
          <div><span style={{ color: "var(--chart-a)" }}>●</span> {aLabel}: {active.a}</div>
          <div><span style={{ color: "var(--chart-b)" }}>●</span> {bLabel}: {active.b}</div>
        </div>
      )}
      <table className="sr-only"><caption>{aLabel} and {bLabel} per {bucket}</caption>
        <thead><tr><th>When</th><th>{aLabel}</th><th>{bLabel}</th></tr></thead>
        <tbody>{points.map(p => <tr key={p.at}><td>{fmt(p.at)}</td><td>{p.a}</td><td>{p.b}</td></tr>)}</tbody></table>
    </div>
  );
}

/** Change versus the previous period. `goodWhen` says which direction is an improvement. */
export function Delta({ now, before, goodWhen = "up", unit = "" }: { now: number | null; before: number | null; goodWhen?: "up" | "down"; unit?: string }) {
  if (now === null || before === null || before === 0) return <span className="text-xs" style={{ color: "var(--chart-text)" }}>no earlier data</span>;
  const pct = ((now - before) / before) * 100;
  if (Math.abs(pct) < 1) return <span className="text-xs" style={{ color: "var(--chart-text)" }}>no change{unit}</span>;
  const up = pct > 0, good = (goodWhen === "up") === up;
  return (
    <span className="text-xs font-medium" style={{ color: good ? "var(--chart-good)" : "var(--chart-bad)" }}>
      {up ? "▲" : "▼"} {Math.abs(Math.round(pct))}%<span className="font-normal" style={{ color: "var(--chart-text)" }}> vs previous</span>
    </span>
  );
}

export function Bar({ value, max, tone = "a" }: { value: number; max: number; tone?: "a" | "b" | "good" }) {
  const color = tone === "b" ? "var(--chart-b)" : tone === "good" ? "var(--chart-good)" : "var(--chart-a)";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--chart-grid)" }} role="presentation">
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${max ? Math.min(100, (value / max) * 100) : 0}%`, background: color }} />
    </div>
  );
}

export function LiveBadge({ updatedAt, paused, error, loading, onToggle, onRefresh }: {
  updatedAt: number | null; paused: boolean; error: string | null; loading: boolean; onToggle: () => void; onRefresh: () => void;
}) {
  const [, force] = useState(0);
  // Re-render every few seconds so "updated Ns ago" stays honest between polls.
  useEffect(() => { const t = setInterval(() => force(n => n + 1), 5000); return () => clearInterval(t); }, []);
  const ago = updatedAt ? Math.max(0, Math.round((Date.now() - updatedAt) / 1000)) : null;
  const state = error ? "error" : paused ? "paused" : "live";
  const color = state === "live" ? "var(--chart-good)" : state === "paused" ? "var(--chart-text)" : "var(--chart-bad)";
  return (
    <div className="flex items-center gap-2 text-xs" style={{ color: "var(--chart-text)" }}>
      <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1" style={{ borderColor: "var(--chart-grid)" }} aria-live="polite">
        <span className={`h-2 w-2 rounded-full ${state === "live" ? "animate-pulse" : ""}`} style={{ background: color }} />
        {state === "live" ? "Live" : state === "paused" ? "Paused" : "Can't refresh"}
        {ago !== null && <span>· {ago < 5 ? "just now" : `${ago}s ago`}</span>}
      </span>
      <button type="button" onClick={onToggle} className="rounded-md border px-2 py-1 hover:opacity-80" style={{ borderColor: "var(--chart-grid)" }}>{paused ? "Resume" : "Pause"}</button>
      <button type="button" onClick={onRefresh} disabled={loading} className="rounded-md border px-2 py-1 hover:opacity-80 disabled:opacity-50" style={{ borderColor: "var(--chart-grid)" }}>{loading ? "Refreshing…" : "Refresh"}</button>
      {error && <span style={{ color: "var(--chart-bad)" }}>{error}</span>}
    </div>
  );
}
