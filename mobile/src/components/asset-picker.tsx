import { useEffect, useMemo, useState } from "react";
import { Pressable, Text as RNText, TextInput as RNTextInput, View, StyleSheet } from "react-native";
import type { ComponentProps } from "react";
import { guessClass, loadCatalog, SYMBOL_PATTERN, type Asset, type CatalogItem } from "@/lib/finance-data";

const Text = (props: ComponentProps<typeof RNText>) => <RNText maxFontSizeMultiplier={1.05} {...props} />;
const TextInput = (props: ComponentProps<typeof RNTextInput>) => <RNTextInput maxFontSizeMultiplier={1.05} {...props} />;

export type PickerPalette = Record<"ink" | "muted" | "blue" | "blueDim" | "line" | "card", string>;
const CLASS_LABEL = { crypto: "Crypto", stocks_etfs: "Stock/ETF", forex: "Forex", commodities: "Commodity" } as const;
const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * A searchable dropdown of the assets the monitoring feed supports. Typing "BTC" shows "BTC-USD · Bitcoin / US Dollar", so the
 * user can see exactly which pair they are choosing. A symbol that is not in the list can still be used as a custom entry.
 */
export function AssetPicker({ palette: P, value, onChange, label = "Asset", onlyWithHistory = false }: { palette: PickerPalette; value: Asset | null; onChange: (a: Asset) => void; label?: string; onlyWithHistory?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => { let alive = true; loadCatalog().then(r => { if (alive) setItems(r); }).catch(() => { if (alive) setFailed(true); }); return () => { alive = false; }; }, []);

  const shown = useMemo(() => {
    const n = norm(q);
    const list = items.filter(i => !onlyWithHistory || i.history);
    if (!n) return list.slice(0, 8);
    const score = (i: CatalogItem) => (norm(i.symbol) === n ? 100 : norm(i.symbol).startsWith(n) ? 80 : norm(i.name).startsWith(n) ? 60 : norm(i.symbol).includes(n) ? 40 : norm(i.name).includes(n) ? 30 : 0);
    return list.map(i => ({ i, s: score(i) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 8).map(x => x.i);
  }, [items, q, onlyWithHistory]);
  const typed = q.trim().toUpperCase();
  const canCustom = SYMBOL_PATTERN.test(typed) && !items.some(i => i.symbol === typed);
  const current = value ? items.find(i => i.symbol === value.symbol) : undefined;
  const pick = (a: Asset) => { onChange(a); setOpen(false); setQ(""); };

  return (
    <View style={{ gap: 4, zIndex: open ? 20 : 0 }}>
      {label ? <Text style={{ color: P.ink, fontSize: 12.5, fontWeight: "800" }}>{label}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value?.symbol ?? "none"}. Tap to search`} onPress={() => setOpen(o => !o)} style={[s.field, { borderColor: open ? P.blue : P.line }]}>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: value ? P.ink : P.muted, fontSize: 13.5, fontWeight: "700" }}>{value ? (current ? current.pair : `${value.symbol} · custom symbol`) : "Search BTC-USD, TSLA, AAPL…"}</Text>
        </View>
        <Text style={{ color: P.muted }}>{open ? "⌃" : "⌄"}</Text>
      </Pressable>
      {open ? (
        <View style={[s.panel, { borderColor: P.line, backgroundColor: P.card }]}>
          <View style={[s.search, { borderColor: P.line }]}>
            <Text style={{ color: P.muted }}>⌕</Text>
            <TextInput autoFocus accessibilityLabel="Search assets" value={q} onChangeText={setQ} autoCapitalize="characters" autoCorrect={false} maxLength={30} placeholder="Type a symbol or name (BTC, tesla, EUR)" placeholderTextColor={P.muted} selectionColor={P.blue} style={{ flex: 1, color: P.ink, fontSize: 13, paddingVertical: 8 }} />
          </View>
          {shown.map(i => (
            <Pressable key={i.symbol} accessibilityRole="button" accessibilityLabel={i.pair} onPress={() => pick({ symbol: i.symbol, assetClass: i.assetClass, name: i.name })} style={s.row}>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: P.ink, fontSize: 13, fontWeight: "800" }}>{i.symbol} <Text style={{ fontWeight: "500", color: P.muted }}>· {i.name}</Text></Text>
                <Text style={{ color: P.muted, fontSize: 10.5 }}>{CLASS_LABEL[i.assetClass]}{i.live ? "" : " · needs a data key on the server"}{i.live && !i.history ? " · no chart history yet" : ""}</Text>
              </View>
              {value?.symbol === i.symbol ? <Text style={{ color: P.blue, fontWeight: "800" }}>✓</Text> : null}
            </Pressable>
          ))}
          {canCustom ? (
            <Pressable accessibilityRole="button" onPress={() => pick({ symbol: typed, assetClass: guessClass(typed) })} style={s.row}>
              <Text style={{ color: P.blue, fontSize: 13, fontWeight: "800" }}>Use “{typed}” as a custom symbol</Text>
            </Pressable>
          ) : null}
          {!shown.length && !canCustom ? <Text style={{ color: P.muted, fontSize: 12, padding: 10 }}>{failed ? "Couldn't load the asset list. Check your connection." : "No match. Try a ticker like TSLA."}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  field: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, height: 42, backgroundColor: "#fff" },
  panel: { borderWidth: 1, borderRadius: 12, padding: 6, gap: 2, elevation: 6, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 8 },
  search: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, marginBottom: 4, backgroundColor: "#f6f9ff" },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8 },
});
