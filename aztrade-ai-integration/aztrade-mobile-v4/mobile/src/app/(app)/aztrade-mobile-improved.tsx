import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { createAZTradeClient, AZTradeError, type Capabilities, type PaperAccount, type ResearchMessage } from "@/lib/aztrade";

type Section = "Overview" | "AI Research" | "Portfolio" | "Markets" | "Risk" | "Connections";
const sections: Section[] = ["Overview", "AI Research", "Portfolio", "Markets", "Risk", "Connections"];
const markets = ["Stocks", "ETFs", "Crypto", "Forex", "Commodities", "Options", "Futures"];
const errorText = (error: unknown) => {
  if (error instanceof AZTradeError) {
    if (error.status === 401) return "A-Zee or AZTrade authorization expired. Sign in again if the problem persists.";
    if (error.status === 403) return "Your current subscription does not permit this feature.";
    if (error.status === 429) return "Your request limit has been reached. Try again later.";
    if (error.status === 503 || error.status === 502 || error.status === 0) return "AZTrade is temporarily unavailable. Check the server connection.";
    return `AZTrade request failed (${error.code}).`;
  }
  return "AZTrade is unavailable right now.";
};
const safeText = (x: unknown) => typeof x === "string" ? x : "Unavailable";
const isHistory = (x: unknown): x is ResearchMessage[] => Array.isArray(x) && x.every(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string");

export default function AZTradeMobileScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { user } = useAuth();
  const client = useMemo(createAZTradeClient, [user?.id]);
  const [section, setSection] = useState<Section>("Overview");
  const [access, setAccess] = useState<Capabilities | null>(null);
  const [paper, setPaper] = useState<PaperAccount | null>(null);
  const [risk, setRisk] = useState<unknown>(null);
  const [history, setHistory] = useState<ResearchMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setPaper(null); setRisk(null); setHistory([]); setAccess(null);
    async function load() {
      try {
        const caps = await client.capabilities(controller.signal);
        if (controller.signal.aborted) return;
        setAccess(caps);
        // Each service failure is isolated; account research still works when backend :4010 is offline.
        const [accountResult, riskResult, historyResult] = await Promise.allSettled([
          client.paper(controller.signal), client.risk(controller.signal), client.history(controller.signal),
        ]);
        if (controller.signal.aborted) return;
        if (accountResult.status === "fulfilled" && typeof accountResult.value?.accountId === "string") setPaper(accountResult.value);
        if (riskResult.status === "fulfilled") setRisk(riskResult.value);
        if (historyResult.status === "fulfilled" && isHistory(historyResult.value)) setHistory(historyResult.value);
        if (accountResult.status === "rejected") setNote("Practice portfolio is not connected.");
      } catch (e) { if (!controller.signal.aborted) setError(errorText(e)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => { controller.abort(); activeRequest.current?.abort(); client.clear(); };
  }, [client, refreshKey]);

  const ask = useCallback(async () => {
    const prompt = question.trim();
    if (!access?.capabilities.researchAssistant || !prompt || busy || prompt.length > 4000) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    setBusy(true); setError(""); setAnswer("");
    const requestId = Crypto.randomUUID(); // secure UUID, stable across internal auth retry
    try {
      const response = await client.research(requestId, prompt, controller.signal);
      if (controller.signal.aborted) return;
      if (typeof response.reply !== "string" || !response.reply.trim()) throw new Error("Invalid reply");
      setAnswer(response.reply);
      setHistory(items => [...items, { role: "user", content: prompt }, { role: "assistant", content: response.reply }].slice(-50));
    } catch (e) { if (!controller.signal.aborted) setError(errorText(e)); }
    finally { if (!controller.signal.aborted) setBusy(false); activeRequest.current = null; }
  }, [access, question, busy, client]);

  const palette = { bg: theme.bg, card: theme.card, border: theme.line, text: theme.ink, muted: theme.muted, accent: theme.accent, accentInk: theme.accentInk };
  const box = (title: string, children: React.ReactNode) => (
    <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <Text accessibilityRole="header" style={[styles.cardTitle, { color: palette.text }]}>{title}</Text>
      {children}
    </View>
  );
  const paragraph = (s: string) => <Text style={[styles.body, { color: palette.muted }]}>{s}</Text>;
  const statusCard = (title: string, value: string) => (
    <View style={[styles.metric, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <Text style={[styles.metricTitle, { color: palette.muted }]}>{title}</Text>
      <Text style={[styles.metricValue, { color: palette.text }]} numberOfLines={2}>{value}</Text>
    </View>
  );

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: palette.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
          <View style={styles.topRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="Back to A-Zee" onPress={() => router.back()} style={styles.back}><Text style={{ color: palette.accent, fontWeight: "600" }}>‹ A-Zee</Text></Pressable>
            <Text style={[styles.plan, { color: palette.muted }]}>{access ? `${access.plan} · ${access.tier}` : "A-Zee account"}</Text>
          </View>
          <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>AZTrade AI</Text>
          {paragraph("Your multi-market research and portfolio companion")}
          <View style={styles.badges}>
            <Text style={styles.chip}>AI Research</Text>
            <Text style={[styles.chip, styles.warningChip]}>Trading disabled</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} accessibilityLabel="AZTrade sections">
            {sections.map(s => <Pressable key={s} accessibilityRole="tab" accessibilityState={{ selected: section === s }} onPress={() => setSection(s)} style={[styles.tab, { borderColor: palette.border, backgroundColor: section === s ? palette.accent : palette.card }]}>
              <Text style={{ color: section === s ? palette.accentInk : palette.text, fontWeight: "600" }}>{s}</Text>
            </Pressable>)}
          </ScrollView>
          {loading && <ActivityIndicator accessibilityLabel="Loading AZTrade" color={palette.accent} size="large" style={{ margin: 18 }} />}
          {!!error && <View accessibilityRole="alert" style={styles.error}><Text style={styles.errorText}>{error}</Text></View>}
          {!loading && <>
            {section === "Overview" && <>
              <View style={styles.metrics}>
                {statusCard("Practice cash", paper ? safeText(paper.cash) : "Not connected")}
                {statusCard("Positions", paper ? String(paper.positions?.length ?? 0) : "Not connected")}
                {statusCard("Market data", access?.capabilities.marketData === "licensed" ? "Licensed" : "Unavailable")}
                {statusCard("Brokers", access?.capabilities.brokerConnections === "read_only" ? "Read-only available" : "Not connected")}
              </View>
              {box("AZTrade AI research", <>
                {paragraph("Explore asset risks, market concepts, and your authorized practice-account data.")}
                <Pressable accessibilityRole="button" style={[styles.action, { backgroundColor: palette.accent }]} onPress={() => setSection("AI Research")}><Text style={{ color: palette.accentInk, fontWeight: "700" }}>Ask AZTrade AI</Text></Pressable>
              </>)}
              {box("Data availability", paragraph(note || "No verified market prices are available until an approved data source is connected."))}
            </>}
            {section === "AI Research" && <>
              {box("Ask AZTrade AI", <>
                {paragraph("Research and education only. No live quotes, news, or unverified prices will be invented.")}
                <TextInput multiline value={question} onChangeText={setQuestion} maxLength={4000} accessibilityLabel="Research question" placeholder="Explain the risks of holding stocks and crypto…" placeholderTextColor={palette.muted} style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.bg }]} />
                <Pressable disabled={!access?.capabilities.researchAssistant || !question.trim() || busy} accessibilityRole="button" accessibilityState={{ disabled: !access?.capabilities.researchAssistant || !question.trim() || busy }} onPress={() => void ask()} style={[styles.action, { backgroundColor: palette.accent, opacity: busy || !question.trim() || !access?.capabilities.researchAssistant ? 0.55 : 1 }]}>
                  {busy ? <ActivityIndicator color={palette.accentInk} /> : <Text style={{ color: palette.accentInk, fontWeight: "700" }}>Analyze with AI</Text>}
                </Pressable>
                {busy && <Pressable accessibilityRole="button" onPress={() => { activeRequest.current?.abort(); setBusy(false); }} style={styles.cancel}><Text style={{ color: palette.accent }}>Cancel</Text></Pressable>}
              </>)}
              {!!answer && box("AI response", <Text selectable style={[styles.body, { color: palette.text }]}>{answer}</Text>)}
              {box("Recent research", history.length ? <>{history.slice(-10).map((m,i) => <View key={i} style={{ marginTop: 10 }}><Text style={{ color: palette.muted, fontSize: 12 }}>{m.role === "user" ? "You" : "AZTrade AI"}</Text><Text style={{ color: palette.text, lineHeight: 21 }}>{m.content}</Text></View>)}</> : paragraph("No research history available."))}
            </>}
            {section === "Portfolio" && <>
              {box("Practice portfolio", paper ? <>
                <Text style={[styles.figure, { color: palette.text }]}>{safeText(paper.cash)}</Text>
                {paragraph("Simulated cash only. Values are not real funds.")}
                {(paper.positions || []).map((position, i) => <View key={`${position.symbol}-${i}`} style={[styles.position, { borderColor: palette.border }]}><Text style={{ color: palette.text, fontWeight: "600" }}>{position.symbol}</Text><Text style={{ color: palette.muted }}>Quantity: {safeText(position.shares)}</Text></View>)}
                {!paper.positions?.length && paragraph("No positions in this practice account.")}
              </> : paragraph("Your practice portfolio is unavailable until the AZTrade backend is connected."))}
              {box("Broker holdings", paragraph("Real brokerage portfolios require separately approved read-only connections."))}
            </>}
            {section === "Markets" && <>
              {box("Explore markets", <>
                {markets.map(m => <View key={m} style={[styles.marketRow, { borderColor: palette.border }]}><Text style={{ color: palette.text, fontWeight: "600" }}>{m}</Text><Text style={{ color: palette.muted, fontSize: 12 }}>Education only</Text></View>)}
              </>)}
              {box("Market data", paragraph("No licensed price feed is connected. Live quotes and actionable signals are disabled."))}
            </>}
            {section === "Risk" && <>
              {box("Risk intelligence", risk ? <Text selectable style={[styles.body, { color: palette.text }]}>{JSON.stringify(risk, null, 2).slice(0, 6000)}</Text> : paragraph("Risk metrics are unavailable until authorized portfolio data is loaded."))}
              {box("Research guidance", paragraph("Diversification, position sizing, volatility and drawdown should be evaluated using verified holdings and approved market data."))}
            </>}
            {section === "Connections" && <>
              {box("Broker connections", paragraph("Read-only broker OAuth integrations are not configured. AZTrade will not request trading or withdrawal permissions."))}
              {box("Strategies and backtests", paragraph("Historical backtesting stays unavailable until a licensed data source and tested backtest engine are certified."))}
              {box("Trading permissions", paragraph("Both simulated order execution and real-money trading are disabled at the backend, regardless of subscription."))}
            </>}
            <Pressable accessibilityRole="button" style={styles.refresh} onPress={() => setRefreshKey(x => x + 1)}><Text style={{ color: palette.accent, fontWeight: "600" }}>Refresh AZTrade</Text></Pressable>
          </>}
          <Text style={[styles.disclaimer, { color: palette.muted }]}>AZTrade AI provides research and educational information, not guaranteed returns or trade execution.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 18, paddingBottom: 40, gap: 16 },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  back: { minHeight: 44, justifyContent: "center", paddingRight: 12 },
  plan: { fontSize: 12, fontWeight: "600", opacity: 0.8 },
  title: { fontSize: 28, fontWeight: "800", letterSpacing: -0.6, marginBottom: 2 },
  body: { fontSize: 15, lineHeight: 22, marginTop: 4 },
  badges: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, fontWeight: "700", fontSize: 12, overflow: "hidden" },
  warningChip: { },
  tabs: { flexDirection: "row", gap: 8, paddingVertical: 4 },
  tab: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, borderWidth: 1, minHeight: 40, justifyContent: "center", alignItems: "center" },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  metric: { width: "47%", flexGrow: 1, minHeight: 100, borderWidth: 1, borderRadius: 16, padding: 16, justifyContent: "space-between", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  metricTitle: { fontSize: 13, fontWeight: "600", opacity: 0.7 },
  metricValue: { fontSize: 20, fontWeight: "800", letterSpacing: -0.3, marginTop: 8 },
  card: { borderWidth: 1, borderRadius: 18, padding: 18, gap: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  cardTitle: { fontSize: 17, fontWeight: "700", letterSpacing: -0.2 },
  action: { marginTop: 12, paddingVertical: 15, borderRadius: 14, alignItems: "center", justifyContent: "center", minHeight: 52, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 6, elevation: 3 },
  input: { borderWidth: 1.5, borderRadius: 14, padding: 14, marginTop: 8, fontSize: 15, minHeight: 120, textAlignVertical: "top" },
  cancel: { alignItems: "center", padding: 12, minHeight: 44 },
  error: { backgroundColor: "#FEE2E2", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#FECACA" },
  errorText: { color: "#991B1B", fontSize: 14, lineHeight: 20 },
  figure: { fontSize: 28, fontWeight: "800", letterSpacing: -0.5 },
  position: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  marketRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 52, paddingVertical: 4 },
  refresh: { minHeight: 52, alignItems: "center", justifyContent: "center", marginTop: 8 },
  disclaimer: { fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 8, opacity: 0.7 },
});
