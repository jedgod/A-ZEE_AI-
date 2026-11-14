'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle, Minus, Plus } from 'lucide-react';
import styles from './aztrade.module.css';
import { AssetPicker } from './AssetPicker';
import { explain, fetchHistory } from './api';
import {
  chartDomain, fmtPct, fmtPrice, fmtTime, indexOfTime, panWindow, RANGES, sma, zoomWindow,
  type Asset, type History, type Point, type Range, type Recurrence, type RuleType,
} from './logic';

export type ChartRule = { rule_type: RuleType; threshold: string; recurrence?: string | null };
export type ChartAlert = { id: string; created_at: string; observed_price: string; source: string; message: string; quote_as_of: string | null; symbol: string };
export type NewAlert = { ruleType: RuleType; threshold: number; recurrence: Recurrence };

const H = 320, VOL_H = 56, PAD_L = 8, PAD_R = 64, PAD_T = 14, PAD_B = 26;
const BLUE = '#4f46e5', GREEN = '#059669', RED = '#dc2626', ORANGE = '#f59e0b', PURPLE = '#7c3aed', GRID = '#e2e8f0', MUTED = '#64748b';

/**
 * An interactive price chart in SVG. Hover to inspect, click to pin a price, wheel or +/- to zoom, drag to pan, pinch on touch screens.
 * It can draw an alert rule as a dashed line and mark the alerts that really fired. History is delayed, informational data from a free
 * public source; gaps (weekends, closed markets) are left empty and nothing is filled in.
 */
export function PriceChart({ asset, onAssetChange, rule, alerts = [], lastPrice, onCreateAlert }: {
  asset: Asset; onAssetChange?: (a: Asset) => void; rule?: ChartRule | null; alerts?: ChartAlert[]; lastPrice?: number | null; onCreateAlert?: (r: NewAlert) => Promise<void>;
}) {
  const forex = asset.assetClass === 'forex';
  const [range, setRange] = useState<Range>(forex ? '1M' : '1D');
  const [candles, setCandles] = useState(false);
  const [view, setView] = useState<'price' | 'change'>(rule?.rule_type.startsWith('pct_') ? 'change' : 'price');
  const [vol, setVol] = useState(false), [s20, setS20] = useState(false), [s50, setS50] = useState(false);
  const [cmpAsset, setCmpAsset] = useState<Asset | null>(null);
  const [data, setData] = useState<History | null>(null);
  const [cmp, setCmp] = useState<History | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [width, setWidth] = useState(0);
  const [win, setWin] = useState<[number, number] | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);
  const [markerId, setMarkerId] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [dir, setDir] = useState<'price_below' | 'price_above'>('price_below');
  const [thr, setThr] = useState('');
  const [rec, setRec] = useState<Recurrence>('once');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);

  useEffect(() => { setRange(asset.assetClass === 'forex' ? '1M' : '1D'); setWin(null); setCursor(null); setPinned(false); setSheet(false); setCmpAsset(null); setNote(''); }, [asset.symbol, asset.assetClass]);
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth)); ro.observe(el); setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const wantCandles = candles && view === 'price' && !cmpAsset;
  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true); setError(''); setWin(null); setCursor(null); setPinned(false);
    fetchHistory(asset, range, wantCandles, ctl.signal)
      .then(h => { if (!ctl.signal.aborted) { setData(h); if (wantCandles && !h.hasOhlc) setCandles(false); } })
      .catch(e => { if (!ctl.signal.aborted && (e as Error).name !== 'AbortError') { setData(null); setError(explain(e)); } })
      .finally(() => { if (!ctl.signal.aborted) setLoading(false); });
    return () => ctl.abort();
  }, [asset.symbol, asset.assetClass, range, wantCandles]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!cmpAsset) { setCmp(null); return; }
    const ctl = new AbortController();
    fetchHistory(cmpAsset, range, false, ctl.signal).then(h => { if (!ctl.signal.aborted) setCmp(h); }).catch(() => { if (!ctl.signal.aborted) setCmp(null); });
    return () => ctl.abort();
  }, [cmpAsset?.symbol, range]); // eslint-disable-line react-hooks/exhaustive-deps

  const pts: Point[] = data?.points ?? [];
  const n = pts.length;
  const a = win ? Math.max(0, Math.min(win[0], n - 1)) : 0;
  const b = win ? Math.max(a, Math.min(win[1], n - 1)) : Math.max(0, n - 1);
  const innerW = Math.max(40, width - PAD_L - PAD_R);
  const innerH = H - PAD_T - PAD_B;
  const hasVol = !!data?.hasVolume && vol && !wantCandles;
  const totalH = H + (hasVol ? VOL_H : 0);
  const pct = view === 'change' || !!cmpAsset;
  const intraday = !!data?.intervalMs && data.intervalMs < 86_000_000;
  const gapLimit = (data?.intervalMs ?? 0) * 4;
  const base = pts[a]?.c ?? 1;

  const g = useMemo(() => {
    if (n < 2) return null;
    const vis = pts.slice(a, b + 1);
    const valOf = (p: Point) => (pct ? (p.c / base - 1) * 100 : p.c);
    const vals: number[] = [];
    for (const p of vis) { if (wantCandles && p.h != null && p.l != null) vals.push(p.h, p.l); else vals.push(valOf(p)); }
    const m20 = s20 && !pct ? sma(pts, 20) : null, m50 = s50 && !pct ? sma(pts, 50) : null;
    for (let i = a; i <= b; i++) { const x = m20?.[i], y = m50?.[i]; if (x != null) vals.push(x); if (y != null) vals.push(y); }
    let cmpFor: ((t: number) => number | null) | null = null;
    if (cmpAsset && cmp && cmp.points.length > 1) {
      const cp = cmp.points; const tol = Math.max(cmp.intervalMs ?? 0, data?.intervalMs ?? 0) * 2;
      const at = (t: number) => { const fi = indexOfTime(cp, t); if (fi == null) return null; const i = Math.round(fi); return Math.abs(cp[i].t - t) <= tol ? cp[i].c : null; };
      const first = vis.map(p => at(p.t)).find(v => v != null);
      if (first) { cmpFor = (t: number) => { const v = at(t); return v == null ? null : (v / first - 1) * 100; }; for (const p of vis) { const v = cmpFor(p.t); if (v != null) vals.push(v); } }
    }
    let level: number | null = null;
    if (rule) {
      if (rule.rule_type.startsWith('price_') && !pct) level = Number(rule.threshold);
      if (rule.rule_type.startsWith('pct_') && view === 'change' && !cmpAsset) level = (rule.rule_type === 'pct_drop_24h' ? -1 : 1) * Number(rule.threshold);
    }
    const d = chartDomain(vals, level);
    const yOf = (v: number) => PAD_T + ((d.max - v) / (d.max - d.min)) * innerH;
    const xOfFi = (fi: number) => PAD_L + (b === a ? innerW / 2 : ((fi - a) / (b - a)) * innerW);
    return { vis, valOf, min: d.min, max: d.max, levelInside: d.levelInside, yOf, xOfFi, m20, m50, cmpFor, level };
  }, [n, a, b, pct, base, wantCandles, s20, s50, cmpAsset?.symbol, cmp, rule?.rule_type, rule?.threshold, view, innerW, data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Continuous segments of a series; a gap in the data breaks the line instead of being bridged.
  const segments = (at: (i: number) => number | null) => {
    const out: { x: number; y: number }[][] = []; let cur: { x: number; y: number }[] = [];
    for (let i = a; i <= b; i++) {
      const v = at(i);
      const brk = i > a && gapLimit > 0 && pts[i].t - pts[i - 1].t > gapLimit;
      if (v == null || brk) { if (cur.length) out.push(cur); cur = []; }
      if (v != null && g) cur.push({ x: g.xOfFi(i), y: g.yOf(v) });
    }
    if (cur.length) out.push(cur);
    return out;
  };
  const path = (seg: { x: number; y: number }[]) => seg.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  // ---- pointer: hover inspects, click pins, drag pans, wheel zooms, two fingers pinch ----
  const live = useRef({ a, b, n, innerW });
  live.current = { a, b, n, innerW };
  const ptrs = useRef(new Map<number, number>());
  const drag = useRef<{ x0: number; a0: number; b0: number; moved: boolean } | null>(null);
  const pinch = useRef<{ d0: number; a0: number; b0: number; anchor: number } | null>(null);
  const idxAt = (clientX: number) => { const r = svg.current!.getBoundingClientRect(); const L = live.current; const fi = L.a + ((clientX - r.left - PAD_L) / L.innerW) * (L.b - L.a); return Math.max(L.a, Math.min(L.b, Math.round(fi))); };
  const anchorAt = (clientX: number) => { const r = svg.current!.getBoundingClientRect(); return Math.max(0, Math.min(1, (clientX - r.left - PAD_L) / live.current.innerW)); };

  useEffect(() => {
    const el = svg.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (live.current.n < 8) return;
      e.preventDefault();
      const L = live.current;
      setWin(zoomWindow(L.a, L.b, L.n, e.deltaY < 0 ? 1.25 : 0.8, anchorAt(e.clientX)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    ptrs.current.set(e.pointerId, e.clientX);
    if (ptrs.current.size === 2) {
      const [x0, x1] = [...ptrs.current.values()];
      pinch.current = { d0: Math.abs(x1 - x0) || 1, a0: live.current.a, b0: live.current.b, anchor: anchorAt((x0 + x1) / 2) };
      drag.current = null;
    } else drag.current = { x0: e.clientX, a0: live.current.a, b0: live.current.b, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    if (ptrs.current.has(e.pointerId)) ptrs.current.set(e.pointerId, e.clientX);
    const L = live.current;
    if (pinch.current && ptrs.current.size >= 2) {
      const [x0, x1] = [...ptrs.current.values()]; const p = pinch.current;
      setWin(zoomWindow(p.a0, p.b0, L.n, Math.abs(x1 - x0) / p.d0, p.anchor)); return;
    }
    if (drag.current && (e.buttons & 1 || e.pointerType === 'touch')) {
      const dx = e.clientX - drag.current.x0;
      if (Math.abs(dx) > 4) drag.current.moved = true;
      if (drag.current.moved && (drag.current.a0 > 0 || drag.current.b0 < L.n - 1)) { setWin(panWindow(drag.current.a0, drag.current.b0, L.n, -(dx / L.innerW) * (drag.current.b0 - drag.current.a0))); return; }
    }
    if (!pinned) setCursor(idxAt(e.clientX));
  };
  const onUp = (e: React.PointerEvent) => {
    const wasDrag = drag.current?.moved;
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) pinch.current = null;
    drag.current = null;
    if (!wasDrag && e.pointerType !== 'touch') { const i = idxAt(e.clientX); if (pinned && cursor === i) setPinned(false); else { setCursor(i); setPinned(true); } }
    else if (!wasDrag && e.pointerType === 'touch') { setCursor(idxAt(e.clientX)); setPinned(true); }
  };

  const cur = cursor != null && cursor >= a && cursor <= b ? pts[cursor] : null;
  const first = pts[a], last = pts[b];
  const chg = first && last ? (last.c / first.c - 1) * 100 : null;
  const xOfTime = (t: number) => { const fi = g && indexOfTime(pts, t); return fi == null || fi < a || fi > b || !g ? null : g.xOfFi(fi); };
  const zoomed = !!win && (a > 0 || b < n - 1);
  const selAlert = alerts.find(x => x.id === markerId);
  const stepZoom = (f: number) => { const L = live.current; setWin(zoomWindow(L.a, L.b, L.n, f, 0.5)); };

  const openSheet = (price: number) => {
    const ref = lastPrice ?? last?.c ?? price;
    setDir(price <= ref ? 'price_below' : 'price_above'); setThr(String(Number(price.toPrecision(forex ? 6 : 7)))); setRec('once'); setSheet(true); setNote('');
  };
  async function activate() {
    const t = Number(thr);
    if (!onCreateAlert || !(t > 0)) { setNote('Enter a price above zero.'); return; }
    setBusy(true); setNote('');
    try { await onCreateAlert({ ruleType: dir, threshold: t, recurrence: rec }); setSheet(false); setNote('Monitor activated. Find it under Monitors.'); }
    catch (e) { setNote(explain(e)); }
    finally { setBusy(false); }
  }

  const lab = (v: number) => (pct ? fmtPct(v) : fmtPrice(v, forex));
  const levelLabel = g?.level != null && rule ? (rule.rule_type.startsWith('pct_') ? `Alert ${fmtPct(g.level)}` : `Alert ${rule.rule_type === 'price_below' ? '↓' : '↑'} ${fmtPrice(g.level, forex)}${g.levelInside ? '' : ' (off chart)'}`) : '';

  return (
    <div className={styles.chartBox}>
      {onAssetChange ? <AssetPicker value={asset} onChange={onAssetChange} label="Chart asset" onlyWithHistory /> : null}
      <div className={styles.chartHead}>
        <div><strong>{asset.symbol}</strong>{cmpAsset ? <span style={{ color: ORANGE, fontWeight: 700 }}> vs {cmpAsset.symbol}</span> : null}<small>{data ? `${data.currency} · ${data.source}` : 'Delayed quotes'}</small></div>
        {last ? <div className={styles.chartLast}><strong>{pct ? fmtPct(g?.valOf(last) ?? 0) : fmtPrice(last.c, forex)}</strong>{chg != null ? <small style={{ color: chg >= 0 ? GREEN : RED }}>{chg >= 0 ? '▲' : '▼'} {Math.abs(chg).toFixed(2)}% in view</small> : null}</div> : null}
      </div>

      <div className={styles.chartControls}>
        <label>Range <select value={range} onChange={e => setRange(e.target.value as Range)} aria-label="Range">
          {RANGES.map(r => <option key={r} value={r} disabled={forex && r === '1D'}>{r}{forex && r === '1D' ? ' (daily data only)' : ''}</option>)}
        </select></label>
        <label>Type <select value={candles ? 'candles' : 'line'} onChange={e => setCandles(e.target.value === 'candles')} aria-label="Chart type">
          <option value="line">Line</option>
          <option value="candles" disabled={view !== 'price' || !!cmpAsset}>Candles{view !== 'price' || cmpAsset ? ' (price view only)' : ''}</option>
        </select></label>
        <div className={styles.seg} role="group" aria-label="Chart view">
          <button type="button" aria-pressed={view === 'price'} className={view === 'price' ? styles.segOn : ''} onClick={() => setView('price')}>Price</button>
          <button type="button" aria-pressed={view === 'change'} className={view === 'change' ? styles.segOn : ''} onClick={() => { setView('change'); setCandles(false); }}>{range === '1D' ? '24h change' : '% change'}</button>
        </div>
        <details className={styles.indicators}>
          <summary>Indicators</summary>
          <div className={styles.indicatorMenu}>
            <label><input type="checkbox" checked={vol} disabled={!data?.hasVolume} onChange={e => setVol(e.target.checked)} /> Volume{data && !data.hasVolume ? ' (not provided)' : ''}</label>
            <label><input type="checkbox" checked={s20} onChange={e => setS20(e.target.checked)} /> SMA 20</label>
            <label><input type="checkbox" checked={s50} onChange={e => setS50(e.target.checked)} /> SMA 50</label>
            <AssetPicker value={cmpAsset} onChange={setCmpAsset} label="Compare with (% change from the same start)" onlyWithHistory />
            {cmpAsset ? <button type="button" className={styles.textButton} onClick={() => setCmpAsset(null)}>Remove comparison</button> : null}
          </div>
        </details>
        <div className={styles.zoomBtns}>
          <button type="button" aria-label="Zoom out" onClick={() => stepZoom(0.7)} disabled={!g}><Minus size={14} /></button>
          <button type="button" aria-label="Zoom in" onClick={() => stepZoom(1.4)} disabled={!g}><Plus size={14} /></button>
          {zoomed ? <button type="button" onClick={() => { setWin(null); setCursor(null); setPinned(false); }}>Reset zoom</button> : null}
        </div>
      </div>

      <div ref={wrap} className={styles.chartSurface} style={{ height: totalH }}>
        {loading ? <div className={styles.chartCenter}><LoaderCircle className={styles.spin} size={20} /> Loading history…</div>
          : error ? <div className={styles.chartCenter} role="alert">{error}</div>
          : !g || width < 80 ? <div className={styles.chartCenter}>Not enough data to draw a chart.</div>
          : (
            <svg ref={svg} width={width} height={totalH} role="img" aria-label={`${asset.symbol} price chart, ${range}. Hover to inspect, click to pin a price, scroll to zoom.`}
              style={{ touchAction: 'none', cursor: 'crosshair', display: 'block' }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => { if (!pinned) setCursor(null); }}>
              {[0, 0.25, 0.5, 0.75, 1].map(f => <line key={f} x1={PAD_L} x2={PAD_L + innerW} y1={PAD_T + f * innerH} y2={PAD_T + f * innerH} stroke={GRID} strokeWidth={1} />)}
              {[g.max, g.max - (g.max - g.min) * 0.25, (g.max + g.min) / 2, g.max - (g.max - g.min) * 0.75, g.min].map((v, i) => <text key={i} x={width - 4} y={PAD_T + (i / 4) * innerH + 4} textAnchor="end" fontSize={10.5} fill={MUTED}>{lab(v)}</text>)}
              <text x={PAD_L} y={H - 6} fontSize={10.5} fill={MUTED}>{fmtTime(pts[a].t, range, intraday)}</text>
              <text x={PAD_L + innerW / 2} y={H - 6} textAnchor="middle" fontSize={10.5} fill={MUTED}>{fmtTime(pts[Math.round((a + b) / 2)].t, range, intraday)}</text>
              <text x={PAD_L + innerW} y={H - 6} textAnchor="end" fontSize={10.5} fill={MUTED}>{fmtTime(pts[b].t, range, intraday)}</text>

              {hasVol ? (() => { const vmax = Math.max(...g.vis.map(p => p.v ?? 0), 1); const cols = Math.max(1, Math.min(g.vis.length, Math.floor(innerW / 4))); return Array.from({ length: cols }, (_, k) => {
                const i0 = Math.floor((k / cols) * g.vis.length), i1 = Math.max(i0 + 1, Math.floor(((k + 1) / cols) * g.vis.length));
                const v = g.vis.slice(i0, i1).reduce((s, p) => s + (p.v ?? 0), 0) / Math.max(1, i1 - i0); const h = Math.max(1, (v / vmax) * (VOL_H - 8));
                return <rect key={k} x={PAD_L + (k / cols) * innerW} y={H + VOL_H - h - 2} width={Math.max(1, innerW / cols - 1)} height={h} fill="#c7d2fe" />; }); })() : null}

              {wantCandles ? (() => { const m = Math.max(1, Math.min(g.vis.length, Math.floor(innerW / 5))); return Array.from({ length: m }, (_, k) => {
                const grp = g.vis.slice(Math.floor((k / m) * g.vis.length), Math.max(Math.floor((k / m) * g.vis.length) + 1, Math.floor(((k + 1) / m) * g.vis.length)));
                if (!grp.length || grp.some(p => p.o == null || p.h == null || p.l == null)) return null;
                const o = grp[0].o as number, c = grp[grp.length - 1].c, hi = Math.max(...grp.map(p => p.h as number)), lo = Math.min(...grp.map(p => p.l as number));
                const cx = PAD_L + ((k + 0.5) / m) * innerW, bw = Math.max(2, (innerW / m) * 0.7), col = c >= o ? GREEN : RED;
                return <g key={k}><line x1={cx} x2={cx} y1={g.yOf(hi)} y2={g.yOf(lo)} stroke={col} strokeWidth={1} /><rect x={cx - bw / 2} y={Math.min(g.yOf(o), g.yOf(c))} width={bw} height={Math.max(1.5, Math.abs(g.yOf(o) - g.yOf(c)))} fill={col} /></g>; }); })()
                : <>
                  {segments(i => g.valOf(pts[i])).map((s, i) => <g key={i}>{!cmpAsset && s.length > 1 ? <path d={`${path(s)} L${s[s.length - 1].x} ${PAD_T + innerH} L${s[0].x} ${PAD_T + innerH} Z`} fill="#eef2ff" /> : null}<path d={path(s)} fill="none" stroke={BLUE} strokeWidth={2} strokeLinejoin="round" /></g>)}
                  {g.m20 ? segments(i => g.m20![i]).map((s, i) => <path key={`a${i}`} d={path(s)} fill="none" stroke={ORANGE} strokeWidth={1.5} />) : null}
                  {g.m50 ? segments(i => g.m50![i]).map((s, i) => <path key={`b${i}`} d={path(s)} fill="none" stroke={PURPLE} strokeWidth={1.5} />) : null}
                  {g.cmpFor ? segments(i => g.cmpFor!(pts[i].t)).map((s, i) => <path key={`c${i}`} d={path(s)} fill="none" stroke={ORANGE} strokeWidth={2} />) : null}
                </>}

              {g.level != null && Number.isFinite(g.level) ? (() => { const y = g.yOf(Math.max(g.min, Math.min(g.max, g.level))); return <g><line x1={PAD_L} x2={PAD_L + innerW} y1={y} y2={y} stroke={RED} strokeWidth={1.5} strokeDasharray="6 4" /><rect x={PAD_L + 6} y={y - 19} width={levelLabel.length * 6.4 + 10} height={16} rx={3} fill="#ffffffe6" /><text x={PAD_L + 11} y={y - 7} fontSize={10.5} fontWeight={700} fill={RED}>{levelLabel}</text></g>; })() : null}

              {!pct ? alerts.map(al => { const xx = xOfTime(Date.parse(al.created_at)); const p = Number(al.observed_price); if (xx == null || !Number.isFinite(p)) return null; const yy = g.yOf(Math.max(g.min, Math.min(g.max, p)));
                return <circle key={al.id} cx={xx} cy={yy} r={7} fill={RED} stroke="#fff" strokeWidth={2} style={{ cursor: 'pointer' }} role="button" tabIndex={0} aria-label="Alert that fired. Press for the quote behind it" onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()} onClick={() => setMarkerId(markerId === al.id ? null : al.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setMarkerId(markerId === al.id ? null : al.id); }} />; }) : null}

              {cur ? (() => { const x = g.xOfFi(cursor as number); const y = g.yOf(wantCandles ? cur.c : g.valOf(cur)); return <g pointerEvents="none"><line x1={x} x2={x} y1={PAD_T} y2={PAD_T + innerH} stroke={MUTED} strokeWidth={1} opacity={0.7} /><circle cx={x} cy={y} r={4.5} fill={BLUE} stroke="#fff" strokeWidth={2} /></g>; })() : null}
            </svg>
          )}
      </div>

      {cur ? (
        <div className={styles.chartTip} role="status">
          <small>{fmtTime(cur.t, range, intraday)}{pinned ? ' · pinned' : ''}</small>
          {wantCandles && cur.o != null ? <strong>O {fmtPrice(cur.o, forex)}  H {fmtPrice(cur.h as number, forex)}  L {fmtPrice(cur.l as number, forex)}  C {fmtPrice(cur.c, forex)}</strong>
            : <strong>{pct ? fmtPct(g?.valOf(cur) ?? 0) : fmtPrice(cur.c, forex)}{pct ? `  (${fmtPrice(cur.c, forex)})` : ''}</strong>}
          {onCreateAlert && pinned && !sheet ? <button type="button" className={styles.primaryButton} onClick={() => openSheet(cur.c)}>Set alert at {fmtPrice(cur.c, forex)}</button> : null}
        </div>
      ) : !loading && !error && g ? <p className={styles.muted}>Hover to inspect a price. Click to pin it{onCreateAlert ? ' and set an alert' : ''}. Scroll or use + / − to zoom, drag to pan.</p> : null}

      {selAlert ? (
        <div className={styles.chartTip} role="status" style={{ borderColor: RED, background: '#fef2f2' }}>
          <strong style={{ color: RED }}>Alert fired {new Date(selAlert.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</strong>
          <span>Triggering quote {fmtPrice(Number(selAlert.observed_price), forex)} · {selAlert.source}</span>
          <small>Quote as of {selAlert.quote_as_of ? new Date(selAlert.quote_as_of).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'not provided by the source'} · detected {new Date(selAlert.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small>
        </div>
      ) : null}

      {sheet ? (
        <form className={styles.alertSheet} onSubmit={e => { e.preventDefault(); void activate(); }} aria-label="Set alert from chart">
          <strong>Set alert from chart</strong>
          <div className={styles.formRow}>
            <label>Condition <select value={dir} onChange={e => setDir(e.target.value as 'price_below' | 'price_above')}><option value="price_below">Crosses below</option><option value="price_above">Crosses above</option></select></label>
            <label>Price <input inputMode="decimal" value={thr} onChange={e => setThr(e.target.value)} maxLength={14} /> {forex ? '' : 'USD'}</label>
            <label>Recurrence <select value={rec} onChange={e => setRec(e.target.value as Recurrence)}><option value="once">Once</option><option value="each_crossing">Each crossing</option></select></label>
          </div>
          <p className={styles.muted}>Review: alert when {asset.symbol} {dir === 'price_below' ? 'crosses below' : 'crosses above'} {thr || '…'}{forex ? '' : ' USD'}, {rec === 'once' ? 'once, then wait to be re-armed' : 'every time it crosses'}. Prices are delayed and informational; nothing is traded.</p>
          {note ? <p role="alert" className={styles.error}>{note}</p> : null}
          <div className={styles.formActions}><span /><div><button type="button" className={styles.secondaryButton} onClick={() => setSheet(false)}>Cancel</button><button type="submit" className={styles.primaryButton} disabled={busy}>{busy ? 'Activating…' : 'Activate monitor'}</button></div></div>
        </form>
      ) : note ? <p className={styles.link} role="status">{note}</p> : null}

      {data ? <p className={styles.muted} style={{ fontSize: 11.5 }}>Source {data.source} · as of {data.asOf ? fmtTime(data.asOf, '1W', true) : '—'}. {data.notice}</p> : null}
    </div>
  );
}

