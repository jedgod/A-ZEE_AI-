import { useState } from "react";
import { Alert, View } from "react-native";
import { useRouter } from "expo-router";
import { Body, Button, Card, ErrorText, Field, Screen, Title } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/** Required by the App Store and Google Play: a clear, confirmed way to delete the account and its data. */
export default function DeleteAccount() {
  const router = useRouter();
  const { user, forget } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function submit() {
    if (confirm !== "DELETE") { setError("Type DELETE to confirm."); return; }
    Alert.alert("Delete your account?", "This permanently deletes your account and its data. It can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        setBusy(true); setError("");
        try {
          await api("/api/account", { method: "DELETE", body: { password, confirm: "DELETE" } });
          await forget();
          router.replace("/sign-in");
        } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      } },
    ]);
  }

  return (
    <Screen narrow>
      <Title sub={user?.email}>Delete account</Title>
      <Card style={{ marginBottom: 16, gap: 6 }}>
        <Body><Body style={{ fontWeight: "700" }}>Deleted now:</Body> your profile, sign-in details, chats, projects, favorites, prompt library, notifications, saved payment methods, subscription and usage records.</Body>
        <Body>Your plan ends immediately, with no refund for the current period.</Body>
        <Body muted>Kept, no longer linked to you: payment records (accounting rules), and for up to 90 days the technical device signals of an account that used its free allowance, so the free plan can't be reset.</Body>
      </Card>
      <View>
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
        <Field label="Type DELETE to confirm" value={confirm} onChangeText={setConfirm} autoCapitalize="characters" />
        <ErrorText>{error}</ErrorText>
        <Button title="Delete my account" variant="danger" onPress={submit} busy={busy} disabled={!password || !confirm} />
        <Button title="Cancel" variant="ghost" onPress={() => router.back()} style={{ marginTop: 8 }} />
      </View>
    </Screen>
  );
}
