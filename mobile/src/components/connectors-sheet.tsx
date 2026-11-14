import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/lib/api";
import { C } from "@/lib/chat-theme";

type OAuthStatus = { provider: string; configured?: boolean; connected?: boolean };
type ImapProvider = "yahoo" | "icloud";
type ImapAccount = { provider: ImapProvider; email: string };

// Gmail connects with Google's sign-in page. Yahoo and iCloud have no mail sign-in for apps, so they use an
// app-specific password the user creates in their account. Outlook/Hotmail is not available yet.
const IMAP: Record<ImapProvider, { name: string; glyph: string; placeholder: string; help: string; helpUrl: string }> = {
  yahoo: { name: "Yahoo Mail", glyph: "📬", placeholder: "you@yahoo.com", help: "Create an app password in Yahoo Account Security → Generate app password.", helpUrl: "https://login.yahoo.com/account/security" },
  icloud: { name: "iCloud Mail", glyph: "☁️", placeholder: "you@icloud.com", help: "Create an app-specific password at appleid.apple.com → Sign-In and Security.", helpUrl: "https://appleid.apple.com/account/manage" },
};

const IMAP_ERRORS: Record<string, string> = {
  IMAP_AUTH_FAILED: "That email or app password was not accepted. Use an app-specific password, not your normal one.",
  IMAP_UNREACHABLE: "Couldn't reach the mail server. Try again in a moment.",
  EXTERNAL_DATA_DISABLED: "This server is in private mode, which blocks connecting outside mail.",
  CONNECTOR_KEY_MISSING: "The server isn't set up to store mail logins yet.",
};

function ImapForm({ provider, onClose, onDone }: { provider: ImapProvider | null; onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setEmail(""); setPassword(""); setError(""); }, [provider]);
  if (!provider) return null;
  const d = IMAP[provider];

  async function submit() {
    if (busy || !email.trim() || !password.trim()) return;
    setBusy(true); setError("");
    try {
      await api("/api/connectors/imap", { method: "POST", body: { provider, email: email.trim(), appPassword: password } });
      setPassword(""); onDone(); onClose();
    } catch (e) {
      const code = (e as { code?: string }).code ?? "";
      setError(IMAP_ERRORS[code] ?? (e as Error).message);
    } finally { setBusy(false); }
  }

  const field = { color: C.ink, backgroundColor: C.bg, borderColor: C.line, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 16 } as const;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: 20 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}>
          <View style={{ backgroundColor: C.surface, borderRadius: 24, padding: 20, gap: 12 }}>
            <Text style={{ color: C.ink, fontSize: 18, fontWeight: "700" }}>{d.glyph}  Connect {d.name}</Text>
            <Text style={{ color: C.muted, fontSize: 13, lineHeight: 18 }}>{d.help}</Text>
            <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(d.helpUrl)}><Text style={{ color: C.accentGreen, fontSize: 13 }}>Open that page</Text></Pressable>
            <TextInput accessibilityLabel="Email address" value={email} onChangeText={setEmail} placeholder={d.placeholder} placeholderTextColor={C.muted}
              autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" editable={!busy} style={field} />
            <TextInput accessibilityLabel="App-specific password" value={password} onChangeText={setPassword} placeholder="xxxx-xxxx-xxxx-xxxx" placeholderTextColor={C.muted}
              autoCapitalize="none" autoCorrect={false} secureTextEntry textContentType="password" editable={!busy} style={field} />
            <Text style={{ color: C.muted, fontSize: 12 }}>🔒 Read-only. Your login is encrypted on the server and deleted when you disconnect.</Text>
            {error ? <Text accessibilityRole="alert" style={{ color: C.danger, fontSize: 13 }}>{error}</Text> : null}
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 10, paddingTop: 4 }}>
              <Pressable accessibilityRole="button" onPress={onClose} disabled={busy} style={{ height: 44, paddingHorizontal: 18, justifyContent: "center" }}><Text style={{ color: C.muted, fontSize: 15 }}>Cancel</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityState={{ busy, disabled: busy || !email.trim() || !password.trim() }} onPress={() => void submit()} disabled={busy || !email.trim() || !password.trim()}
                style={{ height: 44, paddingHorizontal: 20, borderRadius: 22, backgroundColor: C.ink, alignItems: "center", justifyContent: "center", opacity: busy || !email.trim() || !password.trim() ? 0.5 : 1 }}>
                {busy ? <ActivityIndicator color={C.bg} /> : <Text style={{ color: C.bg, fontSize: 15, fontWeight: "600" }}>Verify & connect</Text>}
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Bottom sheet opened by the Connectors chip. */
export function ConnectorsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [oauth, setOauth] = useState<Record<string, OAuthStatus>>({});
  const [imap, setImap] = useState<Partial<Record<ImapProvider, string>>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState<ImapProvider | null>(null);

  const load = useCallback(() => {
    api<OAuthStatus[] | { data: OAuthStatus[] }>("/api/connectors")
      .then(r => { const rows = Array.isArray(r) ? r : r.data; setOauth(Object.fromEntries(rows.map(s => [s.provider, s]))); })
      .catch(() => undefined);
    api<{ accounts: ImapAccount[] }>("/api/connectors/imap")
      .then(r => setImap(Object.fromEntries(r.accounts.map(a => [a.provider, a.email]))))
      .catch(() => undefined);
  }, []);

  useEffect(() => { if (visible) { setError(""); load(); } }, [visible, load]);

  async function connectGmail() {
    setBusy("gmail"); setError("");
    try {
      const r = await api<{ url: string }>("/api/connectors/gmail/connect", { method: "POST" });
      await Linking.openURL(r.url); // Google's consent page opens in the browser
      onClose();
    } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }

  function disconnectImap(provider: ImapProvider) {
    Alert.alert(`Disconnect ${IMAP[provider].name}?`, "Your saved login is deleted from the server.", [
      { text: "Cancel", style: "cancel" },
      { text: "Disconnect", style: "destructive", onPress: async () => {
        setBusy(provider); setError("");
        try { await api(`/api/connectors/imap?provider=${provider}`, { method: "DELETE" }); setImap(m => { const n = { ...m }; delete n[provider]; return n; }); }
        catch (e) { setError((e as Error).message); } finally { setBusy(""); }
      } },
    ]);
  }

  const row = { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, minHeight: 64 } as const;
  const action = (label: string, onPress: () => void, loading: boolean, off = false) => (
    <Pressable accessibilityRole="button" disabled={off || busy !== ""} onPress={onPress} hitSlop={8}>
      <Text style={{ color: C.ink, fontSize: 14, fontWeight: "600", opacity: off ? 0.5 : 1 }}>{loading ? "…" : label}</Text>
    </Pressable>
  );

  return (
    <>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
        <Pressable accessibilityLabel="Close" onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)" }} />
        <SafeAreaView edges={["bottom"]} style={{ backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8 }}>
          <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: C.pill, marginBottom: 12 }} />
          <Text style={{ color: C.ink, fontSize: 20, fontWeight: "700", paddingHorizontal: 20 }}>Connectors</Text>
          <Text style={{ color: C.muted, fontSize: 14, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 10 }}>Let A-Zee read your email. Access is read-only.</Text>

          <View style={row}>
            <Text style={{ fontSize: 26 }}>✉️</Text>
            <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontSize: 16, fontWeight: "600" }}>Gmail</Text><Text style={{ color: C.muted, fontSize: 13 }}>{oauth.gmail?.connected ? "Connected" : "Search and summarize your email"}</Text></View>
            {oauth.gmail?.connected ? null : action("Connect", () => void connectGmail(), busy === "gmail")}
          </View>

          {(Object.keys(IMAP) as ImapProvider[]).map(p => (
            <View key={p} style={row}>
              <Text style={{ fontSize: 26 }}>{IMAP[p].glyph}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.ink, fontSize: 16, fontWeight: "600" }}>{IMAP[p].name}</Text>
                <Text numberOfLines={1} style={{ color: C.muted, fontSize: 13 }}>{imap[p] ? `Connected · ${imap[p]}` : "Use an app-specific password"}</Text>
              </View>
              {imap[p] ? action("Disconnect", () => disconnectImap(p), busy === p) : action("Connect", () => setForm(p), false)}
            </View>
          ))}

          <View style={{ ...row, opacity: 0.5 }}>
            <Text style={{ fontSize: 26 }}>📨</Text>
            <View style={{ flex: 1 }}><Text style={{ color: C.ink, fontSize: 16, fontWeight: "600" }}>Hotmail / Outlook</Text><Text style={{ color: C.muted, fontSize: 13 }}>Coming soon</Text></View>
          </View>

          {error ? <Text accessibilityRole="alert" style={{ color: C.danger, fontSize: 14, paddingHorizontal: 20, paddingTop: 6 }}>{error}</Text> : null}
          <View style={{ height: 12 }} />
        </SafeAreaView>
      </Modal>
      <ImapForm provider={visible ? form : null} onClose={() => setForm(null)} onDone={load} />
    </>
  );
}
