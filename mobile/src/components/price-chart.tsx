import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, PanResponder, Pressable, Text as RNText, TextInput as RNTextInput, View, StyleSheet } from "react-native";
import type { ComponentProps, ComponentRef, ReactNode } from "react";
import { AssetPicker } from "./asset-picker";
import { fetchHistory, HISTORY_ERRORS, RANGES, type Asset, type History, type Point, type Range } from "@/lib/finance-data";
import { ApiError } from "@/lib/api";

const Text = (props: ComponentProps<typeof RNText>) => <RNText maxFontSizeMultiplier={1.05} {...props} />;
const TextInput = (props: ComponentProps<typeof RNTextInput>) => <RNTextInput maxFontSizeMultiplier={1.05} {...props} />;

export type ChartPalette = Record<"ink" | "muted" | "blue" | "blueDim" | "line" | "card" | "warn" | "warnBg" | "err" | "errBg", string>;
type RuleType = "pct_drop_24h" | "pct_rise_24h" | "price_below" | "price_above";
export type ChartRule = { rule_type: RuleType; threshold: string; recurrence?: string | null };
export type ChartAlert = { id: string; created_at: string; observed_price: string; source: string; message: string; quote_as_of: string | null; symbol: string };
export type NewAlert = { ruleType: RuleType; threshold: number; recurrence: "once" | "each_crossing" };

const H = 200, VOL_H = 34, PAD_L = 4, PAD_R = 56, PAD_T = 12, PAD_B = 20;
const GREEN = "#16a34a", RED = "#dc2626", ORANGE = "#f59e0b", PURPLE = "#7c3aed";

const fmtP = (v: number, forex = false) => (forex ? v.toFixed(4) : Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4));
const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
const fmtT = (t: number, range: Range, intraday: boolean) => {
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const day = d.toLocaleDateString([], { month: "short", day: "numeric", ...(range === "1Y" ? { year: "2-digit" } : {}) });
  return range === "1D" ? time : intraday ? `${day}, ${time}` : day;
};
const sma = (pts: Point[], n: number): (number | null)[] => pts.map((_, i) => (i < n - 1 ? null : pts.slice(i - n + 1, i + 1).reduce((s, p) => s + p.c, 0) / n));

/** Fractional index of time t in the (sorted) points, or null when t falls outside them. */
function indexOfTime(pts: Point[], t: number): number | null {
  if (!pts.length || t < pts[0].t || t > pts[pts.length - 1].t) return null;
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].t <= t) lo = mid; else hi = mid; }
  const span = pts[hi].t - pts[lo].t;
  return span > 0 ? lo + (t - pts[lo].t) / span : lo;
}

/**
 * An interactive price chart drawn with plain views. Press and drag to inspect a point, pinch to zoom, two fingers to pan, tap to pin a
 * price and "Set alert here". It can show an alert rule as a dashed line and the alerts that actually fired as markers. History is
 * delayed, informational data; gaps are left empty, never filled in.
 */
export function PriceChart({ palette: P, asset, onAssetChange, rule, alerts = [], lastPrice, onCreateAlert, onTouching }: {
  palette: ChartPalette; asset: Asset; onAssetChange?: (a: Asset) => void; rule?: ChartRule | null; alerts?: ChartAlert[]; lastPrice?: number | null;
  onCreateAlert?: (r: NewAlert) => Promise<void>; onTouching?: (down: boolean) => void;
}) {
  const forex = asset.assetClass === "forex";
  const [range, setRange] = useState<Range>(forex ? "1M" : "1D");
  const [candles, setCandles] = useState(false);
  const [view, setView] = useState<"price" | "change">(rule?.rule_type.startsWith("pct_") ? "change" : "price");
  const [vol, setVol] = useState(false), [s20, setS20] = useState(false), [s50, setS50] = useState(false);
  const [cmpAsset, setCmpAsset] = useState<Asset | null>(null);
  const [menu, setMenu] = useState(false);
  const [drop, setDrop] = useState<"range" | "type" | null>(null);
  const [data, setData] = useState<History | null>(null);
  const [cmp, setCmp] = useState<History | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [width, setWidth] = useState(0);
  const [win, setWin] = useState<[number, number] | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);
  const [markerId, setMarkerId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ price: number } | null>(null);
  const [dir, setDir] = useState<"price_below" | "price_above">("price_below");
  const [thr, setThr] = useState("");
  const [rec, setRec] = useState<"once" | "each_crossing">("once");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  // New asset: forex has no intraday data, so it starts on a month; everything else resets.
  useEffect(() => { setRange(asset.assetClass === "forex" ? "1M" : "1D"); setWin(null); setCursor(null); setPinned(false); setSheet(null); setCmpAsset(null); setNote(""); }, [asset.symbol, asset.assetClass]);

  const wantCandles = candles && view === "price" && !cmpAsset;
  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true); setError(""); setWin(null); setCursor(null); setPinned(false);
    fetchHistory(asset, range, wantCandles, ctl.signal)
      .then(h => { if (!ctl.signal.aborted) { setData(h); if (wantCandles && !h.hasOhlc) setCandles(false); } })
      .catch(e => { if (!ctl.signal.aborted) { setData(null); setError(HISTORY_ERRORS[(e as ApiError)?.code ?? ""] ?? "Couldn't load the chart."); } })
      .finally(() => { if (!ctl.signal.aborted) setLoading(false); });
    return () => ctl.abort();
  }, [asset.symbol, asset.assetClass, range, wantCandles]);
  useEffect(() => {
    if (!cmpAsset) { setCmp(null); return; }
    const ctl = new AbortController();
    fetchHistory(cmpAsset, range, false, ctl.signal).then(h => { if (!ctl.signal.aborted) setCmp(h); }).catch(() => { if (!ctl.signal.aborted) setCmp(null); });
    return () => ctl.abort();
  }, [cmpAsset?.symbol, range]);

  const pts = data?.points ?? [];
  const n = pts.length;
  const a = win ? Math.max(0, Math.min(win[0], n - 1)) : 0;
  const b = win ? Math.max(a, Math.min(win[1], n - 1)) : Math.max(0, n - 1);
  const innerW = Math.max(10, width - PAD_L - PAD_R);
  const innerH = H - PAD_T - PAD_B;
  const hasVol = !!data?.hasVolume && vol && !wantCandles;
  const pct = view === "change" || !!cmpAsset;
  const intraday = !!data?.intervalMs && data.intervalMs < 86_000_000;
  const gapLimit = (data?.intervalMs ?? 0) * 4;
  const base = pts[a]?.c ?? 1;

  const g = useMemo(() => {
    if (n < 2) return null;
    const vis = pts.slice(a, b + 1);
    const valOf = (p: Point) => (pct ? (p.c / base - 1) * 100 : p.c);
    let min = Infinity, max = -Infinity;
    const take = (v: number | null | undefined) => { if (v != null && Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; } };
    for (const p of vis) { if (wantCandles && p.h != null && p.l != null) { take(p.h); take(p.l); } else take(valOf(p)); }
    const m20 = s20 && !pct ? sma(pts, 20) : null, m50 = s50 && !pct ? sma(pts, 50) : null;
    for (let i = a; i <= b; i++) { take(m20?.[i]); take(m50?.[i]); }
    let cmpFor: ((t: number) => number | null) | null = null;
    if (cmpAsset && cmp && cmp.points.length > 1) {
      const cp = cmp.points; const tol = Math.max(cmp.intervalMs ?? 0, data?.intervalMs ?? 0) * 2;
      const at = (t: number) => { const fi = indexOfTime(cp, t); if (fi == null) return null; const i = Math.round(fi); return Math.abs(cp[i].t - t) <= tol ? cp[i].c : null; };
      const first = vis.map(p => at(p.t)).find(v => v != null);
      if (first) { cmpFor = (t: number) => { const v = at(t); return v == null ? null : (v / first - 1) * 100; }; for (const p of vis) take(cmpFor(p.t)); }
    }
    // The alert level only stretches the scale when it is close to the data; otherwise it is pinned to the edge and labelled "off chart".
    let level: number | null = null;
    if (rule) {
      if (rule.rule_type.startsWith("price_") && !pct) level = Number(rule.threshold);
      if (rule.rule_type.startsWith("pct_") && view === "change" && !cmpAsset) level = (rule.rule_type === "pct_drop_24h" ? -1 : 1) * Number(rule.threshold);
    }
    const span0 = (max - min) || Math.abs(max) * 0.02 || 1;
    if (level != null && Number.isFinite(level) && level >= min - span0 * 0.6 && level <= max + span0 * 0.6) { min = Math.min(min, level); max = Math.max(max, level); }
    const span = (max - min) || 1;
    min -= span * 0.06; max += span * 0.06;
    const yOf = (v: number) => PAD_T + ((max - v) / (max - min)) * innerH;
    const xOfFi = (fi: number) => PAD_L + (b === a ? innerW / 2 : ((fi - a) / (b - a)) * innerW);
    return { vis, valOf, min, max, yOf, xOfFi, m20, m50, cmpFor, level };
  }, [n, a, b, pct, base, wantCandles, s20, s50, cmpAsset?.symbol, cmp, rule?.rule_type, rule?.threshold, view, innerW, data]);

  // ---- plot nodes (rebuilt only when the data or the view changes, not while a finger moves) ----
  const plot = useMemo(() => {
    if (!g || width < 40) return null;
    const out: ReactNode[] = [];
    const valueAt = (series: (i: number) => number | null) => (x: number): number | null => {
      const fi = a + (b === a ? 0 : (x / innerW) * (b - a));
      const i0 = Math.floor(fi), i1 = Math.min(b, i0 + 1), f = fi - i0;
      if (gapLimit && pts[i1].t - pts[i0].t > gapLimit) return null;     // a gap in the data stays a gap
      const v0 = series(i0), v1 = series(i1);
      return v0 == null || v1 == null ? null : v0 + (v1 - v0) * f;
    };
    const drawLine = (key: string, at: (x: number) => number | null, color: string, fill?: string) => {
      let prev: number | null = null;
      for (let x = 0; x < innerW; x += 2) {
        const v = at(x);
        if (v == null) { prev = null; continue; }
        const y = g.yOf(v), y0: number = prev ?? y;
        if (fill) out.push(<View key={`${key}f${x}`} style={{ position: "absolute", left: PAD_L + x, top: y, width: 2, height: Math.max(0, PAD_T + innerH - y), backgroundColor: fill }} />);
        out.push(<View key={`${key}l${x}`} style={{ position: "absolute", left: PAD_L + x, top: Math.min(y, y0) - 1, width: 2, height: Math.abs(y - y0) + 2, backgroundColor: color }} />);
        prev = y;
      }
    };
    // grid
    for (const f of [0, 0.5, 1]) out.push(<View key={`g${f}`} style={{ position: "absolute", left: PAD_L, width: innerW, top: PAD_T + f * innerH, height: StyleSheet.hairlineWidth, backgroundColor: P.line }} />);
    if (hasVol) {
      const vmax = Math.max(...g.vis.map(p => p.v ?? 0), 1), cols = Math.max(1, Math.floor(innerW / 4));
      for (let k = 0; k < cols; k++) {
        const i0 = a + Math.floor((k / cols) * (b - a + 1)), i1 = Math.min(b, a + Math.floor(((k + 1) / cols) * (b - a + 1)));
        let v = 0; for (let i = i0; i <= Math.max(i0, i1); i++) v += pts[i]?.v ?? 0;
        const hgt = Math.max(1, (v / (vmax * Math.max(1, (i1 - i0 + 1)))) * (VOL_H - 4));
        out.push(<View key={`v${k}`} style={{ position: "absolute", left: PAD_L + (k / cols) * innerW, top: H + VOL_H - hgt, width: Math.max(1, innerW / cols - 1), height: hgt, backgroundColor: "#c7d7f5" }} />);
      }
    }
    if (wantCandles) {
      const m = Math.max(1, Math.min(g.vis.length, Math.floor(innerW / 4)));
      for (let k = 0; k < m; k++) {
        const grp = g.vis.slice(Math.floor((k / m) * g.vis.length), Math.max(Math.floor((k / m) * g.vis.length) + 1, Math.floor(((k + 1) / m) * g.vis.length)));
        if (!grp.length || grp.some(p => p.o == null || p.h == null || p.l == null)) continue;
        const o = grp[0].o as number, c = grp[grp.length - 1].c, hi = Math.max(...grp.map(p => p.h as number)), lo = Math.min(...grp.map(p => p.l as number));
        const cx = PAD_L + ((k + 0.5) / m) * innerW, bw = Math.max(1.5, (innerW / m) * 0.7), col = c >= o ? GREEN : RED;
        out.push(<View key={`w${k}`} style={{ position: "absolute", left: cx - 0.5, top: g.yOf(hi), width: 1, height: Math.max(1, g.yOf(lo) - g.yOf(hi)), backgroundColor: col }} />);
        out.push(<View key={`b${k}`} style={{ position: "absolute", left: cx - bw / 2, top: Math.min(g.yOf(o), g.yOf(c)), width: bw, height: Math.max(1.5, Math.abs(g.yOf(o) - g.yOf(c))), backgroundColor: col }} />);
      }
    } else {
      drawLine("p", valueAt(i => g.valOf(pts[i])), P.blue, cmpAsset ? undefined : "#e2ecff");
      if (g.m20) drawLine("s20", valueAt(i => g.m20![i]), ORANGE);
      if (g.m50) drawLine("s50", valueAt(i => g.m50![i]), PURPLE);
      if (g.cmpFor) drawLine("c", valueAt(i => g.cmpFor!(pts[i].t)), ORANGE);
    }
    // the alert level, dashed
    if (g.level != null && Number.isFinite(g.level)) {
      const inside = g.level >= g.min && g.level <= g.max;
      const y = g.yOf(Math.max(g.min, Math.min(g.max, g.level)));
      for (let x = 0; x < innerW; x += 9) out.push(<View key={`d${x}`} style={{ position: "absolute", left: PAD_L + x, top: y - 0.75, width: 5, height: 1.5, backgroundColor: P.err }} />);
      const lbl = rule!.rule_type.startsWith("pct_") ? `Alert ${fmtPct(g.level)}` : `Alert ${rule!.rule_type === "price_below" ? "↓" : "↑"} ${fmtP(g.level, forex)}${inside ? "" : " (off chart)"}`;
      out.push(<Text key="dl" style={{ position: "absolute", left: PAD_L + 4, top: Math.max(0, y - 16), fontSize: 10, fontWeight: "800", color: P.err, backgroundColor: "#ffffffd0", paddingHorizontal: 3, borderRadius: 3 }}>{lbl}</Text>);
    }
    // axis labels
    const lab = (v: number) => (pct ? fmtPct(v) : fmtP(v, forex));
    [g.max, (g.max + g.min) / 2, g.min].forEach((v, i) => out.push(<Text key={`yl${i}`} style={{ position: "absolute", right: 0, width: PAD_R - 4, textAlign: "right", top: PAD_T + (i / 2) * innerH - 6, fontSize: 9.5, color: P.muted }}>{lab(v)}</Text>));
    out.push(<Text key="x0" style={{ position: "absolute", left: PAD_L, top: H - PAD_B + 4, fontSize: 9.5, color: P.muted }}>{fmtT(pts[a].t, range, intraday)}</Text>);
    out.push(<Text key="x1" style={{ position: "absolute", right: PAD_R, top: H - PAD_B + 4, fontSize: 9.5, color: P.muted }}>{fmtT(pts[b].t, range, intraday)}</Text>);
    return out;
  }, [g, width, innerW, a, b, wantCandles, hasVol, cmpAsset?.symbol, gapLimit, range, intraday, pct, forex, rule?.rule_type, rule?.threshold]);

  // ---- touch: drag to inspect, tap to pin, pinch to zoom, two fingers to pan ----
  const live = useRef({ a, b, n, innerW, width });
  live.current = { a, b, n, innerW, width };
  const overlay = useRef<ComponentRef<typeof View>>(null);
  const pageLeft = useRef(0);
  const pinch = useRef<{ d: number; mid: number; a: number; b: number } | null>(null);
  const moved = useRef(false);
  const idxAt = (x: number) => { const L = live.current; const fi = L.a + ((x - PAD_L) / L.innerW) * (L.b - L.a); return Math.max(L.a, Math.min(L.b, Math.round(fi))); };
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true, onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: e => {
      moved.current = false; onTouching?.(true);
      overlay.current?.measureInWindow(x => { pageLeft.current = x; });
      const t = e.nativeEvent.touches;
      if (t.length >= 2) { const d = Math.abs(t[1].pageX - t[0].pageX) || 1; pinch.current = { d, mid: (t[0].pageX + t[1].pageX) / 2, a: live.current.a, b: live.current.b }; }
      else { pinch.current = null; setCursor(idxAt(e.nativeEvent.locationX)); setPinned(false); }
    },
    onPanResponderMove: e => {
      const t = e.nativeEvent.touches, L = live.current;
      if (t.length >= 2) {
        if (!pinch.current) { pinch.current = { d: Math.abs(t[1].pageX - t[0].pageX) || 1, mid: (t[0].pageX + t[1].pageX) / 2, a: L.a, b: L.b }; return; }
        moved.current = true;
        const p0 = pinch.current, d = Math.abs(t[1].pageX - t[0].pageX) || 1, mid = (t[0].pageX + t[1].pageX) / 2;
        const len0 = p0.b - p0.a, newLen = Math.max(6, Math.min(L.n - 1, len0 * (p0.d / d)));
        const anchor = p0.a + ((p0.mid - pageLeft.current - PAD_L) / L.innerW) * len0;
        let na = anchor - ((mid - pageLeft.current - PAD_L) / L.innerW) * newLen;
        na = Math.max(0, Math.min(L.n - 1 - newLen, na));
        setWin([Math.round(na), Math.round(na + newLen)]); setPinned(true);
      } else if (!pinch.current) { moved.current = true; setCursor(idxAt(e.nativeEvent.locationX)); }
    },
    onPanResponderRelease: () => { onTouching?.(false); pinch.current = null; setPinned(true); },
    onPanResponderTerminate: () => { onTouching?.(false); pinch.current = null; },
  })).current;

  const cur = cursor != null && cursor >= a && cursor <= b ? pts[cursor] : null;
  const first = pts[a], last = pts[b];
  const chg = first && last ? ((last.c / first.c) - 1) * 100 : null;
  const xOfTime = (t: number) => { const fi = g && indexOfTime(pts, t); return fi == null || fi < a || fi > b || !g ? null : g.xOfFi(fi); };
  const zoomed = !!win && (a > 0 || b < n - 1);
  const levelHint = rule?.rule_type.startsWith("pct_") && view === "price" ? "24-hour change rules are drawn in the 24h change view." : "";

  const openSheet = (price: number) => {
    const ref = lastPrice ?? last?.c ?? price;
    setDir(price <= ref ? "price_below" : "price_above"); setThr(String(Number(price.toPrecision(forex ? 6 : 7)))); setRec("once"); setSheet({ price }); setNote("");
  };
  async function activate() {
    const t = Number(thr);
    if (!onCreateAlert || !(t > 0)) { setNote("Enter a price above zero."); return; }
    setBusy(true); setNote("");
    try { await onCreateAlert({ ruleType: dir, threshold: t, recurrence: rec }); setSheet(null); setNote("Monitor activated. Find it under More › Monitors."); }
    catch (e) { setNote((e as Error).message || "Couldn't create the monitor."); }
    finally { setBusy(false); }
  }
  const chip = (on: boolean, off = false) => ({ borderColor: on ? P.blue : P.line, backgroundColor: on ? P.blueDim : "#f6f9ff", opacity: off ? 0.4 : 1 });
  const chipText = (on: boolean) => ({ color: on ? P.blue : P.muted, fontSize: 11.5, fontWeight: "800" as const });
  const selAlert = alerts.find(x => x.id === markerId);

  return (
    <View style={{ gap: 8 }}>
      {onAssetChange ? <AssetPicker palette={P} value={asset} onChange={onAssetChange} label="Chart asset" onlyWithHistory /> : null}
      <View style={s.between}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: P.ink, fontSize: 16, fontWeight: "800" }}>{asset.symbol}{cmpAsset ? <Text style={{ color: ORANGE }}> vs {cmpAsset.symbol}</Text> : null}</Text>
          <Text style={{ color: P.muted, fontSize: 11 }}>{data ? `${data.currency} · ${data.source}` : "Delayed quotes"}</Text>
        </View>
        {last ? <View style={{ alignItems: "flex-end" }}>
          <Text style={{ color: P.ink, fontSize: 16, fontWeight: "800" }}>{pct ? fmtPct(g?.valOf(last) ?? 0) : fmtP(last.c, forex)}</Text>
          {chg != null ? <Text style={{ color: chg >= 0 ? GREEN : RED, fontSize: 11.5, fontWeight: "800" }}>{chg >= 0 ? "▲" : "▼"} {Math.abs(chg).toFixed(2)}% in view</Text> : null}
        </View> : null}
      </View>

      <View style={[s.between, { alignItems: "flex-start", zIndex: 30 }]}>
        <View style={{ flex: 1 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Range: ${range}. Tap to change`} onPress={() => setDrop(drop === "range" ? null : "range")} style={[s.drop, { borderColor: drop === "range" ? P.blue : P.line }]}>
            <Text style={{ color: P.muted, fontSize: 10.5 }}>Range</Text>
            <Text style={{ color: P.ink, fontSize: 13.5, fontWeight: "800", flex: 1 }}>{range}</Text>
            <Text style={{ color: P.muted }}>⌄</Text>
          </Pressable>
          {drop === "range" ? (
            <View style={[s.dropMenu, { borderColor: P.line, backgroundColor: P.card }]}>
              {RANGES.map(r => { const off = forex && r === "1D"; return (
                <Pressable key={r} accessibilityRole="button" accessibilityState={{ selected: range === r, disabled: off }} onPress={() => { if (!off) { setRange(r); setDrop(null); } }} style={{ paddingVertical: 11, paddingHorizontal: 12, opacity: off ? 0.4 : 1 }}>
                  <Text style={{ color: range === r ? P.blue : P.ink, fontSize: 13.5, fontWeight: range === r ? "800" : "600" }}>{r}{off ? "  (daily data only)" : ""}</Text>
                </Pressable>
              ); })}
            </View>
          ) : null}
        </View>
        <View style={{ flex: 1 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Chart type: ${candles ? "Candles" : "Line"}. Tap to change`} onPress={() => setDrop(drop === "type" ? null : "type")} style={[s.drop, { borderColor: drop === "type" ? P.blue : P.line }]}>
            <Text style={{ color: P.muted, fontSize: 10.5 }}>Type</Text>
            <Text style={{ color: P.ink, fontSize: 13.5, fontWeight: "800", flex: 1 }}>{candles ? "Candles" : "Line"}</Text>
            <Text style={{ color: P.muted }}>⌄</Text>
          </Pressable>
          {drop === "type" ? (
            <View style={[s.dropMenu, { borderColor: P.line, backgroundColor: P.card }]}>
              <Pressable accessibilityRole="button" onPress={() => { setCandles(false); setDrop(null); }} style={{ paddingVertical: 11, paddingHorizontal: 12 }}>
                <Text style={{ color: !candles ? P.blue : P.ink, fontSize: 13.5, fontWeight: !candles ? "800" : "600" }}>Line</Text>
              </Pressable>
              {(() => { const off = view !== "price" || !!cmpAsset; return (
                <Pressable accessibilityRole="button" accessibilityState={{ disabled: off }} onPress={() => { if (!off) { setCandles(true); setDrop(null); } }} style={{ paddingVertical: 11, paddingHorizontal: 12, opacity: off ? 0.4 : 1 }}>
                  <Text style={{ color: candles ? P.blue : P.ink, fontSize: 13.5, fontWeight: candles ? "800" : "600" }}>Candles{off ? "  (price view only)" : ""}</Text>
                </Pressable>
              ); })()}
            </View>
          ) : null}
        </View>
      </View>
      <View style={s.wrap}>
        {rule?.rule_type.startsWith("pct_") || range === "1D" ? (
          <>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: view === "price" }} onPress={() => setView("price")} style={[s.pill, chip(view === "price")]}><Text style={chipText(view === "price")}>Price</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: view === "change" }} onPress={() => { setView("change"); setCandles(false); }} style={[s.pill, chip(view === "change")]}><Text style={chipText(view === "change")}>{range === "1D" ? "24h change" : "% change"}</Text></Pressable>
          </>
        ) : null}
        <Pressable accessibilityRole="button" onPress={() => setMenu(m => !m)} style={[s.pill, chip(menu || vol || s20 || s50 || !!cmpAsset)]}><Text style={chipText(menu || vol || s20 || s50 || !!cmpAsset)}>Indicators ⌄</Text></Pressable>
        {zoomed ? <Pressable accessibilityRole="button" onPress={() => { setWin(null); setCursor(null); setPinned(false); }} style={[s.pill, chip(false)]}><Text style={chipText(false)}>Reset zoom</Text></Pressable> : null}
      </View>
      {menu ? (
        <View style={[s.menu, { borderColor: P.line, backgroundColor: P.card }]}>
          <View style={s.wrap}>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: vol, disabled: !data?.hasVolume }} onPress={() => { if (data?.hasVolume) setVol(v => !v); }} style={[s.pill, chip(vol, !data?.hasVolume)]}><Text style={chipText(vol)}>Volume{data && !data.hasVolume ? " (not provided)" : ""}</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: s20 }} onPress={() => setS20(v => !v)} style={[s.pill, chip(s20)]}><Text style={chipText(s20)}>SMA 20</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: s50 }} onPress={() => setS50(v => !v)} style={[s.pill, chip(s50)]}><Text style={chipText(s50)}>SMA 50</Text></Pressable>
          </View>
          <AssetPicker palette={P} value={cmpAsset} onChange={setCmpAsset} label="Compare with (% change from the same start)" onlyWithHistory />
          {cmpAsset ? <Pressable accessibilityRole="button" onPress={() => setCmpAsset(null)}><Text style={{ color: P.blue, fontSize: 12, fontWeight: "800" }}>Remove comparison</Text></Pressable> : null}
        </View>
      ) : null}

      <View onLayout={e => setWidth(e.nativeEvent.layout.width)} style={{ height: H + (hasVol ? VOL_H : 0), backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: P.line, overflow: "hidden" }}>
        {loading ? <View style={s.center}><ActivityIndicator color={P.blue} /><Text style={{ color: P.muted, fontSize: 12, marginTop: 6 }}>Loading history…</Text></View>
          : error ? <View style={s.center}><Text style={{ color: P.muted, fontSize: 12.5, textAlign: "center", paddingHorizontal: 16 }}>{error}</Text></View>
          : !g ? <View style={s.center}><Text style={{ color: P.muted, fontSize: 12.5 }}>Not enough data to draw a chart.</Text></View>
          : <>
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>{plot}</View>
            {cur && g ? (() => { const x = g.xOfFi(cursor as number); const v = g.valOf(cur); const y = g.yOf(wantCandles ? cur.c : v); return (
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <View style={{ position: "absolute", left: x - 0.5, top: PAD_T, width: 1, height: innerH, backgroundColor: P.muted, opacity: 0.6 }} />
                <View style={{ position: "absolute", left: x - 4.5, top: y - 4.5, width: 9, height: 9, borderRadius: 4.5, backgroundColor: P.blue, borderWidth: 2, borderColor: "#fff" }} />
              </View>); })() : null}
            <View ref={overlay} onLayout={() => overlay.current?.measureInWindow(x => { pageLeft.current = x; })} style={StyleSheet.absoluteFill} {...responder.panHandlers} />
            {!pct ? alerts.map(al => { const t = Date.parse(al.created_at); const xx = xOfTime(t); const p = Number(al.observed_price); if (xx == null || !g || !Number.isFinite(p)) return null; const yy = g.yOf(Math.max(g.min, Math.min(g.max, p))); return (
              <Pressable key={al.id} accessibilityRole="button" accessibilityLabel="Alert that fired. Tap for the quote behind it" hitSlop={10} onPress={() => setMarkerId(markerId === al.id ? null : al.id)} style={{ position: "absolute", left: xx - 7, top: yy - 7, width: 14, height: 14, borderRadius: 7, backgroundColor: P.err, borderWidth: 2, borderColor: "#fff" }} />
            ); }) : null}
          </>}
      </View>

      {cur ? (
        <View style={[s.tip, { borderColor: P.line, backgroundColor: P.card }]}>
          <Text style={{ color: P.muted, fontSize: 11 }}>{fmtT(cur.t, range, intraday)}</Text>
          {wantCandles && cur.o != null ? <Text style={{ color: P.ink, fontSize: 12.5, fontWeight: "700" }}>O {fmtP(cur.o, forex)}  H {fmtP(cur.h as number, forex)}  L {fmtP(cur.l as number, forex)}  C {fmtP(cur.c, forex)}</Text>
            : <Text style={{ color: P.ink, fontSize: 13, fontWeight: "800" }}>{pct ? fmtPct(g?.valOf(cur) ?? 0) : fmtP(cur.c, forex)}{pct ? `   (${fmtP(cur.c, forex)})` : ""}</Text>}
          {onCreateAlert && pinned && !sheet ? <Pressable accessibilityRole="button" onPress={() => openSheet(cur.c)} style={[s.setBtn, { backgroundColor: P.blue }]}><Text style={{ color: "#fff", fontSize: 12.5, fontWeight: "800" }}>Set alert at {fmtP(cur.c, forex)}</Text></Pressable> : null}
        </View>
      ) : !loading && !error && g ? <Text style={{ color: P.muted, fontSize: 11 }}>Touch and drag to inspect a price. Pinch to zoom, two fingers to pan.{onCreateAlert ? " Tap a point, then “Set alert”." : ""}</Text> : null}
      {levelHint ? <Text style={{ color: P.muted, fontSize: 11 }}>{levelHint}</Text> : null}

      {selAlert ? (
        <View style={[s.tip, { borderColor: P.err, backgroundColor: P.errBg }]}>
          <Text style={{ color: P.err, fontSize: 12, fontWeight: "800" }}>Alert fired {new Date(selAlert.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</Text>
          <Text style={{ color: P.ink, fontSize: 12.5 }}>Triggering quote {fmtP(Number(selAlert.observed_price), forex)} · {selAlert.source}</Text>
          <Text style={{ color: P.muted, fontSize: 11 }}>Quote as of {selAlert.quote_as_of ? new Date(selAlert.quote_as_of).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "not provided by the source"} · detected {new Date(selAlert.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text>
        </View>
      ) : null}

      {sheet ? (
        <View style={[s.tip, { borderColor: P.blue, backgroundColor: "#f4f8ff", gap: 8 }]}>
          <Text style={{ color: P.ink, fontSize: 14, fontWeight: "800" }}>Set alert from chart</Text>
          <View style={s.wrap}>
            {([["price_below", "Crosses below"], ["price_above", "Crosses above"]] as ["price_below" | "price_above", string][]).map(([id, label]) => (
              <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: dir === id }} onPress={() => setDir(id)} style={[s.pill, chip(dir === id)]}><Text style={chipText(dir === id)}>{label}</Text></Pressable>
            ))}
          </View>
          <View style={[s.suffix, { borderColor: P.line }]}><TextInput accessibilityLabel="Alert price" value={thr} onChangeText={setThr} keyboardType="decimal-pad" maxLength={14} selectionColor={P.blue} style={{ flex: 1, color: P.ink, fontSize: 14, fontWeight: "700", paddingVertical: 8 }} /><Text style={{ color: P.muted, fontSize: 12, fontWeight: "700" }}>{forex ? "" : "USD"}</Text></View>
          <View style={s.wrap}>
            {([["once", "Once"], ["each_crossing", "Each crossing"]] as ["once" | "each_crossing", string][]).map(([id, label]) => (
              <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: rec === id }} onPress={() => setRec(id)} style={[s.pill, chip(rec === id)]}><Text style={chipText(rec === id)}>{label}</Text></Pressable>
            ))}
          </View>
          <Text style={{ color: P.muted, fontSize: 11.5, lineHeight: 16 }}>Review: alert when {asset.symbol} {dir === "price_below" ? "crosses below" : "crosses above"} {thr || "…"}{forex ? "" : " USD"}, {rec === "once" ? "once, then wait to be re-armed" : "every time it crosses"}. Prices are delayed and informational; nothing is traded.</Text>
          {note ? <Text style={{ color: P.err, fontSize: 12 }}>{note}</Text> : null}
          <View style={s.wrap}>
            <Pressable accessibilityRole="button" onPress={() => setSheet(null)} style={[s.btn, { borderColor: P.line, flex: 1 }]}><Text style={{ color: P.ink, fontSize: 12.5, fontWeight: "700" }}>Cancel</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void activate()} style={[s.btn, { backgroundColor: P.blue, borderColor: P.blue, flex: 1.3, opacity: busy ? 0.6 : 1 }]}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontSize: 12.5, fontWeight: "800" }}>Activate monitor</Text>}</Pressable>
          </View>
        </View>
      ) : note ? <Text style={{ color: P.blue, fontSize: 12, fontWeight: "700" }}>{note}</Text> : null}

      {data ? <Text style={{ color: P.muted, fontSize: 10.5, lineHeight: 15 }}>Source {data.source} · as of {data.asOf ? fmtT(data.asOf, "1W", true) : "—"}. {data.notice}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  wrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  drop: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, height: 42, backgroundColor: "#fff" },
  dropMenu: { position: "absolute", top: 46, left: 0, right: 0, borderWidth: 1, borderRadius: 10, elevation: 8, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, zIndex: 40 },
  pill: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 11, height: 28, justifyContent: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  menu: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 8 },
  tip: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 3 },
  setBtn: { height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 4 },
  suffix: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, height: 40, backgroundColor: "#fff" },
  btn: { borderWidth: 1.5, borderRadius: 10, height: 38, alignItems: "center", justifyContent: "center" },
});
