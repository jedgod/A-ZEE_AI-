import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text as RNText, TextInput as RNTextInput, View } from "react-native";
import type { ComponentProps } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SecureStore from "expo-secure-store";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/lib/api";
import { newId } from "@/lib/storage";
import { useAuth } from "@/lib/auth";
import { MonitorPanel, type MonitorSeed } from "@/components/monitor-panel";
import { PriceChart, type NewAlert } from "@/components/price-chart";
import type { Asset } from "@/lib/finance-data";
import { createAZTradeClient, AZTradeError, type Capabilities, type Entitlements, type Intelligence, type PaperAccount, type ResearchMessage, type RiskReport } from "@/lib/aztrade";

// Every Text and TextInput on this screen caps the phone's font-size setting so the layout keeps the designed proportions.
const Text = (props: ComponentProps<typeof RNText>) => <RNText maxFontSizeMultiplier={1.05} {...props} />;
const TextInput = (props: ComponentProps<typeof RNTextInput>) => <RNTextInput maxFontSizeMultiplier={1.05} {...props} />;

type Section = "Overview" | "Markets" | "AI" | "Portfolio" | "More";
type Detail = "monitor" | "strategies" | "risk" | "backtests" | "broker" | "subscription" | "help";
type AssetClass = "stocks" | "etfs" | "crypto" | "forex" | "commodities";
type Item = { symbol: string; cls: AssetClass };

const NAV: { key: Section; glyph: string; label: string }[] = [
  { key: "Overview", glyph: "⌂", label: "Overview" },
  { key: "Markets", glyph: "↗", label: "Markets" },
  { key: "AI", glyph: "AI", label: "AI" },
  { key: "Portfolio", glyph: "◑", label: "Portfolio" },
  { key: "More", glyph: "▦", label: "More" },
];
const CLASSES: { id: AssetClass | "all"; label: string; glyph: string; quick: string[] }[] = [
  { id: "all", label: "All", glyph: "◎", quick: [] },
  { id: "stocks", label: "Stocks", glyph: "▥", quick: ["AAPL", "NVDA", "MSFT", "TSLA"] },
  { id: "etfs", label: "ETFs", glyph: "≋", quick: ["SPY", "QQQ", "VTI", "GLD"] },
  { id: "crypto", label: "Crypto", glyph: "₿", quick: ["BTC-USD", "ETH-USD", "SOL-USD"] },
  { id: "forex", label: "Forex", glyph: "⇄", quick: ["EUR/USD", "GBP/USD", "USD/JPY"] },
  { id: "commodities", label: "Commodities", glyph: "▤", quick: ["XAU-USD", "XAG-USD", "WTI"] },
];
const NAMES: Record<string, string> = { AAPL: "Apple Inc.", NVDA: "NVIDIA Corporation", TSLA: "Tesla, Inc.", MSFT: "Microsoft Corporation", "BTC-USD": "Bitcoin (USD)", "ETH-USD": "Ethereum (USD)", "SOL-USD": "Solana (USD)", "XAU-USD": "Gold (USD/Oz)", "XAG-USD": "Silver (USD/Oz)", SPY: "S&P 500 ETF", QQQ: "Nasdaq-100 ETF", VTI: "Total US Market ETF", GLD: "Gold ETF", WTI: "WTI Crude Oil" };
const DEFAULTS: Item[] = [{ symbol: "AAPL", cls: "stocks" }, { symbol: "NVDA", cls: "stocks" }, { symbol: "TSLA", cls: "stocks" }, { symbol: "BTC-USD", cls: "crypto" }, { symbol: "XAU-USD", cls: "commodities" }];
const FOCUS = ["Risk", "Earnings", "Crypto", "ETFs", "Macro"];
const SYMBOL = /^[A-Z0-9][A-Z0-9._\-/=]{0,19}$/;
const TILE_COLORS = ["#1769ff", "#0e9f6e", "#e11d48", "#f59e0b", "#7c3aed", "#0891b2"];

// Navy header over a light sheet, blue accent. Every figure comes from the account or the servers; no sample prices or charts.
const P = { head: "#061035", head2: "#0b1a52", sheet: "#eef3fc", card: "#ffffff", line: "#d6e0f2", ink: "#0b1b3d", muted: "#5a6a8c", blue: "#1769ff", blueDim: "#e2ecff", banner: "#dce9ff", warn: "#92400e", warnBg: "#fef3c7", err: "#991b1b", errBg: "#fee2e2" };

const errorText = (error: unknown) => {
  if (error instanceof AZTradeError) {
    if (error.code === "DAILY_LIMIT_REACHED") return "You've used today's AZTrade AI questions. Try again tomorrow.";
    if (error.status === 401) return "Your sign-in expired. Sign in again if this keeps happening.";
    if (error.status === 403) return "Your current plan doesn't include this feature.";
    if (error.status === 429) return "Too many requests. Try again in a moment.";
    if (error.status === 503 || error.status === 502 || error.status === 0) return "AZTrade is temporarily unavailable. Check the server connection.";
    return `AZTrade request failed (${error.code}).`;
  }
  return "AZTrade is unavailable right now.";
};
const money = (x: unknown) => { const n = Number(x); return x == null || x === "" || !Number.isFinite(n) ? "Unavailable" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }); };
const isHistory = (x: unknown): x is ResearchMessage[] => Array.isArray(x) && x.every(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
const isItems = (x: unknown): x is Item[] => Array.isArray(x) && x.every(i => i && typeof i.symbol === "string" && SYMBOL.test(i.symbol) && CLASSES.some(c => c.id === i.cls));
const MARKETS: { id: AssetClass; label: string; glyph: string }[] = [
  { id: "stocks", label: "U.S. Stocks", glyph: "▥" }, { id: "etfs", label: "ETFs", glyph: "≋" }, { id: "crypto", label: "Crypto", glyph: "₿" },
  { id: "forex", label: "Forex", glyph: "⇄" }, { id: "commodities", label: "Commodities", glyph: "▤" },
];
const MODES = ["Analyze", "Compare", "Risks", "Outlook"];
// Strips the context the screen adds in front of a question, so history and recent lists show what the person typed.
const clean = (text: string) => text.replace(/^(?:(?:Asset|Market|Task|Focus): [^.]*\. )+/, "");
const ICON_W = 26;
function NavIcon({ kind, color }: { kind: Section; color: string }) {
  const W = 18;
  if (kind === "Overview") return (   // house: roof + body with a door
    <View style={{ width: W, height: W, alignItems: "center", justifyContent: "flex-end" }}>
      <View style={{ position: "absolute", top: 1, width: 12, height: 12, borderLeftWidth: 2, borderTopWidth: 2, borderColor: color, borderTopLeftRadius: 2, transform: [{ rotate: "45deg" }] }} />
      <View style={{ width: 12, height: 8, borderWidth: 2, borderTopWidth: 0, borderBottomLeftRadius: 3, borderBottomRightRadius: 3, borderColor: color }} />
    </View>
  );
  if (kind === "Markets") return (     // rising bars
    <View style={{ width: W, height: W, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
      {[7, 11, 8, 15].map((h, i) => <View key={i} style={{ width: 3, height: h, borderRadius: 1.5, backgroundColor: color }} />)}
    </View>
  );
  if (kind === "Portfolio") return (    // briefcase
    <View style={{ width: W, height: W, alignItems: "center", justifyContent: "flex-end" }}>
      <View style={{ position: "absolute", top: 0, width: 8, height: 5, borderWidth: 2, borderBottomWidth: 0, borderTopLeftRadius: 2, borderTopRightRadius: 2, borderColor: color }} />
      <View style={{ width: W, height: 13, borderWidth: 2, borderRadius: 4, borderColor: color, justifyContent: "center" }}><View style={{ height: 2, backgroundColor: color, opacity: 0.7 }} /></View>
    </View>
  );
  return (                              // More: three dots
    <View style={{ width: W, height: W, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      {[0, 1, 2].map(i => <View key={i} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: color }} />)}
    </View>
  );
}
type QuoteInfo = { price: number | null; currency: string; changePercent?: string; provider: string; asOf?: string };
type QuoteState = Record<string, { quote?: QuoteInfo; error?: string }>;
const API_CLASS: Record<AssetClass, string> = { stocks: "stocks_etfs", etfs: "stocks_etfs", crypto: "crypto", forex: "forex", commodities: "commodities" };
const classOf = (symbol: string, known?: AssetClass): AssetClass => known ?? (/^X(AU|AG|PT|PD)(-USD)?$/.test(symbol) ? "commodities" : /-USDT?$/.test(symbol) ? "crypto" : /^[A-Z]{3}\/[A-Z]{3}$/.test(symbol) ? "forex" : "stocks");
const fmtPrice = (price: number, cls: AssetClass) => cls === "forex" ? price.toFixed(4) : price.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: price < 1 ? 4 : 2 });
const changeOf = (q?: QuoteInfo) => { const n = q?.changePercent ? parseFloat(q.changePercent) : NaN; return Number.isFinite(n) ? n : null; };
const REASONS: Record<string, string> = { PROVIDER_NOT_CONFIGURED: "No data source set up", QUOTE_UNAVAILABLE: "No quote right now", FUTURES_NOT_CONFIGURED: "Not supported yet", EXTERNAL_DATA_DISABLED: "Private mode is on", INVALID_SYMBOL: "Invalid symbol", RATE_LIMITED: "Too many lookups" };
const tileColor = (symbol: string) => TILE_COLORS[[...symbol].reduce((n, c) => n + c.charCodeAt(0), 0) % TILE_COLORS.length];

export default function AZTradeMobileScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const client = useMemo(createAZTradeClient, [user?.id]);
  const [section, setSection] = useState<Section>("Overview");
  const [access, setAccess] = useState<Capabilities | null>(null);
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [intel, setIntel] = useState<Intelligence | null>(null);
  const [paper, setPaper] = useState<PaperAccount | null>(null);
  const [risk, setRisk] = useState<RiskReport | null>(null);
  const [history, setHistory] = useState<ResearchMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [focus, setFocus] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [unread, setUnread] = useState(0);
  const [watch, setWatch] = useState<Item[]>(DEFAULTS);
  const [cls, setCls] = useState<AssetClass | "all">("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [mode, setMode] = useState<string | null>(null);
  const [mkt, setMkt] = useState<AssetClass | "all">("stocks");
  const [ticker, setTicker] = useState<string>("");
  const [picker, setPicker] = useState<"market" | "asset" | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [seed, setSeed] = useState(0);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [focused, setFocused] = useState(true);
  const [monitorSeed, setMonitorSeed] = useState<MonitorSeed | null>(null);
  const [chartAsset, setChartAsset] = useState<Asset>({ symbol: "BTC-USD", assetClass: "crypto" });
  const [scrollLock, setScrollLock] = useState(false);
  const [monitorCount, setMonitorCount] = useState<number | null>(null);
  const [quotes, setQuotes] = useState<QuoteState>({});
  const [quoting, setQuoting] = useState(false);
  const quotedAt = useRef(0);
  const quotedKey = useRef("");
  // Light clock, signal and battery icons on the navy header; the previous style comes back when this screen loses focus.
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  const activeRequest = useRef<AbortController | null>(null);
  const watchKey = `azee.aztrade.watchlist.${user?.id ?? "guest"}`;

  // The watchlist is just a list of symbols the user chose. It stays on this device and carries no prices.
  useEffect(() => {
    let alive = true;
    SecureStore.getItemAsync(watchKey).then(raw => { if (alive && raw) { try { const v = JSON.parse(raw); if (isItems(v)) setWatch(v.slice(0, 50)); } catch { /* keep defaults */ } } }).catch(() => undefined);
    return () => { alive = false; };
  }, [watchKey]);
  const saveWatch = useCallback((next: Item[]) => { setWatch(next); SecureStore.setItemAsync(watchKey, JSON.stringify(next)).catch(() => undefined); }, [watchKey]);

  useEffect(() => { api<{ count: number }>("/api/notifications/unread-count").then(r => setUnread(r.count)).catch(() => undefined); }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setPaper(null); setRisk(null); setHistory([]); setAccess(null); setEnt(null); setIntel(null);
    async function load() {
      try {
        const caps = await client.capabilities(controller.signal);
        if (controller.signal.aborted) return;
        setAccess(caps);
        // Each service fails on its own: research still works when the practice-account backend is offline.
        const [accountResult, riskResult, historyResult, entResult, intelResult] = await Promise.allSettled([
          client.paper(controller.signal), client.portfolioRisk(controller.signal), client.history(controller.signal),
          client.entitlements(controller.signal), client.intelligenceStatus(controller.signal),
        ]);
        if (controller.signal.aborted) return;
        if (accountResult.status === "fulfilled" && typeof accountResult.value?.accountId === "string") setPaper(accountResult.value);
        if (riskResult.status === "fulfilled") setRisk(riskResult.value);
        if (entResult.status === "fulfilled" && typeof entResult.value?.plan === "string") setEnt(entResult.value);
        if (intelResult.status === "fulfilled") setIntel(intelResult.value);
        if (historyResult.status === "fulfilled" && isHistory(historyResult.value)) setHistory(historyResult.value);
      } catch (e) { if (!controller.signal.aborted) setError(errorText(e)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => { controller.abort(); activeRequest.current?.abort(); client.clear(); };
  }, [client, refreshKey]);

  const ask = useCallback(async () => {
    const typed = question.trim();
    const context = section === "AI" ? [ticker ? `Asset: ${ticker}. ` : "", mkt !== "all" ? `Market: ${MARKETS.find(m => m.id === mkt)?.label}. ` : "", mode ? `Task: ${mode}. ` : ""].join("") : "";
    const prompt = typed ? `${context}${focus ? `Focus: ${focus}. ` : ""}${typed}` : typed;
    if (!access?.capabilities.researchAssistant || !typed || busy || prompt.length > 4000) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    setBusy(true); setError(""); setAnswer("");
    const requestId = newId(); // one id per question, stable across the internal auth retry
    try {
      const response = await client.research(requestId, prompt, controller.signal);
      if (controller.signal.aborted) return;
      if (typeof response.reply !== "string" || !response.reply.trim()) throw new Error("Invalid reply");
      setAnswer(response.reply);
      setSection("AI");
      setHistory(items => [...items, { role: "user" as const, content: prompt }, { role: "assistant" as const, content: response.reply }].slice(-50));
      void client.entitlements().then(setEnt).catch(() => undefined);   // today's usage
    } catch (e) { if (!controller.signal.aborted) setError(errorText(e)); }
    finally { if (!controller.signal.aborted) setBusy(false); activeRequest.current = null; }
  }, [access, question, focus, busy, client, section, ticker, mkt, mode]);

  const addSymbol = (raw: string, forClass?: AssetClass) => {
    const symbol = raw.trim().toUpperCase();
    if (!SYMBOL.test(symbol) || watch.some(w => w.symbol === symbol) || watch.length >= 50) return;
    const picked = forClass ?? (cls === "all" ? "stocks" : cls);
    saveWatch([...watch, { symbol, cls: picked }]);
    setSearch("");
  };
  const askAbout = (symbol: string) => {
    setQuestion(`Give me a research overview of ${symbol}: what drives it, the main risks, and what to check before investing. Don't quote live prices.`);
    setFocus(null); setSection("AI");
  };

  // Delayed, informational quotes for the watchlist and any practice holdings, from A-Zee's own quote service.
  const quoteItems = useMemo(() => {
    const seen = new Map<string, { symbol: string; cls: AssetClass }>();
    for (const w of watch) seen.set(w.symbol, { symbol: w.symbol, cls: w.cls });
    for (const pos of paper?.positions ?? []) if (!seen.has(pos.symbol)) seen.set(pos.symbol, { symbol: pos.symbol, cls: classOf(pos.symbol) });
    return [...seen.values()].slice(0, 25);
  }, [watch, paper]);
  const loadQuotes = useCallback(async (force = false) => {
    if (!quoteItems.length) return;
    const key = quoteItems.map(i => i.symbol).join(",");
    if (!force && key === quotedKey.current && Date.now() - quotedAt.current < 60_000) return;
    quotedKey.current = key; quotedAt.current = Date.now();
    setQuoting(true);
    try {
      const r = await api<{ results: { symbol: string; quote?: QuoteInfo; error?: string }[] }>("/api/finance/quotes", { method: "POST", body: { items: quoteItems.map(i => ({ symbol: i.symbol, assetClass: API_CLASS[i.cls] })) } });
      setQuotes(prev => { const next = { ...prev }; for (const x of r.results) next[x.symbol] = x.quote ? { quote: x.quote } : { error: x.error ?? "QUOTE_UNAVAILABLE" }; return next; });
    } catch { /* keep what is already shown */ }
    finally { setQuoting(false); }
  }, [quoteItems]);
  useEffect(() => { if (section === "Markets" || section === "Portfolio" || (section === "More" && detail === "risk")) void loadQuotes(); }, [section, detail, loadQuotes]);
  const anyPriced = Object.values(quotes).some(q => q.quote?.price != null);

  // Practice-account valuation from those informational prices. It is only called complete when every holding has a price.
  const valuation = useMemo(() => {
    if (!paper) return null;
    const cash = Number(paper.cash);
    if (!Number.isFinite(cash)) return null;
    const rows = (paper.positions ?? []).map(pos => {
      const cls = classOf(pos.symbol, watch.find(w => w.symbol === pos.symbol)?.cls);
      const qty = Number(pos.shares);
      const price = quotes[pos.symbol]?.quote?.price ?? null;
      return { symbol: pos.symbol, cls, qty, price, value: price != null && Number.isFinite(qty) ? qty * price : null };
    });
    const missing = rows.filter(r => r.value == null).map(r => r.symbol);
    const complete = missing.length === 0;
    const total = cash + rows.reduce((n, r) => n + (r.value ?? 0), 0);
    const byClass: Record<string, number> = { Cash: cash };
    for (const r of rows) if (r.value != null) { const label = r.cls === "stocks" || r.cls === "etfs" ? "Equities" : r.cls.charAt(0).toUpperCase() + r.cls.slice(1); byClass[label] = (byClass[label] ?? 0) + r.value; }
    const pct = (v: number) => (total > 0 ? (100 * v) / total : 0);
    const largest = complete && rows.length && total > 0 ? Math.max(...rows.map(r => r.value as number)) / total * 100 : null;
    return { cash, rows, missing, complete, total, byClass, pct, largest };
  }, [paper, quotes, watch]);

  const canAsk = !!access?.capabilities.researchAssistant && !!question.trim() && !busy;
  const daily = ent?.daily;
  const recent = history.filter(m => m.role === "user").slice(-3).reverse();
  const marketsLive = access?.capabilities.marketData === "licensed" && intel?.marketDataConfigured === true;
  const shown = cls === "all" ? watch : watch.filter(w => w.cls === cls);
  const planLabel = ent ? `${ent.plan.charAt(0).toUpperCase()}${ent.plan.slice(1)} Plan` : "";
  const titles: Record<Section, [string, string]> = {
    Overview: ["Overview", "Research and market intelligence from your A-Zee account"],
    Markets: ["Markets", "Explore markets, track assets, and get AI insights."],
    AI: ["AI Research", "Ask about markets, risk and your practice account."],
    Portfolio: ["Portfolio", "Your practice account, risk and plan."],
    More: ["More", "Explore, manage, and get support for your AZTrade AI experience."],
  };

  const confirmSignOut = () => Alert.alert("Sign out?", "You'll need to sign in again on this device.", [
    { text: "Cancel", style: "cancel" },
    { text: "Sign out", style: "destructive", onPress: () => { void signOut().then(() => router.replace("/sign-in")); } },
  ]);
  type Tone = "soon" | "ok" | "plan" | "neutral";
  const MENU: { key: string; glyph: string; title: string; sub: string; badge: string; tone: Tone; onPress: () => void }[] = [
    { key: "monitor", glyph: "🔔", title: "Monitors", sub: "Get an alert when a price or 24-hour move crosses your rule.", badge: monitorCount ? `${monitorCount} active` : "New", tone: "plan", onPress: () => { setMonitorSeed(null); setDetail("monitor"); } },
    { key: "strategies", glyph: "📊", title: "Strategies", sub: "Strategy research and ideas, once licensed data is connected.", badge: "Coming Soon", tone: "soon", onPress: () => setDetail("strategies") },
    { key: "risk", glyph: "🛡", title: "Risk Intelligence", sub: "Portfolio, market, and asset risk analysis.", badge: valuation?.complete ? "✓ Available" : valuation ? "Partial" : "Unavailable", tone: valuation?.complete ? "ok" : "neutral", onPress: () => setDetail("risk") },
    { key: "backtests", glyph: "⚗", title: "Backtests", sub: "Test and evaluate strategies on historical data.", badge: "Coming Soon", tone: "soon", onPress: () => setDetail("backtests") },
    { key: "broker", glyph: "🏛", title: "Broker Connections", sub: "Connect a supported broker (read-only).", badge: "🔒 Coming Soon", tone: "soon", onPress: () => setDetail("broker") },
    { key: "history", glyph: "⟲", title: "Research History", sub: "View and manage your past AI research.", badge: "✓ Available", tone: "ok", onPress: () => { setSection("AI"); setShowHistory(true); } },
    { key: "subscription", glyph: "♛", title: "Subscription", sub: "Manage your AZTrade AI plan and usage.", badge: planLabel ? `♛ ${planLabel}` : "Plan", tone: "plan", onPress: () => setDetail("subscription") },
    { key: "settings", glyph: "⚙", title: "Settings", sub: "Preferences, alerts, and data controls.", badge: "✓ Available", tone: "ok", onPress: () => router.navigate("/account") },
    { key: "help", glyph: "?", title: "Help", sub: "Guides, FAQs, and what AZTrade can and can't do.", badge: "Guides", tone: "plan", onPress: () => setDetail("help") },
    { key: "signout", glyph: "⇥", title: "Sign Out", sub: "Sign out of your AZTrade AI account.", badge: "🔒 Secure", tone: "neutral", onPress: confirmSignOut },
  ];
  const DETAIL_TITLES: Record<Detail, string> = { monitor: "Monitors", strategies: "Strategies", risk: "Risk Intelligence", backtests: "Backtests", broker: "Broker Connections", subscription: "Subscription", help: "Help" };
  const FAQ: [string, string][] = [
    ["What is AZTrade AI?", "A research and education companion. It explains markets, risk and your practice account in plain language."],
    ["Can it trade for me?", "No. Simulated and real-money orders are both switched off on the server, and AZTrade never asks for trading or withdrawal permissions."],
    ["Where do prices come from?", "No licensed market-data source is connected yet, so AZTrade shows no live prices or charts. Try Finance in the chat shows informational, possibly delayed quotes."],
    ["Is my watchlist private?", "It is saved only on this device and holds symbols, not prices or balances."],
    ["Why did a question fail?", "Check your daily AI limit on the Subscription page, then try again. Answers can take up to a minute when a model provider is busy."],
  ];
  const T = ticker || "the market";
  const other = watch.find(w => w.symbol !== ticker)?.symbol ?? "SPY";
  const PROMPTS = [
    [["↗", "Earnings outlook", `What should I watch in ${T}'s next earnings report?`], ["⚖", "Key risks", `What are the key risks for ${T}?`], ["⇄", `Compare with ${other}`, `Compare ${T} with ${other}: business model, risks and valuation drivers.`], ["💡", "Long-term view", `Give a balanced long-term view of ${T}, with bull and bear cases.`]],
    [["◔", "Diversification", `How does ${T} fit into a diversified portfolio?`], ["≈", "Volatility", `What drives the volatility of ${T}, and how do investors manage it?`], ["%", "Dividends", `How should I think about income and dividends for ${T}?`], ["🌐", "Macro drivers", `Which macro factors, like rates and inflation, matter most for ${T}?`]],
  ][seed % 2];
  const Rich = ({ text }: { text: string }) => (
    <View style={{ gap: 6 }}>
      {text.split("\n").map((line, i) => {
        if (!line.trim()) return null;
        const bullet = /^\s*[-*•]\s+/.test(line);
        const heading = /^#{1,3}\s+/.test(line);
        const body = line.replace(/^\s*[-*•]\s+/, "").replace(/^#{1,3}\s+/, "");
        const parts = body.split(/\*\*(.+?)\*\*/g);
        return (
          <View key={i} style={{ flexDirection: "row", gap: 8 }}>
            {bullet ? <Text style={{ color: P.blue, fontSize: 14, lineHeight: 21 }}>•</Text> : null}
            <Text selectable style={[s.body, { color: P.ink, flex: 1 }, heading && { fontWeight: "800", fontSize: 16 }]}>
              {parts.map((part, j) => (j % 2 ? <Text key={j} style={{ fontWeight: "800" }}>{part}</Text> : part))}
            </Text>
          </View>
        );
      })}
    </View>
  );
  const Card = ({ children, style }: { children: React.ReactNode; style?: object }) => <View style={[s.card, style]}>{children}</View>;
  const Para = ({ children }: { children: React.ReactNode }) => <Text style={s.body}>{children}</Text>;
  const Stat = ({ glyph, label, value, sub }: { glyph: string; label: string; value: string; sub: string }) => (
    <View style={[s.card, s.stat]}>
      <View style={s.tile}><Text style={s.tileGlyph}>{glyph}</Text></View>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.statValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={s.statSub} numberOfLines={2}>{sub}</Text>
    </View>
  );
  const askBox = (
    <Card>
      <View style={s.rowBetween}>
        <View style={{ flex: 1 }}>
          <Text style={s.h2}>AI Research</Text>
          <Text style={s.muted}>Ask AZTrade AI about markets, risk and your practice account.</Text>
        </View>
        {section !== "AI" ? <Pressable accessibilityRole="button" onPress={() => setSection("AI")} style={s.hubBtn}><Text style={s.hubText}>✦ Research Hub</Text></Pressable> : null}
      </View>
      <View style={s.inputWrap}>
        <TextInput multiline value={question} onChangeText={setQuestion} maxLength={3900} editable={!busy} accessibilityLabel="Research question" placeholder="E.g., What are the key risks of holding crypto and stocks together?" placeholderTextColor={P.muted} selectionColor={P.blue} style={s.input} />
        <Pressable accessibilityRole="button" accessibilityLabel="Analyze with AI" disabled={!canAsk} onPress={() => void ask()} style={[s.send, { opacity: canAsk ? 1 : 0.4 }]}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.sendGlyph}>➤</Text>}
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }} style={{ flexGrow: 0 }}>
        {FOCUS.map(f => (
          <Pressable key={f} accessibilityRole="button" accessibilityState={{ selected: focus === f }} onPress={() => setFocus(focus === f ? null : f)} style={[s.focus, focus === f && { backgroundColor: P.blueDim, borderColor: P.blue }]}>
            <Text style={{ color: focus === f ? P.blue : P.muted, fontSize: 11, fontWeight: "700" }}>Focus: {f}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {busy ? <Pressable accessibilityRole="button" onPress={() => { activeRequest.current?.abort(); setBusy(false); }}><Text style={{ color: P.blue, fontWeight: "700" }}>Cancel</Text></Pressable> : null}
    </Card>
  );
  const recentList = (
    <View style={{ gap: 10 }}>
      <View style={s.rowBetween}><Text style={s.h2}>Recent Research</Text>{history.length ? <Pressable onPress={() => setSection("AI")} accessibilityRole="button"><Text style={s.link}>View all</Text></Pressable> : null}</View>
      {recent.length ? recent.map((m, i) => (
        <Pressable key={i} accessibilityRole="button" onPress={() => { setQuestion(clean(m.content)); setSection("AI"); }} style={[s.card, s.recent]}>
          <View style={s.tile}><Text style={s.tileGlyph}>?</Text></View>
          <Text style={s.recentText} numberOfLines={2}>{m.content}</Text>
          <Text style={{ color: P.muted, fontSize: 20 }}>›</Text>
        </Pressable>
      )) : <Card><Para>No research yet. Your questions will appear here.</Para></Card>}
    </View>
  );
  const watchRows = (list: Item[]) => list.length ? list.map(w => (
    <Pressable key={w.symbol} accessibilityRole="button" accessibilityLabel={`${w.symbol}, ask AI`} onPress={() => (editing ? undefined : askAbout(w.symbol))} style={[s.card, s.watchRow]}>
      <View style={[s.logo, { backgroundColor: tileColor(w.symbol) }]}><Text style={s.logoLetter}>{w.symbol.charAt(0)}</Text></View>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} adjustsFontSizeToFit style={s.sym}>{w.symbol}</Text>
        <Text style={s.muted} numberOfLines={1}>{NAMES[w.symbol] ?? CLASSES.find(c => c.id === w.cls)?.label}</Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        {(() => {
          const st = quotes[w.symbol];
          const price = st?.quote?.price;
          if (price != null) {
            const ch = changeOf(st?.quote);
            return <>
              <Text style={s.noPrice}>{fmtPrice(price, w.cls)}</Text>
              {ch != null ? <Text style={[s.change, { color: ch >= 0 ? "#059669" : "#dc2626" }]}>{ch >= 0 ? "▲ +" : "▼ "}{Math.abs(ch).toFixed(2)}%</Text> : <Text style={s.muted}>Delayed</Text>}
            </>;
          }
          if (quoting && !st) return <Text style={s.muted}>Loading…</Text>;
          return <><Text style={s.noPrice}>Price unavailable</Text><Text style={s.muted}>{REASONS[st?.error ?? ""] ?? "No data source"}</Text></>;
        })()}
      </View>
      {editing
        ? <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${w.symbol}`} hitSlop={8} onPress={() => saveWatch(watch.filter(x => x.symbol !== w.symbol))}><Text style={{ color: "#dc2626", fontSize: 20, paddingLeft: 6 }}>✕</Text></Pressable>
        : <>
            <Pressable accessibilityRole="button" accessibilityLabel={`Monitor ${w.symbol}`} hitSlop={8} onPress={() => { setMonitorSeed({ symbol: w.symbol, cls: w.cls }); setSection("More"); setDetail("monitor"); }}><Text style={{ fontSize: 16, paddingHorizontal: 2 }}>🔔</Text></Pressable>
            <Text style={{ color: P.muted, fontSize: 20 }}>›</Text>
          </>}
    </Pressable>
  )) : <Card><Para>Nothing here yet. Search above to add a symbol.</Para></Card>;
  const searchBar = (
    <View style={s.search}>
      <Text style={{ color: P.muted, fontSize: 18 }}>⌕</Text>
      <TextInput value={search} onChangeText={setSearch} placeholder="Search symbols, companies, or assets…" placeholderTextColor={P.muted} autoCapitalize="characters" autoCorrect={false} maxLength={20} returnKeyType="done" onSubmitEditing={() => addSymbol(search)} selectionColor={P.blue} accessibilityLabel="Add a symbol" style={{ flex: 1, color: P.ink, fontSize: 14, paddingVertical: 10 }} />
      {SYMBOL.test(search.trim().toUpperCase()) ? <Pressable accessibilityRole="button" onPress={() => addSymbol(search)}><Text style={s.link}>Add</Text></Pressable> : null}
    </View>
  );
  const pills = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }} style={{ flexGrow: 0 }}>
      {CLASSES.map(c => {
        const on = cls === c.id;
        return (
          <Pressable key={c.id} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setCls(c.id)} style={[s.pill, on && { backgroundColor: P.blue, borderColor: P.blue }]}>
            <Text style={{ color: on ? "#fff" : P.muted, fontSize: 12, fontWeight: "700" }}>{c.glyph}  {c.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
  const quickAdd = cls !== "all" ? (
    <View style={s.rowWrap}>
      {CLASSES.find(c => c.id === cls)!.quick.filter(q => !watch.some(w => w.symbol === q)).map(q => (
        <Pressable key={q} accessibilityRole="button" accessibilityLabel={`Add ${q}`} onPress={() => addSymbol(q, cls as AssetClass)} style={s.quick}><Text style={{ color: P.blue, fontSize: 12, fontWeight: "700" }}>+ {q}</Text></Pressable>
      ))}
    </View>
  ) : null;
  const watchHead = (
    <View style={s.rowBetween}>
      <Text style={s.h2}>My Watchlist ({watch.length})</Text>
      <View style={s.rowWrap}>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh prices" disabled={quoting} onPress={() => void loadQuotes(true)}><Text style={[s.link, quoting && { opacity: 0.5 }]}>{quoting ? "Loading…" : "↻ Prices"}</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => setEditing(e => !e)}><Text style={s.link}>{editing ? "Done" : "Edit"}</Text></Pressable>
      </View>
    </View>
  );

  return (
    <SafeAreaView edges={["top", "left", "right", "bottom"]} style={{ flex: 1, backgroundColor: P.head }}>
      {focused ? <StatusBar style="light" /> : null}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={s.header}>
          <View style={s.headRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="Back to A-Zee" hitSlop={10} onPress={() => router.navigate("/")} style={{ paddingRight: 8 }}><Text style={{ color: "#fff", fontSize: 26 }}>‹</Text></Pressable>
            <Image accessibilityLabel="AZ" source={require("../../../../assets/aztrade-az.png")} resizeMode="contain" style={s.markImg} />
            <Text style={s.brand}>AZTrade <Text style={{ color: "#2f9bff" }}>AI</Text></Text>
            <View style={{ flex: 1 }} />
            {planLabel ? <View style={s.planPill}><Text style={s.planText}>♛ {planLabel}</Text></View> : null}
            <Pressable accessibilityRole="button" accessibilityLabel={unread ? `Notifications, ${unread} unread` : "Notifications"} hitSlop={8} onPress={() => router.navigate("/notifications")} style={s.bell}>
              <Text style={{ fontSize: 18 }}>🔔</Text>
              {unread > 0 ? <View style={s.dot} /> : null}
            </Pressable>
            {section === "Portfolio" || section === "More" ? <View style={s.avatar}><Text style={{ color: "#fff", fontWeight: "800" }}>{(user?.name || user?.email || "A").trim().charAt(0).toUpperCase()}</Text></View> : null}
          </View>
          {section !== "AI" ? <>
            <Text accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit style={s.title}>{titles[section][0]}</Text>
            <Text numberOfLines={2} adjustsFontSizeToFit style={s.sub}>{titles[section][1]}</Text>
          </> : null}
        </View>

        <ScrollView scrollEnabled={!scrollLock} keyboardShouldPersistTaps="handled" style={s.sheet} contentContainerStyle={s.page}>
          {loading ? <ActivityIndicator color={P.blue} size="large" style={{ margin: 14 }} /> : null}
          {error ? <View accessibilityRole="alert" style={s.error}><Text style={s.errorText}>{error}</Text></View> : null}

          {section === "Overview" ? <>
            <View style={s.statRow}>
              <Stat glyph="👛" label="Practice cash" value={paper ? money(paper.cash) : loading ? "…" : "Not connected"} sub="Simulated funds" />
              <Stat glyph="🧠" label="AI today" value={daily ? `${daily.research.used}/${daily.research.limit}` : "—"} sub={daily ? `${Math.max(0, daily.research.limit - daily.research.used)} left today` : "Plan usage"} />
              <Stat glyph="◔" label="Positions" value={paper ? String(paper.positions?.length ?? 0) : "—"} sub="Practice holdings" />
            </View>
            <Card style={s.regime}>
              <View style={s.tile}><Text style={s.tileGlyph}>◎</Text></View>
              <View style={{ flex: 1, gap: 4 }}>
                <View style={s.rowWrap}><Text style={s.h3}>Market Regime</Text><Text style={s.badge}>{marketsLive ? "Live" : "Needs data"}</Text></View>
                <Text style={s.muted}>{marketsLive ? "A verified market-data source is connected." : "Regime and signals appear only once a licensed market-data source is connected. None is, so nothing is guessed."}</Text>
              </View>
            </Card>
            {askBox}
            {recentList}
          </> : null}

          {section === "Markets" ? <>
            <View style={s.banner}>
              <View style={s.bannerIcon}><Text style={{ fontSize: 20 }}>🗄</Text></View>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} adjustsFontSizeToFit style={s.h3}>Market Data: {marketsLive ? "Connected" : anyPriced ? "Informational · Delayed" : "Not Connected"}</Text>
                <Text style={s.muted}>{marketsLive ? "A verified data source is connected." : anyPriced ? "Delayed quotes from free public sources. Not a licensed feed; no signals or trades use them." : "Live prices are unavailable. No quotes could be loaded right now."}</Text>
              </View>
              <Pressable accessibilityRole="button" onPress={() => setShowSources(v => !v)} style={s.outlineBtn}><Text style={s.outlineText}>Data Sources</Text></Pressable>
            </View>
            {showSources ? <Card><Para>Prices here are delayed quotes from free public sources through A-Zee (crypto and forex need no key; stocks, ETFs and commodities need a key on the server). They are informational only: not licensed for trading, and never used for AZTrade signals, regime, backtests or orders. A licensed feed can be connected later.</Para></Card> : null}
            {searchBar}
            {pills}
            {quickAdd}
            <Card style={s.overview}>
              <View style={{ flex: 0.9 }}><Text style={s.h3}>Market Overview</Text><Text style={s.muted}>{anyPriced ? "Delayed quotes from free public sources." : "Prices appear once quotes load."}</Text></View>
              <View style={{ flex: 1.2, gap: 8 }}>
                <View style={s.kv}><Text style={s.kvKey}>Data Source</Text><Text style={s.kvPill}>{marketsLive ? "Connected" : anyPriced ? "Public APIs" : "Not Connected"}</Text></View>
                <View style={s.kv}><Text style={s.kvKey}>Data Status</Text><Text style={s.muted}>{marketsLive ? "Available" : anyPriced ? "Delayed" : "Unavailable"}</Text></View>
              </View>
            </Card>
            {/* A plain View, not <Card>: Card is declared inside this component, so a re-render would rebuild it and reset the chart. */}
            <View style={s.card}>
              <Text style={s.h2}>Chart</Text>
              <PriceChart palette={P} asset={chartAsset} onAssetChange={setChartAsset} onTouching={setScrollLock}
                onCreateAlert={async (r: NewAlert) => {
                  await api("/api/finance/monitor", { method: "POST", body: { symbol: chartAsset.symbol, assetClass: chartAsset.assetClass, ruleType: r.ruleType, threshold: r.threshold, recurrence: r.recurrence } }).catch(e => { throw new Error((e as Error).message); });
                  setMonitorCount(c => (c ?? 0) + 1);
                }} />
            </View>
            {watchHead}
            {watchRows(shown)}
            <View style={s.note}><Text style={{ fontSize: 16 }}>ⓘ</Text><Text style={[s.muted, { flex: 1 }]}><Text style={{ fontWeight: "800", color: P.ink }}>Note: </Text>Prices are delayed, informational quotes and are not a licensed feed. Symbols without a quote need a data key on the server. Charts and signals stay off until a licensed provider is connected.</Text></View>
          </> : null}

          {section === "AI" ? <>
            <View style={s.hero}>
              <View style={s.heroBars} pointerEvents="none" importantForAccessibility="no-hide-descendants">
                {[8, 14, 22, 30].map((h, i) => <View key={i} style={{ width: 10, height: h, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: "#bcd6ff", opacity: 0.25 + i * 0.1 }} />)}
              </View>
              <View style={s.heroIcon}><Text style={s.heroGlyph}>✦</Text></View>
              <View style={{ flex: 1 }}>
                <Text accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit style={s.heroTitle}>AI Research</Text>
                <Text style={s.muted}>Market insights, asset analysis and investment research powered by AZTrade AI.</Text>
              </View>
            </View>
            <Card>
              <View style={s.rowWrap}>
                <View style={s.tile}><Text style={s.tileGlyph}>✦</Text></View>
                <View style={{ flex: 1 }}><Text style={s.h2}>Ask AZTrade AI</Text><Text style={s.muted}>Ask anything about markets, assets, trends, risks and more.</Text></View>
              </View>
              <View style={[s.inputWrap, { alignItems: "stretch" }]}>
                <TextInput multiline value={question} onChangeText={setQuestion} maxLength={3800} editable={!busy} accessibilityLabel="Research question" placeholder={`What are the key risks for ${ticker || "an asset"} ahead of earnings?`} placeholderTextColor={P.muted} selectionColor={P.blue} style={s.input} />
              </View>
              <View style={s.rowBetween}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }} style={{ flex: 1 }}>
                  {MODES.map(m => (
                    <Pressable key={m} accessibilityRole="button" accessibilityState={{ selected: mode === m }} onPress={() => setMode(mode === m ? null : m)} style={[s.focus, mode === m && { backgroundColor: P.blueDim, borderColor: P.blue }]}>
                      <Text style={{ color: mode === m ? P.blue : P.muted, fontSize: 12, fontWeight: "700" }}>{m}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <Pressable accessibilityRole="button" accessibilityLabel="Ask AI" disabled={!canAsk} onPress={() => void ask()} style={[s.askBtn, { opacity: canAsk ? 1 : 0.45 }]}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.askText}>➤  Ask AI</Text>}
                </Pressable>
              </View>
              {busy ? <Pressable accessibilityRole="button" onPress={() => { activeRequest.current?.abort(); setBusy(false); }}><Text style={s.link}>Cancel</Text></Pressable> : null}
            </Card>

            <View style={s.rowBetween}>
              <Pressable accessibilityRole="button" accessibilityLabel="Choose market" onPress={() => setPicker(picker === "market" ? null : "market")} style={[s.select, { flex: 1 }]}>
                <Text style={s.selectIcon}>▥</Text>
                <View style={{ flex: 1 }}><Text style={s.selectLabel}>Market</Text><Text style={s.selectValue} numberOfLines={1}>{mkt === "all" ? "All markets" : MARKETS.find(m => m.id === mkt)?.label}</Text></View>
                <Text style={{ color: P.muted }}>⌄</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Choose asset" onPress={() => setPicker(picker === "asset" ? null : "asset")} style={[s.select, { flex: 1 }]}>
                <Text style={s.selectIcon}>◈</Text>
                <View style={{ flex: 1 }}><Text style={s.selectLabel}>Asset / Ticker</Text><Text style={s.selectValue} numberOfLines={1}>{ticker ? `${NAMES[ticker]?.split(" ")[0] ?? ""} (${ticker})`.trim() : "Any"}</Text></View>
                <Text style={{ color: P.muted }}>⌄</Text>
              </Pressable>
            </View>
            {picker === "market" ? <Card style={{ gap: 0, padding: 4 }}>
              {[{ id: "all" as const, label: "All markets" }, ...MARKETS].map(m => (
                <Pressable key={m.id} accessibilityRole="button" onPress={() => { setMkt(m.id); setTicker(""); setPicker(null); }} style={s.option}><Text style={[s.optionText, mkt === m.id && { color: P.blue }]}>{m.label}</Text></Pressable>
              ))}
            </Card> : null}
            {picker === "asset" ? <Card style={{ gap: 0, padding: 4 }}>
              <Pressable accessibilityRole="button" onPress={() => { setTicker(""); setPicker(null); }} style={s.option}><Text style={[s.optionText, !ticker && { color: P.blue }]}>Any</Text></Pressable>
              {watch.filter(w => mkt === "all" || w.cls === mkt).map(w => (
                <Pressable key={w.symbol} accessibilityRole="button" onPress={() => { setTicker(w.symbol); setPicker(null); }} style={s.option}><Text style={[s.optionText, ticker === w.symbol && { color: P.blue }]}>{w.symbol}{NAMES[w.symbol] ? `  ·  ${NAMES[w.symbol]}` : ""}</Text></Pressable>
              ))}
              {!watch.some(w => mkt === "all" || w.cls === mkt) ? <Text style={[s.muted, { padding: 12 }]}>No symbols in this market. Add some in Watchlist.</Text> : null}
            </Card> : null}

            <View style={s.rowBetween}>
              <Text style={s.h2}>⚡ Suggested prompts</Text>
              <Pressable accessibilityRole="button" onPress={() => setSeed(x => x + 1)}><Text style={s.link}>↻ Refresh</Text></Pressable>
            </View>
            <View style={s.grid}>
              {PROMPTS.map(([glyph, label, text]) => (
                <Pressable key={label} accessibilityRole="button" onPress={() => setQuestion(text)} style={[s.card, s.suggest]}>
                  <Text style={{ color: P.blue, fontSize: 20 }}>{glyph}</Text>
                  <Text style={s.suggestText}>{label}</Text>
                </Pressable>
              ))}
            </View>

            <View style={s.sources}>
              <Text style={{ fontSize: 20 }}>🛡</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.h3}>No live data</Text>
                <Text style={s.muted}>Answers are general research. They do not use live prices, news or licensed feeds, and they say so when they can't answer.</Text>
              </View>
            </View>

            {answer ? <Card>
              <View style={s.rowBetween}><Text style={s.h2}>✦ Research Response</Text><Text style={s.muted}>Just now</Text></View>
              <Rich text={answer} />
              <View style={s.disclaimerBox}><Text style={{ fontSize: 16 }}>ⓘ</Text><View style={{ flex: 1 }}><Text style={s.h3}>Risk Disclaimer</Text><Text style={s.muted}>This is AI-generated research for information only. It is not investment advice, a recommendation, or a solicitation to buy or sell any security.</Text></View></View>
            </Card> : null}

            <View style={{ gap: 10 }}>
              <View style={[s.card, s.quota]}>
                <View style={s.ring}><Text style={s.ringText}>{daily ? `${daily.research.used}/${daily.research.limit}` : "—"}</Text></View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.h3}>Research Quota</Text>
                  <Text style={s.muted}>{daily ? `${daily.research.used} of ${daily.research.limit} AI research requests used today${planLabel ? ` (${planLabel})` : ""}` : "Plan usage unavailable"}</Text>
                  {daily ? <View style={s.bar}><View style={[s.barFill, { width: `${Math.min(100, Math.round((daily.research.used / Math.max(1, daily.research.limit)) * 100))}%` }]} /></View> : null}
                </View>
              </View>
              <Pressable accessibilityRole="button" onPress={() => setShowHistory(v => !v)} style={[s.card, s.quota]}>
                <View style={s.tile}><Text style={s.tileGlyph}>⟲</Text></View>
                <View style={{ flex: 1 }}><Text style={s.h3}>Research History</Text><Text style={s.muted}>View and continue past research</Text></View>
                <Text style={{ color: P.muted, fontSize: 20 }}>{showHistory ? "⌃" : "›"}</Text>
              </Pressable>
            </View>
            {showHistory ? <View style={{ gap: 10 }}>
              {history.length ? history.slice(-12).reverse().map((m, i) => (
                <Pressable key={i} accessibilityRole="button" disabled={m.role !== "user"} onPress={() => { setQuestion(clean(m.content)); setShowHistory(false); }}>
                  <Card><Text style={s.muted}>{m.role === "user" ? "You · tap to reuse" : "AZTrade AI"}</Text>{m.role === "user" ? <Text style={[s.body, { color: P.ink }]}>{clean(m.content)}</Text> : <Rich text={m.content} />}</Card>
                </Pressable>
              )) : <Card><Para>No research history yet.</Para></Card>}
            </View> : null}
          </> : null}

          {section === "Portfolio" ? <>
            <Card style={s.connect}>
              <View style={s.rowWrap}>
                <View style={s.tile}><Text style={s.tileGlyph}>🏛</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.h2}>Account Connection</Text>
                  <Text style={s.muted}>{paper ? "Practice account connected. View-only, simulated funds." : "No practice account connected."}</Text>
                </View>
              </View>
              <View style={s.rowBetween}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.muted}>✓ Read-only (no trading)</Text>
                  <Text style={s.muted}>✓ Sync holdings &amp; balance</Text>
                </View>
                <View style={[s.connectBtn, { opacity: 0.5 }]} accessibilityRole="button" accessibilityState={{ disabled: true }} accessibilityLabel="Connect Broker, not available yet"><Text style={s.askText}>🔗  Connect Broker</Text></View>
              </View>
              <Text style={s.muted}>Broker connections aren't available yet. Nothing is requested from you.</Text>
            </Card>
            <View style={s.rowBetween}>
              <View style={[s.card, { flex: 1, gap: 4 }]}>
                <View style={s.rowWrap}><View style={s.tile}><Text style={s.tileGlyph}>◈</Text></View><Text style={s.h3}>Total Value</Text></View>
                <Text style={s.bigValue} numberOfLines={1} adjustsFontSizeToFit>{valuation?.complete ? money(valuation.total) : "Unavailable"}</Text>
                <Text style={s.muted}>{valuation?.complete ? (valuation.rows.length ? "Cash plus holdings at delayed, informational prices." : "Practice cash only. No holdings yet.") : valuation ? `Needs a price for: ${valuation.missing.slice(0, 4).join(", ")}` : "Appears once an account is connected."}</Text>
              </View>
              <View style={[s.card, { flex: 1, gap: 4 }]}>
                <View style={s.rowWrap}><View style={s.tile}><Text style={s.tileGlyph}>◎</Text></View><Text style={s.h3}>Cash Balance</Text></View>
                <Text style={s.bigValue} numberOfLines={1} adjustsFontSizeToFit>{paper ? money(paper.cash) : "Unavailable"}</Text>
                <Text style={s.muted}>{paper ? "Simulated practice cash. Not real money." : "Appears once an account is connected."}</Text>
              </View>
            </View>
            <View style={s.rowBetween}>
              <View style={[s.card, { flex: 1.5 }]}>
                <Text style={s.h3}>Asset Allocation</Text>
                <View style={s.rowWrap}>
                  <View style={s.donut}><Text style={s.donutText}>{valuation?.complete ? "By class" : "Not available"}</Text></View>
                  <View style={{ flex: 1, gap: 5 }}>
                    {["Equities", "Crypto", "Forex", "Commodities", "Cash"].map(k => {
                      const pct = valuation?.complete ? valuation.pct(valuation.byClass[k] ?? 0) : null;
                      return <View key={k} style={s.kv}><Text style={s.legend}>{k}</Text><Text style={s.legend}>{pct == null ? "—" : `${pct.toFixed(0)}%`}</Text></View>;
                    })}
                  </View>
                </View>
              </View>
              <View style={[s.card, { flex: 1 }]}>
                <Text style={s.h3}>Concentration Risk</Text>
                <View style={s.gauge}><Text style={s.gaugeText}>{valuation?.largest != null ? `${valuation.largest.toFixed(0)}%` : "N/A"}</Text></View>
                <Text style={s.muted}>{valuation?.largest != null ? "Largest single position." : valuation && !valuation.rows.length ? "No positions to measure." : valuation && !valuation.complete ? "Needs a price for every holding." : "Needs a connected account."}</Text>
              </View>
            </View>
            <Card style={{ gap: 0, padding: 0, overflow: "hidden" }}>
              <View style={[s.rowBetween, { padding: 14 }]}>
                <Text style={s.h2}>Holdings</Text>
                <Text style={s.muted}>Total: {paper ? paper.positions?.length ?? 0 : "—"}  |  <Text style={{ color: P.blue, fontWeight: "700" }}>{paper ? "Practice" : "Not connected"}</Text></Text>
              </View>
              <View style={s.th}>
                <Text style={[s.thText, { flex: 1.3 }]}>Symbol</Text><Text style={s.thText}>Quantity</Text><Text style={s.thText}>Value (USD)</Text><Text style={s.thText}>Exposure</Text>
              </View>
              {paper?.positions?.length ? paper.positions.map((p, i) => (
                <View key={`${p.symbol}-${i}`} style={s.tr}>
                  <View style={{ flex: 1.3, flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={[s.logoSm, { backgroundColor: tileColor(p.symbol) }]}><Text style={s.logoLetter}>{p.symbol.charAt(0)}</Text></View>
                    <View style={{ flex: 1 }}><Text style={s.sym}>{p.symbol}</Text><Text style={s.muted} numberOfLines={1}>{NAMES[p.symbol] ?? ""}</Text></View>
                  </View>
                  <Text style={s.td}>{typeof p.shares === "string" ? p.shares : "—"}</Text>
                  <Text style={s.td}>{(() => { const r = valuation?.rows.find(x => x.symbol === p.symbol); return r?.value != null ? money(r.value) : "—"; })()}</Text>
                  <Text style={s.td}>{(() => { const r = valuation?.rows.find(x => x.symbol === p.symbol); return valuation?.complete && r?.value != null ? `${valuation.pct(r.value).toFixed(1)}%` : "—"; })()}</Text>
                </View>
              )) : <View style={{ padding: 16 }}><Text style={s.muted}>{paper ? "No holdings in this practice account." : "No holdings to show."}</Text></View>}
              <View style={s.note2}><Text style={{ fontSize: 15 }}>ⓘ</Text><Text style={[s.muted, { flex: 1 }]}>Values use delayed, informational prices, not a licensed feed. Holdings come from your practice account, and from a read-only broker later.</Text></View>
            </Card>
            <Card>
              <Text style={s.h2}>Strategies and backtests</Text>
              {ent ? <Para>{ent.backtesting ? `Your plan: up to ${ent.maximumBacktestBars.toLocaleString()} daily bars, ${ent.maximumBacktestRunsPerDay} runs a day${daily ? ` (${daily.backtest.used} used today)` : ""}.` : "Backtesting needs the Plus plan or higher."}</Para> : null}
              <Para>Backtests stay unavailable until a licensed data source is connected. Simulated and real-money orders are both switched off on the server.</Para>
            </Card>
            <Pressable accessibilityRole="button" style={s.refresh} onPress={() => setRefreshKey(x => x + 1)}><Text style={s.link}>Refresh AZTrade</Text></Pressable>
          </> : null}

          {section === "More" ? (detail ? <>
            <Pressable accessibilityRole="button" accessibilityLabel="Back to More" onPress={() => setDetail(null)} style={s.rowWrap}><Text style={s.link}>‹ More</Text><Text style={s.h2}>{DETAIL_TITLES[detail]}</Text></Pressable>
            {detail === "monitor" ? <MonitorPanel palette={P} seed={monitorSeed} watchSymbols={watch} onCount={setMonitorCount} /> : null}
            {detail === "strategies" ? <Card>
              <Para>Strategy research turns an idea into rules you can test on past prices. It needs a licensed historical-data source, which isn't connected yet.</Para>
              {ent ? <Para>{ent.backtesting ? `Your plan will include up to ${ent.maximumBacktestBars.toLocaleString()} daily bars and ${ent.maximumBacktestRunsPerDay} runs a day.` : "Strategy testing will need the Plus plan or higher."}</Para> : null}
              <Para>Until then, use AI Research to learn how strategies work and what their risks are.</Para>
            </Card> : null}
            {detail === "backtests" ? <Card>
              <Para>Backtests stay unavailable until a licensed data source is connected. Nothing is simulated from made-up prices.</Para>
              {ent ? <Para>{ent.backtesting ? `Your plan: up to ${ent.maximumBacktestBars.toLocaleString()} daily bars, ${ent.maximumBacktestRunsPerDay} runs a day${daily ? ` (${daily.backtest.used} used today)` : ""}.` : "Backtesting needs the Plus plan or higher."}</Para> : null}
            </Card> : null}
            {detail === "risk" ? <Card>
              {valuation ? <>
                <Para>{valuation.complete ? "Valuation complete, using delayed, informational prices." : `Incomplete: no price for ${valuation.missing.slice(0, 20).join(", ")}, so no totals are shown.`}</Para>
                {valuation.complete ? <Text style={[s.body, { color: P.ink }]}>{`Total value: ${money(valuation.total)}\n${valuation.largest != null ? `Largest position: ${valuation.largest.toFixed(1)}%\n` : "No positions to measure for concentration.\n"}${Object.entries(valuation.byClass).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${valuation.pct(v).toFixed(1)}%`).join("\n")}`}</Text> : null}
                <Para>These figures are research aids, not licensed valuations, and no trading signal uses them.</Para>
              </> : <Para>Risk metrics are unavailable until your practice account loads.</Para>}
            </Card> : null}
            {detail === "broker" ? <Card>
              <Para>Read-only broker connections are planned. They would let you see holdings from a supported broker without any ability to trade or withdraw.</Para>
              <Para>They aren't available yet, and AZTrade doesn't ask for any broker login or credentials today.</Para>
            </Card> : null}
            {detail === "subscription" ? <Card>
              <View style={s.line}><Text style={s.kvKey}>Plan</Text><Text style={s.td}>{ent ? `${ent.plan} (${ent.tier})` : "—"}</Text></View>
              <View style={s.line}><Text style={s.kvKey}>AI questions today</Text><Text style={s.td}>{daily ? `${daily.research.used} of ${daily.research.limit}` : "—"}</Text></View>
              <View style={s.line}><Text style={s.kvKey}>Backtest runs today</Text><Text style={s.td}>{ent?.backtesting && daily ? `${daily.backtest.used} of ${daily.backtest.limit}` : "Not on your plan"}</Text></View>
              <Para>Your plan and usage come from your A-Zee account, so they match what you see on the website.</Para>
              <Pressable accessibilityRole="button" onPress={() => router.navigate("/account")} style={[s.askBtn, { marginLeft: 0 }]}><Text style={s.askText}>Manage plan in Account</Text></Pressable>
            </Card> : null}
            {detail === "help" ? <View style={{ gap: 10 }}>{FAQ.map(([q, a]) => <Card key={q}><Text style={s.h3}>{q}</Text><Para>{a}</Para></Card>)}</View> : null}
          </> : <>
            {MENU.map(m => (
              <Pressable key={m.key} accessibilityRole="button" accessibilityLabel={`${m.title}, ${m.badge}`} onPress={m.onPress} style={[s.card, s.menuRow]}>
                <View style={s.menuIcon}><Text style={{ fontSize: 20, color: P.blue }}>{m.glyph}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.menuTitle}>{m.title}</Text>
                  <Text style={s.muted}>{m.sub}</Text>
                </View>
                <Text style={[s.pillBadge, m.tone === "ok" && s.badgeOk, m.tone === "plan" && s.badgePlan, m.tone === "neutral" && s.badgeNeutral]} numberOfLines={1}>{m.badge}</Text>
                <Text style={{ color: P.muted, fontSize: 20 }}>›</Text>
              </Pressable>
            ))}
            <View style={s.tradingStatus}>
              <Text style={{ fontSize: 18 }}>ⓘ</Text>
              <View style={{ flex: 1 }}>
                <View style={s.rowBetween}><Text style={s.h2}>Trading Status</Text><Text style={s.outlinePill}>Trading Disabled</Text></View>
                <Text style={s.muted}>Real-money trading is not enabled, and simulated orders are off too. AZTrade AI currently provides market research, analysis and portfolio intelligence only.</Text>
              </View>
            </View>
          </>) : null}

          <Text style={s.disclaimer}>AZTrade AI provides research and educational information, not guaranteed returns or trade execution.</Text>
        </ScrollView>

        <View style={s.nav}>
          {NAV.map(n => {
            const on = section === n.key;
            if (n.key === "AI") return (
              <Pressable key={n.key} accessibilityRole="button" accessibilityLabel="AI research" accessibilityState={{ selected: on }} onPress={() => { setSection("AI"); setDetail(null); }} style={s.aiWrap}>
                <View style={[s.aiBtn, on && { borderColor: "#9ad3ff", backgroundColor: "#2b9bff" }]}>
                  <Image accessibilityLabel="AZ" source={require("../../../../assets/aztrade-az-white.png")} resizeMode="contain" style={s.aiLogo} />
                </View>
                <Text numberOfLines={1} style={{ fontSize: 9.5, color: on ? "#7fc4ff" : "#9fb3d9", fontWeight: "800", marginTop: 2, letterSpacing: 0.4 }}>AI</Text>
              </Pressable>
            );
            const color = on ? "#ffffff" : "#8fa4cf";
            return (
              <Pressable key={n.key} accessibilityRole="tab" accessibilityLabel={n.label} accessibilityState={{ selected: on }} onPress={() => { setSection(n.key); setDetail(null); }} style={s.navItem}>
                <View style={[s.navPill, on && s.navPillOn]}><NavIcon kind={n.key} color={color} /></View>
                <Text numberOfLines={1} style={{ fontSize: 9.5, color: on ? "#ffffff" : "#8fa4cf", fontWeight: on ? "800" : "600", letterSpacing: 0.2 }}>{n.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: { backgroundColor: P.head, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12, gap: 1 },
  headRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  brandLogo: { width: 32, height: 32, borderRadius: 8, backgroundColor: P.blue, alignItems: "center", justifyContent: "center" },
  brandLogoText: { color: "#fff", fontWeight: "900", fontSize: 13 },
  brand: { color: "#fff", fontSize: 16, fontWeight: "800", letterSpacing: -0.3 },
  planPill: { borderWidth: 1.5, borderColor: "#3b82f6", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: P.head2 },
  planText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  bell: { width: 32, height: 36, alignItems: "center", justifyContent: "center" },
  dot: { position: "absolute", top: 4, right: 5, width: 10, height: 10, borderRadius: 5, backgroundColor: "#3b82f6", borderWidth: 1.5, borderColor: P.head },
  title: { color: "#fff", fontSize: 24, fontWeight: "800", letterSpacing: -0.5 },
  sub: { color: "#c3cff0", fontSize: 12 },
  sheet: { flex: 1, backgroundColor: P.sheet, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  page: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 24, gap: 10 },
  card: { backgroundColor: P.card, borderColor: P.line, borderWidth: 1, borderRadius: 14, padding: 12, gap: 6 },
  statRow: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, padding: 9, gap: 3, minHeight: 104 },
  tile: { width: 28, height: 28, borderRadius: 9, backgroundColor: P.blueDim, alignItems: "center", justifyContent: "center" },
  tileGlyph: { color: P.blue, fontSize: 13, fontWeight: "800" },
  statLabel: { color: P.muted, fontSize: 11, fontWeight: "700" },
  statValue: { color: P.ink, fontSize: 15, fontWeight: "800" },
  statSub: { color: P.muted, fontSize: 10 },
  regime: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowWrap: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  badge: { color: P.warn, backgroundColor: P.warnBg, fontSize: 11, fontWeight: "800", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: "hidden" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  h2: { color: P.ink, fontSize: 15, fontWeight: "800" },
  h3: { color: P.ink, fontSize: 13, fontWeight: "800" },
  muted: { color: P.muted, fontSize: 11.5, lineHeight: 16 },
  body: { color: P.muted, fontSize: 12.5, lineHeight: 18 },
  link: { color: P.blue, fontSize: 12.5, fontWeight: "700" },
  hubBtn: { borderWidth: 1, borderColor: P.line, backgroundColor: P.blueDim, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
  hubText: { color: P.blue, fontSize: 11, fontWeight: "700" },
  inputWrap: { backgroundColor: "#f6f9ff", borderRadius: 14, borderWidth: 1, borderColor: P.line, flexDirection: "row", alignItems: "flex-end", padding: 8, gap: 8 },
  input: { flex: 1, color: P.ink, fontSize: 13, minHeight: 46, maxHeight: 140, paddingHorizontal: 6, textAlignVertical: "top" },
  send: { width: 36, height: 36, borderRadius: 12, backgroundColor: P.blue, alignItems: "center", justifyContent: "center" },
  sendGlyph: { color: "#fff", fontSize: 14 },
  focus: { paddingHorizontal: 12, height: 26, justifyContent: "center", borderRadius: 15, borderWidth: 1, borderColor: P.line, backgroundColor: "#f6f9ff" },
  recent: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12 },
  recentText: { flex: 1, color: P.ink, fontSize: 12.5, lineHeight: 17 },
  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: P.line, minHeight: 44 },
  figure: { color: P.ink, fontSize: 24, fontWeight: "800", letterSpacing: -0.5 },
  error: { backgroundColor: P.errBg, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: "#fecaca" },
  errorText: { color: P.err, fontSize: 12.5, lineHeight: 18 },
  refresh: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  disclaimer: { color: P.muted, fontSize: 10, lineHeight: 14, textAlign: "center" },
  banner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: P.banner, borderRadius: 16, padding: 10 },
  bannerIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  outlineBtn: { borderWidth: 1.5, borderColor: P.blue, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: "#f4f8ff" },
  outlineText: { color: P.blue, fontSize: 11, fontWeight: "800" },
  search: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: P.line, paddingHorizontal: 12 },
  pill: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, height: 34, borderRadius: 12, backgroundColor: "#e6edf9", borderWidth: 1, borderColor: "#e6edf9" },
  quick: { paddingHorizontal: 10, height: 28, justifyContent: "center", borderRadius: 14, borderWidth: 1, borderColor: P.blue, backgroundColor: "#f4f8ff" },
  overview: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#e9f0fc" },
  kv: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6, flexWrap: "wrap" },
  kvKey: { color: P.ink, fontSize: 11, fontWeight: "700" },
  kvPill: { color: P.muted, backgroundColor: "#dde6f6", borderRadius: 10, fontSize: 10, fontWeight: "700", paddingHorizontal: 8, paddingVertical: 3, overflow: "hidden" },
  watchRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 9 },
  logo: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  logoLetter: { color: "#fff", fontSize: 16, fontWeight: "800" },
  sym: { color: P.ink, fontSize: 14, fontWeight: "800" },
  noPrice: { color: P.ink, fontSize: 11, fontWeight: "700" },
  note: { flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: "#e9f0fc", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: P.line },
  nav: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-around", backgroundColor: "#0c1a44", borderRadius: 26, borderWidth: 1, borderColor: "#22356b", paddingTop: 6, paddingBottom: 6, paddingHorizontal: 4, marginHorizontal: 14, marginBottom: 6, marginTop: 4 },
  navItem: { alignItems: "center", gap: 2, minWidth: 56 },
  navPill: { width: 40, height: 26, borderRadius: 13, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  navPillOn: { backgroundColor: "#1f6fe0" },
  aiWrap: { marginTop: -22, alignItems: "center", minWidth: 64 },
  aiBtn: { width: 50, height: 50, borderRadius: 25, backgroundColor: "#1f8fff", alignItems: "center", justifyContent: "center", borderWidth: 2.5, borderColor: "#58b4ff", shadowColor: "#2aa0ff", shadowOpacity: 0.7, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 10 },
  sparkTop: { color: "#e8f4ff", fontSize: 11, lineHeight: 12, marginBottom: -1, letterSpacing: 2 },
  aiLogo: { width: 30, height: 16, flexShrink: 0 },
  aiGlyph: { color: "#fff", fontSize: 19, fontWeight: "900", lineHeight: 21 },
  markImg: { height: 24, width: 45, flexShrink: 0 },
  mark: { fontSize: 30, fontWeight: "900", fontStyle: "italic", letterSpacing: -2, includeFontPadding: false },
  menuRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 9 },
  menuIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: P.blueDim, alignItems: "center", justifyContent: "center" },
  menuTitle: { color: P.ink, fontSize: 14, fontWeight: "800" },
  pillBadge: { color: P.blue, backgroundColor: P.blueDim, borderRadius: 999, fontSize: 10, fontWeight: "800", paddingHorizontal: 9, paddingVertical: 3, overflow: "hidden", maxWidth: 112 },
  badgeOk: { color: "#166534", backgroundColor: "#dcfce7" },
  badgePlan: { color: P.blue, backgroundColor: "#dbe8ff" },
  badgeNeutral: { color: P.muted, backgroundColor: "#e3e8f2" },
  tradingStatus: { flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: "#dce9ff", borderRadius: 16, padding: 12, borderWidth: 1, borderColor: P.line },
  outlinePill: { color: P.blue, borderWidth: 1.5, borderColor: P.blue, borderRadius: 999, fontSize: 10, fontWeight: "800", paddingHorizontal: 8, paddingVertical: 3, overflow: "hidden" },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: P.head2, borderWidth: 1.5, borderColor: "#9fb0dc", alignItems: "center", justifyContent: "center", marginLeft: 2 },
  hero: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 },
  change: { fontSize: 11, fontWeight: "800" },
  heroBars: { position: "absolute", right: 4, bottom: 0, flexDirection: "row", alignItems: "flex-end", gap: 5 },
  heroIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: P.blue, alignItems: "center", justifyContent: "center" },
  heroGlyph: { color: "#fff", fontSize: 24 },
  heroTitle: { color: P.ink, fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  askBtn: { height: 34, paddingHorizontal: 14, borderRadius: 12, backgroundColor: P.blue, alignItems: "center", justifyContent: "center", marginLeft: 8 },
  askText: { color: "#fff", fontSize: 12.5, fontWeight: "800" },
  select: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: P.line, paddingHorizontal: 10, paddingVertical: 10, marginHorizontal: 4 },
  selectIcon: { color: P.blue, fontSize: 18 },
  selectLabel: { color: P.muted, fontSize: 10 },
  selectValue: { color: P.ink, fontSize: 13, fontWeight: "800" },
  option: { paddingHorizontal: 12, paddingVertical: 12 },
  optionText: { color: P.ink, fontSize: 13, fontWeight: "600" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  suggest: { width: "48%", flexGrow: 1, flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  suggestText: { flex: 1, color: P.ink, fontSize: 12.5, fontWeight: "700" },
  sources: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#e6f0ff", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: P.line },
  disclaimerBox: { flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: "#e9f0fc", borderRadius: 12, padding: 12 },
  quota: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10 },
  ring: { width: 46, height: 46, borderRadius: 23, borderWidth: 4, borderColor: P.blueDim, alignItems: "center", justifyContent: "center" },
  ringText: { color: P.ink, fontSize: 11, fontWeight: "800" },
  bar: { height: 5, borderRadius: 3, backgroundColor: P.blueDim, overflow: "hidden", marginTop: 4 },
  barFill: { height: 5, backgroundColor: P.blue },
  connect: { backgroundColor: "#f4f8ff" },
  connectBtn: { backgroundColor: P.blue, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginLeft: 8 },
  bigValue: { color: P.ink, fontSize: 18, fontWeight: "800" },
  donut: { width: 66, height: 66, borderRadius: 33, borderWidth: 10, borderColor: "#cfd9ec", alignItems: "center", justifyContent: "center" },
  donutText: { color: P.muted, fontSize: 9, textAlign: "center", fontWeight: "600" },
  legend: { color: P.ink, fontSize: 10.5, fontWeight: "600" },
  gauge: { height: 64, marginVertical: 6, borderTopLeftRadius: 64, borderTopRightRadius: 64, borderWidth: 10, borderBottomWidth: 0, borderColor: "#cfd9ec", alignItems: "center", justifyContent: "flex-end", paddingBottom: 2 },
  gaugeText: { color: P.ink, fontSize: 16, fontWeight: "800" },
  th: { flexDirection: "row", backgroundColor: "#eef3fc", paddingHorizontal: 12, paddingVertical: 6 },
  thText: { flex: 1, color: P.ink, fontSize: 10, fontWeight: "800" },
  tr: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.line },
  td: { flex: 1, color: P.ink, fontSize: 12, fontWeight: "600" },
  logoSm: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  note2: { flexDirection: "row", gap: 8, alignItems: "flex-start", backgroundColor: "#e9f0fc", margin: 10, borderRadius: 10, padding: 10 },
});
