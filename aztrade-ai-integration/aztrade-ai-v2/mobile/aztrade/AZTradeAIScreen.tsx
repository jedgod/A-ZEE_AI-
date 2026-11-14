import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

/** Host A-Zee app supplies its existing authenticated mobile session. No separate sign-in or storage. */
export type AZTradeAIScreenProps = {
  apiBaseUrl: string; // HTTPS production A-Zee origin, not AZTrade backend :4010
  getAzeeSessionToken(): Promise<string | null>;
  onSignInRequired?(): void;
};

type Access = { plan: string; tier: string };
const UUID = () => {
  // React Native/Expo build must install react-native-get-random-values or expose secure crypto.randomUUID.
  const f = globalThis.crypto?.randomUUID;
  if (!f) throw new Error("Secure request ID generator unavailable");
  return f.call(globalThis.crypto);
};

export default function AZTradeAIScreen({ apiBaseUrl, getAzeeSessionToken, onSignInRequired }: AZTradeAIScreenProps) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState("Checking A-Zee account…");
  const [access, setAccess] = useState<Access | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const origin = apiBaseUrl.replace(/\/$/, "");

  const azeHeaders = useCallback(async () => {
    if (process.env.NODE_ENV === "production" && !origin.startsWith("https://")) throw new Error("HTTPS_REQUIRED");
    const bearer = await getAzeeSessionToken();
    if (!bearer) { onSignInRequired?.(); throw new Error("Sign in to A-Zee to use AZTrade AI"); }
    return { Authorization: `Bearer ${bearer}`, "X-AZ-Client": "mobile" };
  }, [getAzeeSessionToken, onSignInRequired, origin]);

  const obtainTradeToken = useCallback(async (signal: AbortSignal) => {
    const headers = { ...(await azeHeaders()), "Content-Type": "application/json" };
    const result = await fetch(`${origin}/api/aztrade/token`, { method: "POST", headers, body: "{}", signal });
    if (!result.ok) throw new Error(result.status === 401 ? "A-Zee sign-in expired" : "AZTrade access unavailable");
    const data: unknown = await result.json();
    if (!data || typeof data !== "object" || typeof (data as {access_token?:unknown}).access_token !== "string")
      throw new Error("Invalid authorization response");
    return (data as {access_token:string}).access_token;
  }, [azeHeaders, origin]);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`${origin}/api/aztrade/capabilities`, { headers: await azeHeaders(), signal: controller.signal });
        if (!response.ok) throw new Error("AZTrade AI currently unavailable");
        const body = await response.json() as Access;
        if (mounted.current && !controller.signal.aborted) { setAccess(body); setStatus("AI educational research available; no verified market prices."); }
      } catch (error) { if (mounted.current && !controller.signal.aborted) setStatus(error instanceof Error ? error.message : "Unavailable"); }
    })();
    return () => { mounted.current = false; controller.abort(); abort.current?.abort(); };
  }, [azeHeaders, origin]);

  async function submit() {
    if (busy || !question.trim()) return;
    setBusy(true); setAnswer(""); setStatus("Consulting A-Zee AI…");
    const controller = new AbortController(); abort.current = controller;
    const requestId = UUID(); // Preserve this ID across an auth-refresh retry.
    try {
      const token = await obtainTradeToken(controller.signal);
      const send = async (t: string) => fetch(`${origin}/api/aztrade/companion?resource=assistant/chat`, {
        method: "POST", signal: controller.signal,
        headers: { ...(await azeHeaders()), "X-AZTrade-Token": `Bearer ${t}`, "Content-Type": "application/json" },
        body: JSON.stringify({requestId, message: question.trim()})
      });
      let result = await send(token);
      if (result.status === 401) result = await send(await obtainTradeToken(controller.signal));
      const data = await result.json() as { reply?:unknown; error?:string };
      if (!result.ok) throw new Error(data.error || "Research unavailable");
      if (typeof data.reply !== "string") throw new Error("Invalid research reply");
      if (mounted.current) { setAnswer(data.reply); setStatus("Educational AI response; verify facts independently."); }
    } catch (error) { if (!controller.signal.aborted && mounted.current) setStatus(error instanceof Error ? error.message : "Unavailable"); }
    finally { if (mounted.current) setBusy(false); abort.current = null; }
  }

  return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <Text style={styles.title}>AZTrade AI</Text>
    <Text style={styles.subtitle}>Multi-market intelligence · Research only</Text>
    <View style={styles.warning}><Text style={styles.warningText}>Paper execution and real-money trading are disabled.</Text></View>
    <Text accessibilityRole="text" style={styles.status}>{status}</Text>
    {access && <Text style={styles.plan}>A-Zee subscription: {access.plan} · {access.tier}</Text>}
    <View style={styles.card}>
      <Text style={styles.heading}>Ask AZTrade AI</Text>
      <Text style={styles.description}>Discuss market concepts, allocation risks, and your authorized paper-account data. Live prices and brokerage accounts are not available.</Text>
      <TextInput accessibilityLabel="Market research question" style={styles.input} multiline maxLength={4000} value={question} onChangeText={setQuestion} placeholder="Explain the risks of holding crypto and stocks…" placeholderTextColor="#64748b" />
      <Pressable accessibilityRole="button" disabled={busy || !question.trim() || !access} style={[styles.button, (busy || !question.trim() || !access) && styles.disabled]} onPress={submit}>
        {busy ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Analyze with AI</Text>}
      </Pressable>
      {busy && <Pressable accessibilityRole="button" onPress={() => { abort.current?.abort(); setBusy(false); }}><Text style={styles.cancel}>Cancel request</Text></Pressable>}
      {!!answer && <Text selectable style={styles.answer}>{answer}</Text>}
    </View>
    <View style={styles.card}><Text style={styles.heading}>Explore markets</Text><Text style={styles.description}>Stocks · ETFs · Crypto · Forex · Commodities · Options · Futures</Text><Text style={styles.description}>Educational research only. Market-data licensing is pending.</Text></View>
    <View style={styles.card}><Text style={styles.heading}>Broker connectivity</Text><Text style={styles.description}>Read-only partner authorization not yet configured.</Text></View>
    <Text style={styles.footer}>AZTrade AI does not provide guaranteed returns or place trades.</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingBottom: 50, backgroundColor: "#f6f8fb", flexGrow: 1 },
  title: { fontSize: 28, fontWeight: "700", color: "#14233c", marginBottom: 4 },
  subtitle: { color: "#475569", marginBottom: 16 },
  warning: { backgroundColor: "#fff1d6", padding: 12, borderRadius: 10, marginBottom: 16 },
  warningText: { color: "#745012", fontWeight: "600" },
  status: { color: "#334155", marginBottom: 10 }, plan: { color: "#475569", marginBottom: 16 },
  card: { backgroundColor: "white", borderRadius: 16, padding: 16, marginBottom: 14, borderColor: "#dbe2ed", borderWidth: 1 },
  heading: { fontSize: 19, fontWeight: "700", color: "#14233c", marginBottom: 8 },
  description: { color: "#475569", lineHeight: 21, marginBottom: 12 },
  input: { minHeight: 110, borderWidth: 1, borderColor: "#94a3b8", borderRadius: 10, padding: 12, textAlignVertical: "top", color: "#14233c", marginBottom: 12 },
  button: { backgroundColor: "#174ea6", padding: 13, borderRadius: 10, alignItems: "center" },
  disabled: { opacity: .45 }, buttonText: { color: "white", fontWeight: "700" },
  cancel: { padding: 10, color: "#174ea6", textAlign: "center" },
  answer: { lineHeight: 23, color: "#1e293b", paddingTop: 16, marginTop: 16, borderTopWidth: 1, borderColor: "#e2e8f0" },
  footer: { fontSize: 12, color: "#64748b" }
});
