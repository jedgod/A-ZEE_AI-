import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { api, ApiError } from "@/lib/api";
import { C } from "@/lib/chat-theme";

export type AssetCategory = "stocks_etfs" | "crypto" | "forex" | "commodities" | "options" | "futures";
export type MarketQuote = {
  symbol: string; assetClass: AssetCategory; price: number | null; currency: string;
  changePercent?: string; provider: string; asOf?: string; details?: Record<string, unknown>; notice?: string;
};

const TABS: { id: AssetCategory; label: string; placeholder: string; quick: string[] }[] = [
  { id: "stocks_etfs", label: "Stocks/ETFs", placeholder: "Ticker (NVDA, SPY, AAPL)", quick: ["NVDA", "SPY", "AAPL", "QQQ"] },
  { id: "crypto", label: "Crypto", placeholder: "Coin (BTC, ETH, SOL)", quick: ["BTC", "ETH", "SOL", "XRP"] },
  { id: "forex", label: "Forex", placeholder: "Pair (EUR/USD)", quick: ["EUR/USD", "GBP/USD", "USD/JPY", "USD/GHS"] },
  { id: "commodities", label: "Commodities", placeholder: "Commodity (GOLD, WTI)", quick: ["GOLD", "SILVER", "WTI", "NATURAL_GAS"] },
  { id: "options", label: "Options", placeholder: "Underlying (SPY, TSLA)", quick: ["SPY", "NVDA", "TSLA", "AMD"] },
  { id: "futures", label: "Futures", placeholder: "Contract (ES, NQ, GC)", quick: ["ES", "NQ", "GC", "CL"] },
];

const MESSAGES: Record<string, string> = {
  PROVIDER_NOT_CONFIGURED: "No data source is set up for this asset class on the server yet.",
  QUOTE_UNAVAILABLE: "No quote came back for that symbol. Check it and try again.",
  INVALID_SYMBOL: "That symbol isn't valid.",
  EXTERNAL_DATA_DISABLED: "Market lookups are turned off while the server is in private (ollama-only) mode.",
  FUTURES_NOT_CONFIGURED: "Futures quotes aren't available yet.",
  RATE_LIMITED: "Too many lookups. Wait a moment.",
};
const explain = (e: unknown) => MESSAGES[(e as ApiError)?.code ?? ""] ?? ((e as Error)?.message || "Couldn't fetch the quote.");

/** Informational quotes for Try Finance, from the signed-in account's own /api/finance/quote. Delayed, unlicensed, not advice. */
export function MarketQuoteCard({ onAsk }: { onAsk: (q: MarketQuote) => void }) {
  const [cls, setCls] = useState<AssetCategory>("stocks_etfs");
  const [symbol, setSymbol] = useState("NVDA");
  const [quote, setQuote] = useState<MarketQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tab = TABS.find(t => t.id === cls) ?? TABS[0];

  async function lookup(override?: string, forClass: AssetCategory = cls) {
    const s = (override ?? symbol).trim().toUpperCase();
    if (!s || busy) return;
    setSymbol(s); setBusy(true); setError("");
    try { setQuote((await api<{ quote: MarketQuote }>("/api/finance/quote", { method: "POST", body: { symbol: s, assetClass: forClass } })).quote); }
    catch (e) { setQuote(null); setError(explain(e)); }
    finally { setBusy(false); }
  }
  const up = quote?.changePercent?.startsWith("+"), down = quote?.changePercent?.startsWith("-");
  const price = quote?.price == null ? "Chain loaded" : `${quote.currency === "USD" ? "$" : ""}${quote.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}${quote.currency !== "USD" ? ` ${quote.currency}` : ""}`;

  return (
    <View style={{ marginHorizontal: 12, marginBottom: 8, padding: 12, borderRadius: 18, backgroundColor: C.surface, gap: 8, flexShrink: 0 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: C.ink, fontSize: 14, fontWeight: "700" }}>📈 A-Zee Markets</Text>
        <Text style={{ color: C.muted, fontSize: 10 }}>Informational · may be delayed</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 6 }} style={{ flexGrow: 0 }}>
        {TABS.map(t => (
          <Pressable key={t.id} accessibilityRole="button" accessibilityState={{ selected: t.id === cls }}
            onPress={() => { setCls(t.id); setSymbol(t.quick[0]); setQuote(null); setError(""); }}
            style={{ paddingHorizontal: 11, height: 28, justifyContent: "center", borderRadius: 14, backgroundColor: t.id === cls ? C.ink : C.pill }}>
            <Text style={{ color: t.id === cls ? C.bg : C.muted, fontSize: 12, fontWeight: "600" }}>{t.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput accessibilityLabel="Symbol" value={symbol} onChangeText={setSymbol} placeholder={tab.placeholder} placeholderTextColor={C.muted} autoCapitalize="characters" autoCorrect={false} maxLength={20}
          returnKeyType="search" onSubmitEditing={() => void lookup()} selectionColor={C.ink}
          style={{ flex: 1, height: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: C.bg, color: C.ink, fontSize: 13, fontWeight: "600" }} />
        <Pressable accessibilityRole="button" onPress={() => void lookup()} disabled={busy || !symbol.trim()}
          style={{ height: 36, paddingHorizontal: 16, borderRadius: 18, backgroundColor: C.ink, alignItems: "center", justifyContent: "center", opacity: busy || !symbol.trim() ? 0.5 : 1 }}>
          {busy ? <ActivityIndicator size="small" color={C.bg} /> : <Text style={{ color: C.bg, fontSize: 13, fontWeight: "700" }}>Quote</Text>}
        </Pressable>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {tab.quick.map(s => (
          <Pressable key={s} accessibilityRole="button" onPress={() => void lookup(s)} style={{ paddingHorizontal: 9, height: 24, justifyContent: "center", borderRadius: 8, backgroundColor: C.pill }}>
            <Text style={{ color: C.ink, fontSize: 11, fontWeight: "600" }}>{s}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <Text accessibilityRole="alert" style={{ color: C.danger, fontSize: 12 }}>⚠ {error}</Text> : null}
      {quote && !error ? (
        <View style={{ padding: 12, borderRadius: 14, backgroundColor: C.bg, gap: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View style={{ flexShrink: 1 }}>
              <Text style={{ color: C.ink, fontSize: 18, fontWeight: "800" }}>{quote.symbol}</Text>
              <Text style={{ color: C.muted, fontSize: 10, marginTop: 2 }}>{quote.assetClass.replace("_", " / ").toUpperCase()} · {quote.provider}{quote.asOf ? ` · ${String(quote.asOf).slice(0, 10)}` : ""}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={{ color: C.ink, fontSize: 18, fontWeight: "800" }}>{price}</Text>
              {quote.changePercent ? <Text style={{ color: up ? C.accentGreen : down ? "#fb7185" : C.muted, fontSize: 12, fontWeight: "700" }}>{quote.changePercent}</Text> : null}
            </View>
          </View>
          {quote.details ? Object.entries(quote.details).filter(([, v]) => v != null && v !== "").slice(0, 6).map(([k, v]) => (
            <Text key={k} style={{ color: C.muted, fontSize: 11 }}>{k}: <Text style={{ color: C.ink }}>{String(v)}</Text></Text>
          )) : null}
          <Pressable accessibilityRole="button" onPress={() => onAsk(quote)} style={{ height: 34, borderRadius: 17, backgroundColor: C.pill, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: C.ink, fontSize: 12, fontWeight: "600" }}>✦ Ask A-Zee AI to analyze {quote.symbol}</Text>
          </Pressable>
          <Text style={{ color: C.muted, fontSize: 10 }}>{quote.notice ?? "Informational only, not investment advice."}</Text>
        </View>
      ) : null}
    </View>
  );
}
