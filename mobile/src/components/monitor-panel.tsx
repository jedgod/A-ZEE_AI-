import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text as RNText, TextInput as RNTextInput, View } from "react-native";
import type { ComponentProps } from "react";
import { StatusBar } from "expo-status-bar";
import { api, ApiError } from "@/lib/api";
import { AssetPicker } from "./asset-picker";
import { PriceChart, type NewAlert } from "./price-chart";
import { Sparkline } from "./sparkline";
import { fetchSparklines, type Sparkline as SparkData } from "@/lib/finance-data";

const Text = (props: ComponentProps<typeof RNText>) => <RNText maxFontSizeMultiplier={1.05} {...props} />;
const TextInput = (props: ComponentProps<typeof RNTextInput>) => <RNTextInput maxFontSizeMultiplier={1.05} {...props} />;

export type MonitorPalette = Record<"ink" | "muted" | "blue" | "blueDim" | "line" | "card" | "warn" | "warnBg" | "err" | "errBg", string>;
type RuleType = "pct_drop_24h" | "pct_rise_24h" | "price_below" | "price_above";
type RuleClass = "crypto" | "stocks_etfs" | "forex" | "commodities";
type Recurrence = "once" | "each_crossing";
type Rule = {
  id: string; symbol: string; asset_class: RuleClass; rule_type: RuleType; threshold: string; recurrence: Recurrence;
  status: "active" | "triggered" | "paused" | "stale_feed";
  last_checked_at: string | null; last_price: string | null; last_source: string | null; last_quote_as_of: string | null;
  stale_reason: string | null; triggered_at: string | null;
};
type AlertRow = {
  id: string; rule_id: string; symbol: string; message: string; observed_price: string; source: string; created_at: string;
  rule_type: RuleType | null; threshold: string | null; recurrence: Recurrence | null; quote_as_of: string | null; change_pct: string | null;
};
export type MonitorSeed = { symbol: string; cls: "stocks" | "etfs" | "crypto" | "forex" | "commodities" };

const CLASSES: { id: RuleClass; label: string }[] = [{ id: "crypto", label: "Crypto" }, { id: "stocks_etfs", label: "Stocks/ETFs" }, { id: "forex", label: "Forex" }, { id: "commodities", label: "Commodities" }];
const TYPES: { id: RuleType; label: string }[] = [{ id: "price_below", label: "Crosses below" }, { id: "price_above", label: "Crosses above" }, { id: "pct_drop_24h", label: "Drops by (24h)" }, { id: "pct_rise_24h", label: "Rises by (24h)" }];
const classFor = (c: MonitorSeed["cls"]): RuleClass => (c === "stocks" || c === "etfs" ? "stocks_etfs" : c);
const percentOk = (c: RuleClass) => c === "crypto" || c === "stocks_etfs";
const unit = (t: RuleType, c: RuleClass) => (t.startsWith("pct_") ? "%" : c === "forex" ? "" : "USD");
const num = (x: string | number) => Number(x).toLocaleString("en-US", { maximumFractionDigits: 6 });
const ruleLine = (r: { rule_type: RuleType; threshold: string; recurrence?: Recurrence | null }, c: RuleClass) => {
  const t = r.rule_type;
  const base = t === "price_below" ? "Crosses below" : t === "price_above" ? "Crosses above" : t === "pct_drop_24h" ? "Drops by" : "Rises by";
  const u = unit(t, c);
  return `${base} ${num(r.threshold)}${u === "%" ? "%" : u ? ` ${u}` : ""}${t.startsWith("pct_") ? " in 24h" : ""}${r.recurrence === "each_crossing" ? " · each crossing" : " · once"}`;
};
const MESSAGES: Record<string, string> = {
  RULE_LIMIT_REACHED: "You can have up to 15 monitors. Delete one to add another.",
  PERCENT_NOT_SUPPORTED: "Percent rules need crypto or stocks. Use a price rule for forex and commodities.",
  INVALID_SYMBOL: "That symbol isn't valid.", INVALID_THRESHOLD: "Enter a number above zero (percent rules: up to 100).", INVALID_REQUEST: "Check the symbol and number.", RATE_LIMITED: "Too many requests. Wait a moment.",
};
const explain = (e: unknown) => MESSAGES[(e as ApiError)?.code ?? ""] ?? ((e as Error)?.message || "Something went wrong.");
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const when = (iso: string | null | undefined, empty = "—") => {
  if (!iso) return empty;
  const d = new Date(iso);
  const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return sameDay(d, new Date()) ? t : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${t}`;
};

/** "Monitor this for me": set a price or 24-hour-move rule; the server checks it on a schedule and alerts you in Notifications. */
export function MonitorPanel({ palette: P, seed, watchSymbols, onCount }: { palette: MonitorPalette; seed?: MonitorSeed | null; watchSymbols: MonitorSeed[]; onCount?: (n: number) => void }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [symbol, setSymbol] = useState(seed?.symbol ?? "BTC-USD");
  const [cls, setCls] = useState<RuleClass>(seed ? classFor(seed.cls) : "crypto");
  const [type, setType] = useState<RuleType>("price_below");
  const [threshold, setThreshold] = useState("");
  const [recurrence, setRecurrence] = useState<Recurrence>("once");
  const [menu, setMenu] = useState<"create" | string | null>(null);   // which condition dropdown is open: "create" or a rule id
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ type: RuleType; threshold: string; recurrence: Recurrence }>({ type: "price_below", threshold: "", recurrence: "once" });
  const [activityId, setActivityId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [explainId, setExplainId] = useState<string | null>(null);
  const [spark, setSpark] = useState<Record<string, SparkData>>({});
  const [chartRule, setChartRule] = useState<Rule | null>(null);
  const [touching, setTouching] = useState(false);

  const activeCount = (list: Rule[]) => list.filter(x => x.status === "active" || x.status === "stale_feed").length;
  const load = useCallback(async () => {
    try { const r = await api<{ rules: Rule[]; alerts: AlertRow[] }>("/api/finance/monitor"); setRules(r.rules); setAlerts(r.alerts); onCount?.(activeCount(r.rules)); }
    catch (e) { setError(explain(e)); }
    finally { setLoading(false); }
  }, [onCount]);
  useEffect(() => { void load(); }, [load]);
  const sparkKey = rules.map(r => `${r.asset_class}:${r.symbol}`).filter((v, i, all) => all.indexOf(v) === i).sort().join(",");
  useEffect(() => {
    if (!sparkKey) return;
    let alive = true;
    const items = sparkKey.split(",").map(k => { const [assetClass, ...sym] = k.split(":"); return { assetClass: assetClass as RuleClass, symbol: sym.join(":") }; });
    fetchSparklines(items).then(r => { if (alive) setSpark(Object.fromEntries(r.results.map(x => [`${x.assetClass}:${x.symbol}`, x]))); }).catch(() => undefined);
    return () => { alive = false; };
  }, [sparkKey]);

  async function createFromChart(r: NewAlert) {
    if (!chartRule) return;
    const out = await api<{ rule: Rule }>("/api/finance/monitor", { method: "POST", body: { symbol: chartRule.symbol, assetClass: chartRule.asset_class, ruleType: r.ruleType, threshold: r.threshold, recurrence: r.recurrence } }).catch(e => { throw new Error(explain(e)); });
    setRules(prev => { const next = [out.rule, ...prev]; onCount?.(activeCount(next)); return next; });
  }

  const pctBlocked = type.startsWith("pct_") && !percentOk(cls);
  const canSave = !saving && !!symbol.trim() && Number(threshold) > 0 && !pctBlocked;

  async function create() {
    if (!canSave) return;
    setSaving(true); setError("");
    try {
      const out = await api<{ rule: Rule }>("/api/finance/monitor", { method: "POST", body: { symbol: symbol.trim().toUpperCase(), assetClass: cls, ruleType: type, threshold: Number(threshold), recurrence } });
      setRules(prev => { const next = [out.rule, ...prev]; onCount?.(activeCount(next)); return next; });
      setThreshold("");
    } catch (e) { setError(explain(e)); }
    finally { setSaving(false); }
  }
  async function toggle(r: Rule) {
    const next = r.status === "paused" || r.status === "triggered" ? "active" : "paused";
    try { const out = await api<{ rule: Rule }>(`/api/finance/monitor/${r.id}`, { method: "PATCH", body: { status: next } }); setRules(prev => prev.map(x => (x.id === r.id ? out.rule : x))); void load(); }
    catch (e) { setError(explain(e)); }
  }
  async function saveEdit(r: Rule) {
    if (!(Number(edit.threshold) > 0)) { setError(MESSAGES.INVALID_THRESHOLD); return; }
    setError("");
    try {
      const out = await api<{ rule: Rule }>(`/api/finance/monitor/${r.id}`, { method: "PATCH", body: { ruleType: edit.type, threshold: Number(edit.threshold), recurrence: edit.recurrence } });
      setRules(prev => { const next = prev.map(x => (x.id === r.id ? out.rule : x)); onCount?.(activeCount(next)); return next; });
      setEditId(null); setMenu(null);
    } catch (e) { setError(explain(e)); }
  }
  function remove(r: Rule) {
    Alert.alert(`Delete the ${r.symbol} monitor?`, "It stops checking and any alert history for it is removed.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => { api(`/api/finance/monitor/${r.id}`, { method: "DELETE" }).then(() => { setRules(prev => { const next = prev.filter(x => x.id !== r.id); onCount?.(activeCount(next)); return next; }); }).catch(e => setError(explain(e))); } },
    ]);
  }

  const tone = (st: Rule["status"]) => st === "active" ? { c: "#166534", bg: "#dcfce7", t: "Active" } : st === "triggered" ? { c: P.err, bg: P.errBg, t: "Triggered" } : st === "stale_feed" ? { c: P.warn, bg: P.warnBg, t: "Stale feed" } : { c: P.muted, bg: "#e3e8f2", t: "Paused" };
  const card = { backgroundColor: P.card, borderColor: P.line };

  const Select = ({ value, open, onToggle, onPick, allowPct }: { value: RuleType; open: boolean; onToggle: () => void; onPick: (t: RuleType) => void; allowPct: boolean }) => (
    <View style={{ flex: 1.15 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Condition" onPress={onToggle} style={[s.select, { borderColor: P.blue, backgroundColor: P.blueDim }]}>
        <Text style={{ color: P.blue, fontSize: 13, fontWeight: "700", flex: 1 }} numberOfLines={1}>{TYPES.find(t => t.id === value)?.label}</Text>
        <Text style={{ color: P.blue }}>⌄</Text>
      </Pressable>
      {open ? <View style={[s.menu, { borderColor: P.line, backgroundColor: P.card }]}>
        {TYPES.map(t => {
          const off = t.id.startsWith("pct_") && !allowPct;
          return <Pressable key={t.id} accessibilityRole="button" accessibilityState={{ disabled: off }} onPress={() => { if (!off) onPick(t.id); }} style={{ paddingVertical: 10, paddingHorizontal: 12, opacity: off ? 0.4 : 1 }}>
            <Text style={{ color: t.id === value ? P.blue : P.ink, fontSize: 13, fontWeight: t.id === value ? "800" : "600" }}>{t.label}{off ? "  (crypto and stocks only)" : ""}</Text>
          </Pressable>;
        })}
      </View> : null}
    </View>
  );
  const Segment = ({ value, onPick }: { value: Recurrence; onPick: (r: Recurrence) => void }) => (
    <View style={[s.segment, { borderColor: P.blue }]}>
      {([["once", "Once"], ["each_crossing", "Each crossing"]] as [Recurrence, string][]).map(([id, label]) => (
        <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: value === id }} onPress={() => onPick(id)} style={[s.segItem, { backgroundColor: value === id ? P.blue : "#fff" }]}>
          <Text style={{ color: value === id ? "#fff" : P.muted, fontSize: 12.5, fontWeight: "800" }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
  const recurrenceHelp = (r: Recurrence) => r === "once" ? "Alerts one time, then waits until you re-arm it." : "Alerts every time the price crosses your level. The first check only sets the starting side.";

  const explainAlert = (a: AlertRow) => {
    const cl = rules.find(r => r.id === a.rule_id)?.asset_class ?? "crypto";
    return (
      <View style={[s.explain, { borderColor: P.line }]}>
        <Text style={[s.k, { color: P.muted }]}>What happened</Text><Text style={{ color: P.ink, fontSize: 12.5, lineHeight: 18 }}>{a.message}</Text>
        {a.rule_type ? <><Text style={[s.k, { color: P.muted }]}>Your rule then</Text><Text style={{ color: P.ink, fontSize: 12.5 }}>{ruleLine({ rule_type: a.rule_type, threshold: a.threshold ?? "0", recurrence: a.recurrence }, cl)}</Text></> : null}
        <Text style={[s.k, { color: P.muted }]}>Quote used</Text><Text style={{ color: P.ink, fontSize: 12.5 }}>{num(a.observed_price)}{a.change_pct != null ? `  ·  24h change ${Number(a.change_pct) >= 0 ? "+" : ""}${Number(a.change_pct).toFixed(2)}%` : ""}</Text>
        <Text style={[s.k, { color: P.muted }]}>Quote as of</Text><Text style={{ color: P.ink, fontSize: 12.5 }}>{a.quote_as_of ? when(a.quote_as_of) : "Not provided by the source"}</Text>
        <Text style={[s.k, { color: P.muted }]}>Source</Text><Text style={{ color: P.ink, fontSize: 12.5 }}>{a.source}</Text>
        <Text style={[s.k, { color: P.muted }]}>Alert sent</Text><Text style={{ color: P.ink, fontSize: 12.5 }}>{when(a.created_at)}</Text>
        <Text style={{ color: P.muted, fontSize: 11 }}>Delayed, informational quote from a free public source. Not advice, and nothing is traded.</Text>
      </View>
    );
  };
  const alertList = (list: AlertRow[]) => list.length ? list.slice(0, 10).map(a => (
    <View key={a.id}>
      <Pressable accessibilityRole="button" onPress={() => setExplainId(explainId === a.id ? null : a.id)} style={s.alertRow}>
        <View style={{ flex: 1 }}><Text style={{ color: P.muted, fontSize: 11 }}>{when(a.created_at)} · {a.symbol}</Text><Text style={{ color: P.ink, fontSize: 12.5, lineHeight: 17 }} numberOfLines={explainId === a.id ? 0 : 2}>{a.message}</Text></View>
        <Text style={{ color: P.blue, fontSize: 12, fontWeight: "800" }}>{explainId === a.id ? "Hide" : "Explain"}</Text>
      </Pressable>
      {explainId === a.id ? explainAlert(a) : null}
    </View>
  )) : <Text style={[s.muted, { color: P.muted }]}>No alerts yet.</Text>;

  const Row = ({ k, v }: { k: string; v: string }) => <View style={s.kv}><Text style={{ color: P.muted, fontSize: 12.5 }}>{k}</Text><Text style={{ color: P.ink, fontSize: 12.5, fontWeight: "700", flexShrink: 1, textAlign: "right" }}>{v}</Text></View>;

  return (
    <View style={{ gap: 10 }}>
      <View style={[s.card, card]}>
        <View style={s.between}><Text style={[s.h2, { color: P.ink }]}>Monitor this for me</Text><Text style={[s.tag, { color: P.warn, backgroundColor: P.warnBg }]}>Delayed quotes</Text></View>
        <AssetPicker palette={P} value={{ symbol, assetClass: cls }} onChange={x => { setSymbol(x.symbol); setCls(x.assetClass); if (type.startsWith("pct_") && !percentOk(x.assetClass)) setType("price_below"); }} />
        <View style={[s.between, { alignItems: "flex-start", gap: 8, zIndex: 5 }]}>
          <Select value={type} open={menu === "create"} onToggle={() => setMenu(menu === "create" ? null : "create")} onPick={t => { setType(t); setMenu(null); }} allowPct={percentOk(cls)} />
          <View style={[s.suffixBox, { borderColor: P.line, flex: 1 }]}>
            <TextInput accessibilityLabel="Threshold" value={threshold} onChangeText={setThreshold} keyboardType="decimal-pad" maxLength={14} placeholder={type.startsWith("pct_") ? "3" : "60000"} placeholderTextColor={P.muted} selectionColor={P.blue} style={{ flex: 1, color: P.ink, fontSize: 13, fontWeight: "600", paddingVertical: 8 }} />
            <Text style={{ color: P.muted, fontSize: 12, fontWeight: "700" }}>{unit(type, cls)}</Text>
          </View>
        </View>

        <Text style={[s.label, { color: P.ink }]}>Recurrence</Text>
        <Segment value={recurrence} onPick={setRecurrence} />
        <Text style={[s.muted, { color: P.muted }]}>{recurrenceHelp(recurrence)}</Text>
        {pctBlocked ? <Text style={[s.muted, { color: P.warn }]}>Forex and commodities don't report a 24-hour change. Use a price rule.</Text> : null}
        {error ? <Text accessibilityRole="alert" style={{ color: P.err, fontSize: 12 }}>{error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={!canSave} onPress={() => void create()} style={[s.cta, { backgroundColor: P.blue, opacity: canSave ? 1 : 0.4 }]}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.ctaText}>Activate monitor</Text>}
        </Pressable>
      </View>

      <View style={s.between}><Text style={[s.h2, { color: P.ink }]}>Your monitors</Text><Text style={{ color: P.muted, fontSize: 13, fontWeight: "700" }}>{rules.length} / 15</Text></View>
      {loading ? <ActivityIndicator color={P.blue} /> : rules.length === 0 ? (
        <View style={[s.card, card]}><Text style={[s.muted, { color: P.muted }]}>No monitors yet. Add one above.</Text></View>
      ) : rules.map(r => {
        const t = tone(r.status);
        const editing = editId === r.id;
        return (
          <View key={r.id} style={[s.card, card, { zIndex: editing ? 5 : 0 }]}>
            <View style={s.between}>
              <Text style={[s.sym, { color: P.ink }]}>{r.symbol}</Text>
              <View style={s.wrap}>
                <Text style={[s.badge, { color: t.c, backgroundColor: t.bg }]}>{t.t}</Text>
                <Text style={[s.badge, { color: P.warn, backgroundColor: P.warnBg }]}>Delayed quotes</Text>
              </View>
            </View>
            <Text style={{ color: P.muted, fontSize: 12.5 }}>{ruleLine(r, r.asset_class)}</Text>
            {!editing ? (() => {
              const sp = spark[`${r.asset_class}:${r.symbol}`];
              return (
                <Pressable accessibilityRole="button" accessibilityLabel={`Open the ${r.symbol} chart`} onPress={() => setChartRule(r)} style={{ gap: 3 }}>
                  <View style={s.between}>
                    <Text style={{ color: P.ink, fontSize: 12.5, fontWeight: "800" }}>{sp?.range === "1W" ? "7-day price trend" : "24h price trend"} <Text style={{ color: P.muted, fontWeight: "600" }}>· delayed</Text></Text>
                    <Text style={{ color: P.blue, fontSize: 12, fontWeight: "800" }}>Open chart ›</Text>
                  </View>
                  {sp && sp.points.length > 1 ? (
                    <View>
                      <Sparkline points={sp.points} height={38} color={sp.changePct != null && sp.changePct < 0 ? "#dc2626" : P.blue} fill={sp.changePct != null && sp.changePct < 0 ? "#fde8e8" : "#e2ecff"} />
                      {sp.changePct != null ? <Text style={{ color: sp.changePct >= 0 ? "#16a34a" : "#dc2626", fontSize: 11, fontWeight: "800" }}>{sp.changePct >= 0 ? "▲ +" : "▼ "}{Math.abs(sp.changePct).toFixed(2)}%</Text> : null}
                    </View>
                  ) : <Text style={{ color: P.muted, fontSize: 11.5 }}>{sp ? (sp.error === "PROVIDER_NOT_CONFIGURED" ? "No history source is set up for this asset yet." : "Trend unavailable right now.") : "Loading trend…"}</Text>}
                </Pressable>
              );
            })() : null}

            {editing ? (
              <View style={{ gap: 8, zIndex: 5 }}>
                <View style={[s.between, { alignItems: "flex-start", gap: 8 }]}>
                  <Select value={edit.type} open={menu === r.id} onToggle={() => setMenu(menu === r.id ? null : r.id)} onPick={tp => { setEdit({ ...edit, type: tp }); setMenu(null); }} allowPct={percentOk(r.asset_class)} />
                  <View style={[s.suffixBox, { borderColor: P.line, flex: 1 }]}>
                    <TextInput accessibilityLabel="New threshold" value={edit.threshold} onChangeText={v => setEdit({ ...edit, threshold: v })} keyboardType="decimal-pad" maxLength={14} selectionColor={P.blue} style={{ flex: 1, color: P.ink, fontSize: 13, fontWeight: "600", paddingVertical: 8 }} />
                    <Text style={{ color: P.muted, fontSize: 12, fontWeight: "700" }}>{unit(edit.type, r.asset_class)}</Text>
                  </View>
                </View>
                <Segment value={edit.recurrence} onPick={rc => setEdit({ ...edit, recurrence: rc })} />
                <Text style={[s.muted, { color: P.muted }]}>Saving re-arms this monitor from scratch.</Text>
                <View style={s.between}>
                  <Pressable accessibilityRole="button" onPress={() => { setEditId(null); setMenu(null); }} style={[s.btn, { borderColor: P.line, flex: 1 }]}><Text style={{ color: P.ink, fontSize: 12.5, fontWeight: "700" }}>Cancel</Text></Pressable>
                  <Pressable accessibilityRole="button" onPress={() => void saveEdit(r)} style={[s.btn, { backgroundColor: P.blue, borderColor: P.blue, flex: 1 }]}><Text style={{ color: "#fff", fontSize: 12.5, fontWeight: "800" }}>Save</Text></Pressable>
                </View>
              </View>
            ) : (
              <>
                <View style={[s.rule, { borderColor: P.line }]} />
                <Row k="Last successful check" v={r.last_checked_at ? when(r.last_checked_at) : "Waiting for the first check"} />
                <Row k="Quote as of" v={r.last_quote_as_of ? when(r.last_quote_as_of) : r.last_checked_at ? "Not provided by source" : "—"} />
                <Row k="Last price" v={r.last_price ? num(r.last_price) : "—"} />
                <Row k="Source" v={r.last_source ?? "—"} />
                <View style={s.rowWrap}><Text style={{ fontSize: 14 }}>🔔</Text><Text style={{ color: P.muted, fontSize: 12.5 }}>In-app alerts</Text></View>
                {r.status === "stale_feed" && r.stale_reason ? <Text style={{ color: P.warn, fontSize: 11.5 }}>⚠ {r.stale_reason}. It rechecks automatically.</Text> : null}
                {r.status === "triggered" && r.triggered_at ? <Text style={{ color: P.err, fontSize: 11.5 }}>Triggered {when(r.triggered_at)}. Re-arm to watch again.</Text> : null}
                <View style={s.between}>
                  <Pressable accessibilityRole="button" onPress={() => setActivityId(activityId === r.id ? null : r.id)} style={[s.btn, { borderColor: P.line, flex: 1 }]}><Text style={{ color: P.blue, fontSize: 12.5, fontWeight: "800" }}>☰ Activity</Text></Pressable>
                  <Pressable accessibilityRole="button" onPress={() => void toggle(r)} style={[s.btn, { borderColor: P.line, flex: 1 }]}><Text style={{ color: P.blue, fontSize: 12.5, fontWeight: "800" }}>{r.status === "paused" || r.status === "triggered" ? "▶ Re-arm" : "⏸ Pause"}</Text></Pressable>
                  <Pressable accessibilityRole="button" onPress={() => { setEditId(r.id); setEdit({ type: r.rule_type, threshold: String(Number(r.threshold)), recurrence: r.recurrence }); setMenu(null); }} style={[s.btn, { borderColor: P.line, flex: 1 }]}><Text style={{ color: P.blue, fontSize: 12.5, fontWeight: "800" }}>✎ Edit</Text></Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${r.symbol} monitor`} onPress={() => remove(r)} style={[s.btn, { borderColor: P.line, paddingHorizontal: 10 }]}><Text style={{ fontSize: 13 }}>🗑</Text></Pressable>
                </View>
                {activityId === r.id ? <View style={{ gap: 6 }}>{alertList(alerts.filter(a => a.rule_id === r.id))}</View> : null}
              </>
            )}
          </View>
        );
      })}

      <View style={[s.band, { backgroundColor: P.blueDim, borderColor: P.line }]}>
        <Pressable accessibilityRole="button" onPress={() => setShowAll(v => !v)} style={s.between}>
          <View style={{ flex: 1 }}><Text style={[s.h3, { color: P.ink }]}>Alert activity</Text><Text style={[s.muted, { color: P.muted }]}>See the quote and rule behind an alert.</Text></View>
          <Text style={{ color: P.blue, fontSize: 12.5, fontWeight: "800" }}>Explain this alert ›</Text>
        </Pressable>
        {showAll ? <View style={{ gap: 6, marginTop: 6 }}>{alertList(alerts)}</View> : null}
      </View>

      <Modal visible={!!chartRule} animationType="slide" onRequestClose={() => setChartRule(null)}>
        <View style={{ flex: 1, backgroundColor: P.card, paddingTop: 36 }}>
          <StatusBar style="dark" />
          <View style={[s.between, { paddingHorizontal: 14, paddingBottom: 8 }]}>
            <View style={{ flex: 1 }}>
              <Text style={[s.h2, { color: P.ink }]}>{chartRule?.symbol} chart</Text>
              {chartRule ? <Text style={{ color: P.muted, fontSize: 12 }}>{ruleLine(chartRule, chartRule.asset_class)}</Text> : null}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close chart" onPress={() => setChartRule(null)} style={[s.btn, { borderColor: P.line, paddingHorizontal: 14 }]}><Text style={{ color: P.ink, fontSize: 13, fontWeight: "800" }}>Close ✕</Text></Pressable>
          </View>
          <ScrollView scrollEnabled={!touching} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>
            {chartRule ? <PriceChart palette={P} asset={{ symbol: chartRule.symbol, assetClass: chartRule.asset_class }} rule={chartRule} alerts={alerts.filter(a => a.rule_id === chartRule.id).map(a => ({ id: a.id, created_at: a.created_at, observed_price: a.observed_price, source: a.source, message: a.message, quote_as_of: a.quote_as_of, symbol: a.symbol }))} lastPrice={chartRule.last_price ? Number(chartRule.last_price) : null} onCreateAlert={createFromChart} onTouching={setTouching} /> : null}
          </ScrollView>
        </View>
      </Modal>

      <View style={[s.card, { backgroundColor: "#e9f0fc", borderColor: P.line }]}>
        <Text style={[s.muted, { color: P.muted }]}>Alerts appear in your Notifications (the bell). Prices are delayed, informational quotes from free public sources, so an alert can lag the market. This is not advice and nothing is traded. Lock-screen push is not set up yet.</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 8 },
  band: { borderWidth: 1, borderRadius: 14, padding: 12 },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rowWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  h2: { fontSize: 15, fontWeight: "800" },
  h3: { fontSize: 13.5, fontWeight: "800" },
  label: { fontSize: 12.5, fontWeight: "800", marginTop: 2 },
  muted: { fontSize: 11.5, lineHeight: 16 },
  sym: { fontSize: 18, fontWeight: "800" },
  tag: { fontSize: 10, fontWeight: "800", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: "hidden" },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, fontWeight: "600", backgroundColor: "#fff" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, height: 26, justifyContent: "center" },
  select: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, height: 40 },
  menu: { position: "absolute", top: 44, left: 0, right: 0, borderWidth: 1, borderRadius: 10, elevation: 8, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, zIndex: 10 },
  suffixBox: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, height: 40, backgroundColor: "#fff" },
  segment: { flexDirection: "row", borderWidth: 1.5, borderRadius: 10, overflow: "hidden" },
  segItem: { flex: 1, height: 36, alignItems: "center", justifyContent: "center" },
  cta: { height: 42, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 2 },
  ctaText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  badge: { fontSize: 10.5, fontWeight: "800", paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, overflow: "hidden" },
  rule: { borderTopWidth: StyleSheet.hairlineWidth },
  kv: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  btn: { borderWidth: 1.5, borderRadius: 10, height: 36, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  alertRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  explain: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 2, backgroundColor: "#fff", marginBottom: 4 },
  k: { fontSize: 10.5, fontWeight: "800", marginTop: 4, textTransform: "uppercase" },
});
