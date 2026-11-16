import { useCallback, useEffect, useState } from "react";
import { AppState, Linking, PermissionsAndroid, Platform, Pressable, Share, Text, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Body, Button, Card, ErrorText, Screen, Title } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { getPlan, type Plan } from "@/lib/keyboard";
import { useTheme } from "@/lib/theme";
import {
  clearAutopilotLog, composeText, getAutopilot, getAutopilotLog, getInboxPreview, getStatus, keyboardSupported, openAppInfo, openNotificationAccess, setAutopilot, summarizeInbox,
  type Autopilot, type AutopilotLogEntry, type AutopilotMode,
} from "../../../modules/azlinqext";

const MODES: { key: AutopilotMode; title: string; sub: string }[] = [
  { key: "off", title: "Off", sub: "AZLinqext reads nothing and drafts nothing." },
  { key: "selected", title: "Draft for selected conversations", sub: "It drafts replies only for the conversations you list below." },
  { key: "draft", title: "Draft for all supported conversations", sub: "It drafts a reply for every one-to-one message in WhatsApp, Telegram, Signal and SMS. Group chats are skipped." },
];
const INTERVALS = [{ m: 0, label: "Off" }, { m: 15, label: "About 15 min" }, { m: 30, label: "About 30 min" }, { m: 60, label: "About 1 hr" }, { m: 120, label: "About 2 hr" }, { m: 240, label: "About 4 hr" }];
const LABEL: Record<string, string> = { drafted: "Draft ready", handed: "Reply handed to app", dismissed: "Dismissed", skipped: "Skipped", error: "Problem" };

/** Autopilot is a draft-and-review assistant: it writes replies and you decide what is sent, from the review screen. */
export default function AutopilotScreen() {
  const t = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const [ap, setAp] = useState<Autopilot | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [linked, setLinked] = useState(false);
  const [log, setLog] = useState<AutopilotLogEntry[]>([]);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [newKind, setNewKind] = useState<"friend" | "professional">("friend");
  const [previews, setPreviews] = useState<{ sender: string; text: string }[] | null>(null);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState("");
  const [kind, setKind] = useState<"email" | "message">("email");
  const [tone, setTone] = useState<"professional" | "casual">("professional");
  const [notes, setNotes] = useState("");
  const [composed, setComposed] = useState("");

  const refresh = useCallback(async () => {
    try {
      setAp(await getAutopilot()); setLog(await getAutopilotLog());
      const s = await getStatus(); setLinked(s.linked && s.linkedUserId === user?.id);
      setPlan(await getPlan().catch(() => null));
    } catch (e) { setError((e as Error).message); }
  }, [user?.id]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  useEffect(() => { const sub = AppState.addEventListener("change", s => { if (s === "active") void refresh(); }); return () => sub.remove(); }, [refresh]);

  if (!keyboardSupported) return <Screen narrow edges={["left", "right"]}><Title>Autopilot</Title><Card><Body>Autopilot works in the Android app.</Body></Card></Screen>;
  if (!ap) return <Screen narrow edges={["left", "right"]}><Title>Autopilot</Title><ErrorText>{error}</ErrorText><Body muted>Loading…</Body></Screen>;

  const ready = plan?.consent.replyAssist === true && linked;
  const on = ap.mode !== "off";
  const save = async (change: Parameters<typeof setAutopilot>[0]) => { setError(""); try { await setAutopilot(change); await refresh(); } catch (e) { setError((e as Error).message); } };

  async function chooseMode(mode: AutopilotMode) {
    if (mode === ap!.mode) return;
    if (mode !== "off") {
      if (!ready) { setError("First turn on AI replies and connect the keyboard (AZLinqext keyboard screen)."); return; }
      if (Platform.OS === "android" && Platform.Version >= 33) await PermissionsAndroid.request("android.permission.POST_NOTIFICATIONS" as never).catch(() => null);
    }
    await save({ mode, paused: false });
  }
  const addContact = () => {
    const n = name.trim();
    if (!n) return;
    if (ap.contacts.some(c => c.name.toLowerCase() === n.toLowerCase())) { setName(""); return; }
    setName(""); void save({ contacts: [...ap.contacts, { name: n, kind: newKind }] });
  };
  async function showPreviews() { setBusy("prev"); setError(""); setSummary(""); try { setPreviews(await getInboxPreview()); } catch (e) { setError((e as Error).message); } finally { setBusy(""); } }
  async function summarize() {
    setBusy("sum"); setError("");
    try { const r = await summarizeInbox(); setSummary(r.text + (r.ai ? "" : "\n\n(Plain list. A written summary needs the Plus plan.)")); setPreviews(null); } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }
  async function compose() { setBusy("compose"); setError(""); try { setComposed(await composeText({ notes, kind, tone })); } catch (e) { setError((e as Error).message); } finally { setBusy(""); } }
  const openMail = () => {
    const m = /^subject:\s*(.+)\n+([\s\S]*)$/i.exec(composed);
    Linking.openURL(`mailto:?subject=${encodeURIComponent(m?.[1] ?? "")}&body=${encodeURIComponent(m?.[2] ?? composed)}`).catch(() => setError("No email app found. Use Copy or share instead."));
  };

  const chip = (label: string, selected: boolean, onPress: () => void, key?: string) => (
    <Pressable key={key ?? label} accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress}
      style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: selected ? t.accent : t.line, backgroundColor: selected ? t.accent : "transparent", marginRight: 6, marginBottom: 6 }}>
      <Text style={{ color: selected ? t.accentInk : t.ink, fontSize: 13, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
  const heading = (s: string) => <Text style={{ color: t.ink, fontSize: 16, fontWeight: "700", marginBottom: 6 }}>{s}</Text>;
  const row = (label: string, ok: boolean, okText: string, noText: string) => (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
      <Text style={{ color: t.ink, fontSize: 15 }}>{label}</Text>
      <Text style={{ color: ok ? t.accent : t.danger, fontSize: 15, fontWeight: "600" }}>{ok ? `✓ ${okText}` : noText}</Text>
    </View>
  );

  return (
    <Screen narrow edges={["left", "right"]}>
      <Text style={{ color: t.muted, fontSize: 13, marginBottom: 10 }}>AZLinqext writes drafts. You review each one and decide what is sent.</Text>
      <ErrorText>{error}</ErrorText>

      {!ready ? (
        <Card style={{ marginBottom: 14 }}>
          {heading("First: connect the keyboard")}
          <Body muted>Autopilot uses the same A-Zee connection and privacy choice as the AZLinqext keyboard. Turn on AI replies there first.</Body>
          <Button title="Open AZLinqext keyboard" variant="outline" onPress={() => router.push("/keyboard")} style={{ marginTop: 10 }} />
        </Card>
      ) : null}

      <Card style={{ marginBottom: 14, opacity: ready ? 1 : 0.5 }}>
        {heading("Draft mode")}
        {MODES.map(m => {
          const sel = ap.mode === m.key;
          return (
            <Pressable key={m.key} accessibilityRole="radio" accessibilityState={{ selected: sel }} onPress={() => void chooseMode(m.key)} style={{ flexDirection: "row", paddingVertical: 8 }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: sel ? t.accent : t.line, alignItems: "center", justifyContent: "center", marginRight: 12, marginTop: 1 }}>
                {sel ? <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: t.accent }} /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontSize: 15, fontWeight: "600" }}>{m.title}</Text>
                <Text style={{ color: t.muted, fontSize: 13, marginTop: 2 }}>{m.sub}</Text>
              </View>
            </Pressable>
          );
        })}
        <Body muted style={{ marginTop: 6 }}>Every draft opens for review. AZLinqext never sends a message by itself.</Body>
        {on ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
            <Text style={{ color: ap.paused ? t.danger : t.ink, fontSize: 15, fontWeight: "700", flex: 1 }}>{ap.paused ? "Paused" : "Drafting active"}</Text>
            <Button title={ap.paused ? "Resume" : "Pause"} variant="outline" onPress={() => void save({ paused: !ap.paused })} style={{ minHeight: 40, paddingVertical: 8 }} />
          </View>
        ) : null}
        {on && ap.paused ? <Body muted style={{ marginTop: 4 }}>No new drafts or check-in reminders while paused. Writing below still works.</Body> : null}
      </Card>

      {on ? (
        <Card style={{ marginBottom: 14 }}>
          {heading("Message access")}
          {row("Android permission", ap.notificationAccess, "Granted", "Not granted")}
          {row("Listener", ap.listenerConnected, "Connected", ap.notificationAccess ? "Not connected" : "Off")}
          <Body muted style={{ marginTop: 6 }}>Apps: {ap.apps.join(", ")}.</Body>
          <Body muted style={{ marginTop: 6 }}>AZLinqext works from message notifications, so it may only see a preview of long messages. Android can disconnect the listener even after you grant access. If it says Not connected, switch access off and on again.</Body>
          <Button title="Manage access" variant={ap.notificationAccess ? "outline" : "primary"} onPress={() => void openNotificationAccess()} style={{ marginTop: 10 }} />
          {!ap.notificationAccess ? <Button title="Switch greyed out? Open App info" variant="ghost" onPress={() => void openAppInfo()} /> : null}
        </Card>
      ) : null}

      <Card style={{ marginBottom: 14 }}>
        {heading("Conversations and tone")}
        <Body muted style={{ marginBottom: 8 }}>Tone for conversations not on your list:</Body>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {chip("Friendly", ap.defaultKind === "friend", () => void save({ defaultKind: "friend" }))}
          {chip("Professional", ap.defaultKind === "professional", () => void save({ defaultKind: "professional" }))}
        </View>
        <Body muted style={{ marginVertical: 8 }}>Selected conversations are matched by the chat's name, in any supported app. Two chats with the same name can't be told apart, so use "all supported conversations" if that could happen.</Body>
        {ap.contacts.map(c => (
          <View key={c.name} style={{ paddingVertical: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={{ color: t.ink, fontSize: 15, flex: 1 }}>{c.name}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${c.name}`} onPress={() => void save({ contacts: ap.contacts.filter(x => x.name !== c.name) })} style={{ padding: 8 }}><Text style={{ color: t.danger, fontSize: 16 }}>✕</Text></Pressable>
            </View>
            <View style={{ flexDirection: "row" }}>
              {chip("Friendly", c.kind === "friend", () => void save({ contacts: ap.contacts.map(x => x.name === c.name ? { ...x, kind: "friend" } : x) }), `f-${c.name}`)}
              {chip("Professional", c.kind === "professional", () => void save({ contacts: ap.contacts.map(x => x.name === c.name ? { ...x, kind: "professional" } : x) }), `p-${c.name}`)}
            </View>
          </View>
        ))}
        <TextInput accessibilityLabel="Conversation name" value={name} onChangeText={setName} onSubmitEditing={addContact} placeholder="Chat name, exactly as shown" placeholderTextColor={t.muted}
          style={{ color: t.ink, backgroundColor: t.card, borderColor: t.line, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, marginTop: 6 }} />
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 8 }}>
          {chip("Friendly", newKind === "friend", () => setNewKind("friend"), "nf")}{chip("Professional", newKind === "professional", () => setNewKind("professional"), "np")}
          <View style={{ flex: 1 }} /><Button title="Add" variant="outline" onPress={addContact} style={{ minHeight: 40, paddingVertical: 8 }} />
        </View>
      </Card>

      <Card style={{ marginBottom: 14 }}>
        {heading("Check-in reminders")}
        <Body muted style={{ marginBottom: 8 }}>A reminder that drafts or messages are waiting. Android may delay it a little to save battery. The lock screen only says "You have drafts to review".</Body>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>{INTERVALS.map(i => chip(i.label, ap.digestMinutes === i.m, () => void save({ digestMinutes: i.m })))}</View>
      </Card>

      <Card style={{ marginBottom: 14 }}>
        {heading("Summarize now")}
        <Body muted>Summarizes the messages AZLinqext has seen since you turned drafting on. You see exactly what would be sent before anything leaves your phone.</Body>
        <Button title="Review messages to summarize" variant="outline" onPress={showPreviews} busy={busy === "prev"} disabled={!ready || !on} style={{ marginTop: 10 }} />
        {previews ? (
          <View style={{ marginTop: 10 }}>
            {previews.length === 0 ? <Body muted>No messages to summarize yet.</Body> : (
              <>
                {previews.map((p, i) => <Text key={i} style={{ color: t.ink, fontSize: 14, marginBottom: 4 }}><Text style={{ fontWeight: "700" }}>{p.sender}: </Text>{p.text}</Text>)}
                <Body muted style={{ marginVertical: 6 }}>These names and previews will be sent to A-Zee and its AI services to write the summary.</Body>
                <Button title="Send these to A-Zee's AI and summarize" onPress={summarize} busy={busy === "sum"} />
              </>
            )}
          </View>
        ) : null}
        {summary ? <Text selectable style={{ color: t.ink, fontSize: 14, lineHeight: 20, marginTop: 10 }}>{summary}</Text> : null}
      </Card>

      <Card style={{ marginBottom: 14, opacity: ready ? 1 : 0.5 }}>
        {heading("Write")}
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>{chip("Email", kind === "email", () => setKind("email"))}{chip("Text message", kind === "message", () => setKind("message"))}</View>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>{chip("Professional", tone === "professional", () => setTone("professional"), "tp")}{chip("Friendly", tone === "casual", () => setTone("casual"), "tc")}</View>
        <TextInput accessibilityLabel="What should it say" multiline value={notes} onChangeText={setNotes} placeholder="Say what it should cover, e.g. thank Dr. Mensah for Tuesday's meeting and ask for the report by Friday" placeholderTextColor={t.muted}
          style={{ minHeight: 80, textAlignVertical: "top", color: t.ink, backgroundColor: t.card, borderColor: t.line, borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 15, marginTop: 6 }} />
        <Button title="Generate draft" onPress={compose} busy={busy === "compose"} disabled={!ready || notes.trim().length < 3} style={{ marginTop: 10 }} />
        {composed ? (
          <>
            <TextInput accessibilityLabel="Draft (editable)" multiline value={composed} onChangeText={setComposed}
              style={{ color: t.ink, backgroundColor: t.card, borderColor: t.line, borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 15, marginTop: 10, textAlignVertical: "top" }} />
            <Body muted style={{ marginTop: 6 }}>Edit it above, then copy or open it in an app. You send it yourself.</Body>
            <View style={{ flexDirection: "row", marginTop: 8, gap: 8 }}>
              <Button title="Copy or share" variant="outline" onPress={() => void Share.share({ message: composed })} style={{ flex: 1 }} />
              {kind === "email" ? <Button title="Open in email app" onPress={openMail} style={{ flex: 1 }} /> : null}
            </View>
          </>
        ) : null}
        <Body muted style={{ marginTop: 8 }}>It only uses the facts you give it. The text you type here is sent to A-Zee's AI to write the draft.</Body>
      </Card>

      <Card style={{ marginBottom: 14 }}>
        {heading("Your privacy")}
        <Body muted>On your phone: your Autopilot settings and an activity list (who a draft was for and what happened, never message text). Message previews and drafts are held in memory only. A draft is cleared when you send or dismiss it. Choosing Off clears all drafts and previews. Clear on the activity list also clears previews. Android ending the app clears everything.</Body>
        <Body muted style={{ marginTop: 8 }}>Sent to A-Zee: for each draft, the text of the message you received (not the sender's name), so its AI can write a reply. For a summary, the names and previews you approve above. Messages that look like codes, passwords, money, legal, medical or emergencies are never sent. A-Zee keeps the finished draft for a short time so a retry isn't counted twice.</Body>
        <Body muted style={{ marginTop: 8 }}>Stopping the screen doesn't stop drafting. Pause, or choose Off, to stop it, and switch off notification access in Android to remove the listener entirely.</Body>
      </Card>

      <Card style={{ marginBottom: 24 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          {heading("Activity")}
          {log.length ? <Pressable accessibilityRole="button" onPress={() => void clearAutopilotLog().then(refresh)}><Text style={{ color: t.accent, fontSize: 14 }}>Clear</Text></Pressable> : null}
        </View>
        {log.length === 0 ? <Body muted>Nothing yet.</Body> : log.slice(0, 30).map((e, i) => (
          <View key={`${e.t}-${i}`} style={{ paddingVertical: 6, borderTopWidth: i ? 1 : 0, borderTopColor: t.line }}>
            <Text style={{ color: t.ink, fontSize: 14, fontWeight: "600" }}>{LABEL[e.action] ?? e.action} · {e.sender}</Text>
            <Text style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>{new Date(e.t).toLocaleString()}{e.note ? ` · ${e.note}` : ""}</Text>
          </View>
        ))}
      </Card>
    </Screen>
  );
}
