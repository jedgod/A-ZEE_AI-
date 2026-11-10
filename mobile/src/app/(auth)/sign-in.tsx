import { useState } from "react";
import { Linking, Text, View } from "react-native";
import { Link } from "expo-router";
import { Body, Button, ErrorText, Field, Screen, Title } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { API_CONFIGURED, API_URL } from "@/lib/config";
import { useTheme } from "@/lib/theme";

export default function SignIn() {
  const t = useTheme();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (busy) return;
    setBusy(true); setError("");
    try { await signIn(email, password); } // the layout sends them on: to the app, or to verification
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Screen narrow>
      <View style={{ flex: 1, justifyContent: "center", minHeight: 520 }}>
        <Title sub="Welcome back to A-Zee.">Sign in</Title>
        {!API_CONFIGURED && <ErrorText>This build isn't connected to a server (EXPO_PUBLIC_API_URL is not set).</ErrorText>}
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" returnKeyType="next" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={submit} />
        <ErrorText>{error}</ErrorText>
        <Button title="Sign in" onPress={submit} busy={busy} disabled={!email || !password} />
        <Text accessibilityRole="link" onPress={() => Linking.openURL(`${API_URL}/forgot-password`)} style={{ color: t.accent, textAlign: "center", marginTop: 16, fontSize: 15 }}>Forgot your password?</Text>
        <View style={{ marginTop: 24, alignItems: "center" }}>
          <Body muted>New to A-Zee?</Body>
          <Link href="/register" style={{ color: t.accent, fontSize: 16, fontWeight: "600", marginTop: 6 }}>Create an account</Link>
        </View>
      </View>
    </Screen>
  );
}
