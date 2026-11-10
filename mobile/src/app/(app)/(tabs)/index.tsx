import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Pressable, Text, TextInput, useWindowDimensions, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChatList } from "@/components/chat-list";
import { MessageText } from "@/components/message-text";
import { ErrorText } from "@/components/ui";
import { ask, loadChat, saveChat, type ChatMode, type Msg } from "@/lib/chat";
import { MAX_MESSAGE_CHARACTERS } from "@/lib/config";
import { newId } from "@/lib/storage";
import { TABLET_WIDTH, useTheme } from "@/lib/theme";

type Shown = Msg & { notes?: string[] };

/**
 * Chat. On a tablet (or a phone turned sideways) saved chats sit in a sidebar next to the
 * conversation; on a phone they live in the History tab, which opens a chat here.
 */
export default function ChatScreen() {
  const t = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= TABLET_WIDTH;
  const { open, prompt } = useLocalSearchParams<{ open?: string; prompt?: string }>();

  const [chatId, setChatId] = useState(newId);
  const [mode, setMode] = useState<ChatMode>("chat");
  const [messages, setMessages] = useState<Shown[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [listKey, setListKey] = useState(0);
  const list = useRef<FlatList<Shown>>(null);

  const reset = useCallback(() => { setChatId(newId()); setMessages([]); setError(""); setInput(""); }, []);

  const openChat = useCallback(async (id: string) => {
    setError("");
    try {
      const chat = await loadChat(id);
      setChatId(chat.id); setMode(chat.mode); setMessages(chat.messages);
    } catch (e) { setError((e as Error).message); }
  }, []);

  // History, Favorites and Library hand over an id or a prompt through the route.
  useEffect(() => { if (open) { void openChat(open); router.setParams({ open: undefined }); } }, [open, openChat, router]);
  useEffect(() => { if (prompt) { reset(); setInput(prompt.slice(0, 4000)); router.setParams({ prompt: undefined }); } }, [prompt, reset, router]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    if (text.length > MAX_MESSAGE_CHARACTERS) { setError(`That message is too long (limit ${MAX_MESSAGE_CHARACTERS.toLocaleString()} characters).`); return; }
    const next: Shown[] = [...messages, { role: "user", content: text }];
    setMessages(next); setInput(""); setSending(true); setError("");
    try {
      const reply = await ask(mode, next);
      const done: Shown[] = [...next, { role: "assistant", content: reply.answer, notes: reply.notes.slice(0, 2) }];
      setMessages(done);
      // Saved to the account so it also appears on the website. A failed save never loses the answer.
      saveChat(chatId, mode, done).then(() => setListKey(k => k + 1)).catch(() => undefined);
    } catch (e) {
      setError((e as Error).message);
      setMessages(messages); setInput(text); // put the message back so nothing is lost
    } finally { setSending(false); }
  }

  const conversation = (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={wide ? ["top", "right"] : ["top", "left", "right"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 8 }}>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {(["chat", "code"] as const).map(m => (
              <Pressable key={m} accessibilityRole="button" accessibilityState={{ selected: mode === m }} onPress={() => setMode(m)}
                style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: mode === m ? t.accent : "transparent", borderWidth: 1, borderColor: mode === m ? t.accent : t.line }}>
                <Text style={{ color: mode === m ? t.accentInk : t.ink, fontWeight: "600" }}>{m === "chat" ? "Chat" : "Code"}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="New chat" onPress={reset} style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
            <Text style={{ color: t.accent, fontWeight: "600", fontSize: 15 }}>New chat</Text>
          </Pressable>
        </View>

        <FlatList
          ref={list} data={messages} keyExtractor={(_, i) => String(i)} contentContainerStyle={{ padding: 14, gap: 10, flexGrow: 1 }}
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={<View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
            <Text style={{ color: t.ink, fontSize: 24, fontWeight: "700", textAlign: "center" }}>What's on your mind?</Text>
            <Text style={{ color: t.muted, textAlign: "center", marginTop: 8 }}>Ask anything, or switch to Code for programming help.</Text>
          </View>}
          renderItem={({ item }) => {
            const mine = item.role === "user";
            return (
              <View style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: wide ? "70%" : "90%" }}>
                <View style={{ backgroundColor: mine ? t.bubbleUser : t.bubbleAi, borderColor: t.line, borderWidth: mine ? 0 : 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 }}>
                  <MessageText text={item.content} color={mine ? t.bubbleUserInk : t.ink} />
                </View>
                {item.notes?.length ? <Text style={{ color: t.muted, fontSize: 12, marginTop: 4, marginHorizontal: 6 }}>{item.notes[item.notes.length - 1]}</Text> : null}
              </View>
            );
          }}
          ListFooterComponent={sending ? <Text style={{ color: t.muted, marginTop: 6 }}>A-Zee is thinking…</Text> : undefined}
        />

        <View style={{ paddingHorizontal: 14 }}><ErrorText>{error}</ErrorText></View>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 14, paddingBottom: 10 }}>
          <TextInput
            accessibilityLabel="Message" value={input} onChangeText={setInput} multiline editable={!sending} placeholder="Message A-Zee" placeholderTextColor={t.muted} maxLength={MAX_MESSAGE_CHARACTERS}
            style={{ flex: 1, maxHeight: 140, minHeight: 48, color: t.ink, backgroundColor: t.card, borderColor: t.line, borderWidth: 1, borderRadius: 20, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontSize: 16 }} />
          <Pressable accessibilityRole="button" accessibilityLabel="Send" disabled={sending || !input.trim()} onPress={send}
            style={{ height: 48, paddingHorizontal: 18, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: t.accent, opacity: sending || !input.trim() ? 0.5 : 1 }}>
            <Text style={{ color: t.accentInk, fontWeight: "700", fontSize: 16 }}>Send</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );

  if (!wide) return conversation;
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: t.bg }}>
      <SafeAreaView edges={["top", "left"]} style={{ width: 300, borderRightColor: t.line, borderRightWidth: 1 }}>
        <Text style={{ color: t.ink, fontSize: 18, fontWeight: "700", padding: 14 }}>Chats</Text>
        <ChatList onOpen={id => void openChat(id)} selectedId={chatId} refreshKey={listKey} />
      </SafeAreaView>
      <View style={{ flex: 1 }}>{conversation}</View>
    </View>
  );
}
