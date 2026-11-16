import { useEffect, useState } from "react";
import { Share, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Body, Button, Card, ErrorText, Screen, Title } from "@/components/ui";
import { useTheme } from "@/lib/theme";
import { dismissDraft, getDraft, sendDraft, type AutopilotDraft } from "../../../modules/azlinqext";

/**
 * Review draft: the destination app, the conversation, what they wrote and the editable reply, all together.
 * Nothing is handed to the chat app until you tap Send here. If the chat's reply button is gone, copy it or open the app instead.
 */
export default function ReviewDraft() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const draftId = Number(id);
  const [draft, setDraft] = useState<AutopilotDraft | null | undefined>(undefined);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!Number.isFinite(draftId)) { setDraft(null); return; }
    getDraft(draftId).then(d => { setDraft(d); setText(d?.reply ?? ""); }).catch(() => setDraft(null));
  }, [draftId]);

  async function send() {
    setBusy(true); setError("");
    try {
      if (await sendDraft(draftId, text)) setDone(true);
      else setError("The chat app's reply button is no longer available. Use Share or open the app instead.");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function dismiss() { await dismissDraft(draftId); router.back(); }

  if (draft === undefined) return <Screen narrow><Title>Review draft</Title><Body muted>Loading…</Body></Screen>;
  if (draft === null) return (
    <Screen narrow><Title>Review draft</Title>
      <Card><Body>This draft has expired, for example because the app was closed. Open the chat and reply there.</Body></Card>
      <Button title="Done" variant="outline" onPress={() => router.back()} style={{ marginTop: 14 }} />
    </Screen>
  );
  if (done) return (
    <Screen narrow><Title>Handed to {draft.app}</Title>
      <Card><Body>Your reply was passed to {draft.app} for {draft.sender}. Check the chat to confirm it went out.</Body></Card>
      <Button title="Done" onPress={() => router.back()} style={{ marginTop: 14 }} />
    </Screen>
  );

  return (
    <Screen narrow>
      <Title sub="Nothing is sent until you tap Send.">Review draft</Title>
      <ErrorText>{error}</ErrorText>
      <Card style={{ marginBottom: 14 }}>
        <Text style={{ color: t.muted, fontSize: 13 }}>Reply in</Text>
        <Text style={{ color: t.ink, fontSize: 17, fontWeight: "700" }}>{draft.app} · {draft.sender}</Text>
        <Text style={{ color: t.muted, fontSize: 13, marginTop: 10 }}>They wrote</Text>
        <Text style={{ color: t.ink, fontSize: 15, marginTop: 2 }}>{draft.message}</Text>
      </Card>
      {draft.warning ? <Card style={{ marginBottom: 14, borderColor: t.danger }}><Body>{draft.warning}</Body></Card> : null}
      <Text style={{ color: t.ink, fontSize: 14, fontWeight: "600", marginBottom: 6 }}>Your reply (edit it if you like)</Text>
      <TextInput accessibilityLabel="Your reply" multiline value={text} onChangeText={setText}
        style={{ minHeight: 110, textAlignVertical: "top", color: t.ink, backgroundColor: t.card, borderColor: t.line, borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 16 }} />
      <View style={{ marginTop: 14, gap: 10 }}>
        {draft.canSend
          ? <Button title={`Send to ${draft.sender} in ${draft.app}`} onPress={send} busy={busy} disabled={!text.trim()} />
          : <Body muted>{draft.app} did not offer a reply button for this chat, so AZLinqext can't send it. Share the text and paste it in the chat.</Body>}
        <Button title="Copy or share text" variant="outline" onPress={() => void Share.share({ message: text })} disabled={!text.trim()} />
        <Button title="Dismiss draft" variant="ghost" onPress={dismiss} />
      </View>
    </Screen>
  );
}
