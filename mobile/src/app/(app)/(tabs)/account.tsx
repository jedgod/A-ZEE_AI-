import { useCallback, useState } from "react";
import { Alert, Linking, Platform, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Body, Button, Card, ErrorText, Field, Screen, Title } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

type AccountInfo = { account: { name: string; email: string; planName: string } | null; links: { terms: string | null; privacy: string | null; help: string | null } };

export default function Account() {
  const t = useTheme();
  const router = useRouter();
  const { user, signOut, forget } = useAuth();
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  useFocusEffect(useCallback(() => { api<AccountInfo>("/api/account").then(setInfo).catch(() => undefined); }, []));

  async function changePassword() {
    if (next.length < 12) { setError("Use at least 12 characters for the new password."); return; }
    setBusy(true); setError(""); setNote("");
    try { await api("/api/auth/password", { method: "POST", body: { current, next } }); setCurrent(""); setNext(""); setNote("Password changed. Your other devices were signed out."); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const confirm = (title: string, message: string, action: () => Promise<void>) => Alert.alert(title, message, [{ text: "Cancel", style: "cancel" }, { text: "Continue", onPress: () => void action() }]);
  const link = (label: string, url: string | null | undefined) => url ? <Text accessibilityRole="link" onPress={() => Linking.openURL(url)} style={{ color: t.accent, fontSize: 15, paddingVertical: 6 }}>{label}</Text> : null;

  return (
    <Screen narrow>
      <Title sub={user?.email}>{user?.name ?? "Account"}</Title>
      <Card style={{ marginBottom: 14 }}>
        <Body muted>Plan</Body>
        <Text style={{ color: t.ink, fontSize: 18, fontWeight: "700", marginTop: 2 }}>{info?.account?.planName ?? "…"}</Text>
        <Body muted style={{ marginTop: 8 }}>Plan changes are made on the A-Zee website.</Body>
      </Card>

      <Card style={{ marginBottom: 14 }}>
        <Text style={{ color: t.ink, fontSize: 16, fontWeight: "700", marginBottom: 10 }}>Change password</Text>
        <Field label="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" />
        <Field label="New password (12+ characters)" value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" />
        <ErrorText>{error}</ErrorText>
        {note ? <Body muted style={{ marginBottom: 10 }}>{note}</Body> : null}
        <Button title="Change password" variant="outline" onPress={changePassword} busy={busy} disabled={!current || !next} />
      </Card>

      {Platform.OS === "android" ? <Button title="AZLinqext keyboard" variant="outline" onPress={() => router.push("/keyboard")} style={{ marginBottom: 14 }} /> : null}

      <View style={{ gap: 10, marginBottom: 14 }}>
        <Button title="Sign out" variant="outline" onPress={() => confirm("Sign out?", "You'll need to sign in again on this device.", async () => { await signOut(); router.replace("/sign-in"); })} />
        <Button title="Sign out of all devices" variant="outline" onPress={() => confirm("Sign out everywhere?", "Every device, including this one, will be signed out.", async () => {
          try { await api("/api/auth/logout-all", { method: "POST" }); await forget(); router.replace("/sign-in"); } catch (e) { setError((e as Error).message); }
        })} />
      </View>

      <Card style={{ marginBottom: 14 }}>
        {link("Terms of Service", info?.links.terms)}{link("Privacy Policy", info?.links.privacy)}{link("Help", info?.links.help)}
      </Card>

      <Button title="Delete account…" variant="danger" onPress={() => router.push("/delete-account")} />
    </Screen>
  );
}
