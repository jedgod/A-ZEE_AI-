import { useEffect, useState } from "react";
import { AppState, View } from "react-native";
import { useRouter } from "expo-router";
import { Body, Button, Card, ErrorText, Screen, Title } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/** Shown after sign-up until the emailed link has been opened (in the phone's browser). */
export default function Verify() {
  const router = useRouter();
  const { user, refresh, signOut } = useAuth();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // When the person comes back to the app after tapping the link, check again.
  useEffect(() => {
    const sub = AppState.addEventListener("change", state => { if (state === "active") void refresh(); });
    return () => sub.remove();
  }, [refresh]);
  useEffect(() => { if (!user) router.replace("/sign-in"); }, [user, router]);

  async function resend() {
    setBusy(true); setError(""); setNote("");
    try { await api("/api/auth/resend-verification", { method: "POST" }); setNote("A new link is on its way."); }
    catch (e) { setError(e instanceof ApiError && e.code === "RATE_LIMITED" ? "Wait a minute before asking again." : (e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Screen narrow>
      <View style={{ flex: 1, justifyContent: "center", minHeight: 480, gap: 12 }}>
        <Title sub={user ? `We sent a link to ${user.email}.` : undefined}>Check your inbox</Title>
        <Card><Body>Open the link in that email to finish setting up your account, then come back here. Until then you can't use chats, favorites or your library.</Body></Card>
        <ErrorText>{error}</ErrorText>
        {note ? <Body muted>{note}</Body> : null}
        <Button title="I've verified my email" onPress={async () => { setBusy(true); await refresh(); setBusy(false); }} busy={busy} />
        <Button title="Send a new link" variant="outline" onPress={resend} disabled={busy} />
        <Button title="Use a different account" variant="ghost" onPress={async () => { await signOut(); router.replace("/sign-in"); }} />
      </View>
    </Screen>
  );
}
