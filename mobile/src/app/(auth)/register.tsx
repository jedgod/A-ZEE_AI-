import { useState } from "react";
import { View } from "react-native";
import { Link } from "expo-router";
import { Body, Button, ErrorText, Field, Screen, Title } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

export default function Register() {
  const t = useTheme();
  const { register } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (busy) return;
    if (password.length < 12) { setError("Use at least 12 characters for your password."); return; }
    setBusy(true); setError("");
    try { await register(name, email, password); } // the layout sends them to email verification
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Screen narrow>
      <View style={{ flex: 1, justifyContent: "center", minHeight: 560 }}>
        <Title sub="Chats, favorites and your prompt library are saved to your account.">Create your account</Title>
        <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" autoComplete="name" textContentType="name" returnKeyType="next" />
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" returnKeyType="next" />
        <Field label="Password (12+ characters)" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" returnKeyType="go" onSubmitEditing={submit} />
        <ErrorText>{error}</ErrorText>
        <Button title="Create account" onPress={submit} busy={busy} disabled={!name || !email || !password} />
        <View style={{ marginTop: 24, alignItems: "center" }}>
          <Body muted>Already have an account?</Body>
          <Link href="/sign-in" style={{ color: t.accent, fontSize: 16, fontWeight: "600", marginTop: 6 }}>Sign in</Link>
        </View>
      </View>
    </Screen>
  );
}
