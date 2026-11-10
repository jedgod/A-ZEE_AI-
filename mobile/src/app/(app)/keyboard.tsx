import { useCallback, useEffect, useState } from "react";
import { AppState, Switch, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Body, Button, Card, ErrorText, Screen, Title } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { connectKeyboard, getPlan, setReplyConsent, setTypingConsent, type Plan } from "@/lib/keyboard";
import { useTheme } from "@/lib/theme";
import { getStatus, keyboardSupported, openKeyboardSettings, showKeyboardPicker, type KeyboardStatus } from "../../../modules/azlinqext";

const TIER_LABEL = { free: "Basic", plus: "Plus", premium: "Premium" } as const;

/** Set up the AZLinqext keyboard: privacy choice, switching it on in Android, choosing it, trying it, and your plan. */
export default function KeyboardSetup() {
  const t = useTheme();
  const { user } = useAuth();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [status, setStatus] = useState<KeyboardStatus>({ enabled: false, selected: false, linked: false, linkedUserId: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setStatus(await getStatus().catch(() => status));
    try { setPlan(await getPlan()); setError(""); } catch (e) { setError((e as Error).message); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  // Coming back from Android's keyboard settings: check again.
  useEffect(() => {
    const sub = AppState.addEventListener("change", s => { if (s === "active") void refresh(); });
    return () => sub.remove();
  }, [refresh]);

  const consented = plan?.consent.replyAssist === true;
  const linkedToMe = status.linked && status.linkedUserId === user?.id;

  async function toggleConsent(value: boolean) {
    if (!user) return;
    setBusy(true); setError("");
    try { await setReplyConsent(value, user.id); await refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function toggleTyping(value: boolean) {
    setBusy(true); setError("");
    try { await setTypingConsent(value); await refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function reconnect() {
    if (!user) return;
    setBusy(true); setError("");
    try { await connectKeyboard(user.id, user.name); await refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const step = (n: number, done: boolean, title: string) => (
    <Text style={{ color: t.ink, fontSize: 16, fontWeight: "700", marginBottom: 6 }}>{done ? "✓ " : `${n}. `}{title}</Text>
  );

  if (!keyboardSupported) {
    return <Screen narrow><Title>AZLinqext keyboard</Title><Card><Body>The AZLinqext keyboard is available in the Android app. On this device you can use A-Zee's chat instead.</Body></Card></Screen>;
  }

  const usage = plan?.usage;
  const pct = usage && usage.limit ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : 0;

  return (
    <Screen narrow>
      <Title sub="Draft, fix and translate messages in WhatsApp, LinkedIn, Telegram and Signal. You choose what to send, and you press send yourself.">AZLinqext keyboard</Title>
      <ErrorText>{error}</ErrorText>

      <Card style={{ marginBottom: 14 }}>
        {step(1, consented, "Your privacy")}
        <Body muted>When you tap a button such as <Text style={{ fontWeight: "700" }}>Suggest</Text>, <Text style={{ fontWeight: "700" }}>Rewrite</Text> or <Text style={{ fontWeight: "700" }}>Translate</Text>, the keyboard sends only the text you selected or typed to A-Zee. It never sends passwords, email addresses, web addresses or anything from fields that ask keyboards not to learn, and it never reads anything in the background. It never sends a message for you.</Body>
        <Body style={{ marginTop: 8 }}>{plan?.disclosure ?? "Your text is processed by A-Zee and by the external AI services A-Zee uses to write the result."}</Body>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
          <Text style={{ color: t.ink, fontSize: 15, flex: 1, paddingRight: 12 }}>Let AZLinqext write, rewrite and translate text I choose</Text>
          <Switch accessibilityLabel="Allow AZLinqext to process text I choose with external AI services" value={consented} disabled={busy || !plan} onValueChange={toggleConsent} trackColor={{ true: t.accent }} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14, opacity: consented ? 1 : 0.5 }}>
          <Text style={{ color: t.ink, fontSize: 15, flex: 1, paddingRight: 12 }}>Suggest as I type</Text>
          <Switch accessibilityLabel="Suggest improved wording as I type" value={plan?.consent.typing === true} disabled={busy || !consented} onValueChange={toggleTyping} trackColor={{ true: t.accent }} />
        </View>
        <Body muted style={{ marginTop: 6 }}>Off by default. When on, the keyboard pauses about 1.5 seconds after you type (at least 15 characters, and never in private fields) and offers one improved version of what you wrote, which you tap to use. This sends the text you are typing to A-Zee, so it is a separate choice. Each suggestion counts as a reply (up to {plan?.typing.dailyCap ?? 20} a day on your plan), and you can hide the whole bar from the keyboard.</Body>
        <Body muted style={{ marginTop: 8 }}>You can turn this off any time. That disconnects the keyboard immediately. Deleting your account removes everything.</Body>
      </Card>

      <Card style={{ marginBottom: 14, opacity: consented ? 1 : 0.5 }}>
        {step(2, status.enabled, "Turn the keyboard on")}
        <Body muted>Android needs you to switch AZLinqext on once. Find AZLinqext in the list and turn it on.</Body>
        <Button title={status.enabled ? "Open keyboard settings" : "Turn on AZLinqext"} variant={status.enabled ? "outline" : "primary"} onPress={() => void openKeyboardSettings()} disabled={!consented} style={{ marginTop: 10 }} />
      </Card>

      <Card style={{ marginBottom: 14, opacity: consented && status.enabled ? 1 : 0.5 }}>
        {step(3, status.selected, "Choose it when you type")}
        <Body muted>Pick AZLinqext from the keyboard list. You can switch back with the globe key on the keyboard.</Body>
        <Button title="Choose keyboard" variant="outline" onPress={() => void showKeyboardPicker()} disabled={!consented || !status.enabled} style={{ marginTop: 10 }} />
      </Card>

      <Card style={{ marginBottom: 14 }}>
        {step(4, linkedToMe, "Connected to your account")}
        <Body muted>{linkedToMe ? "The keyboard is signed in with its own limited key. It can write replies and nothing else, and it stops working when you sign out of A-Zee." : consented ? "The keyboard isn't connected yet." : "Connects when you turn on AI replies above."}</Body>
        {consented && !linkedToMe ? <Button title="Connect keyboard" onPress={reconnect} busy={busy} style={{ marginTop: 10 }} /> : null}
      </Card>

      {consented && status.selected && linkedToMe ? (
        <Card style={{ marginBottom: 14 }}>
          <Text style={{ color: t.ink, fontSize: 16, fontWeight: "700", marginBottom: 6 }}>Where it works</Text>
          <Body muted>The AI bar appears in WhatsApp, LinkedIn, Telegram and Signal. Open one of them, tap a message box, and pick AZLinqext from the keyboard icon if it isn't already showing. Everywhere else, including this app, AZLinqext is just a plain keyboard with no AI.</Body>
          <Body muted style={{ marginTop: 8 }}>Type your message, tap a button such as Fix grammar, then tap the result to use it. It goes into the box. Nothing is sent until you send it.</Body>
        </Card>
      ) : null}

      <Card style={{ marginBottom: 14 }}>
        <Text style={{ color: t.ink, fontSize: 16, fontWeight: "700", marginBottom: 6 }}>Your plan</Text>
        {plan ? (
          <>
            <Text style={{ color: t.ink, fontSize: 20, fontWeight: "700" }}>{plan.plan} <Text style={{ color: t.muted, fontSize: 14, fontWeight: "500" }}>· {TIER_LABEL[plan.tier]} replies</Text></Text>
            <View accessibilityRole="progressbar" accessibilityLabel={usage?.limit ? `${usage.used} of ${usage.limit} replies used this month` : "Unlimited replies"} style={{ height: 8, borderRadius: 4, backgroundColor: t.line, marginTop: 10, overflow: "hidden" }}>
              <View style={{ width: `${usage?.limit ? pct : 0}%`, height: 8, backgroundColor: pct > 90 ? t.danger : t.accent }} />
            </View>
            <Body muted style={{ marginTop: 6 }}>{usage?.limit ? `${usage.remaining} of ${usage.limit} left this month` : "Unlimited this month"}{usage ? ` · resets ${new Date(usage.resetsAt).toLocaleDateString()}` : ""}</Body>
            <Body muted style={{ marginTop: 4 }}>Keyboard requests have their own allowance. They don't use your chat messages.</Body>
            <Body muted style={{ marginTop: 10 }}>
              {plan.features.modes.length} tools ({plan.features.modes.join(", ")}) · {plan.features.variants} {plan.features.variants === 1 ? "result" : "results"} at a time · {plan.features.tones.length} tones
            </Body>
            {plan.tier !== "premium" ? <Body muted style={{ marginTop: 6 }}>Higher plans add more tools (translate, summarize), more results at a time, more tones and longer text. Plans are managed on the A-Zee website.</Body> : null}
          </>
        ) : <Body muted>Loading…</Body>}
      </Card>
    </Screen>
  );
}
