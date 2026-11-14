import { MarketQuoteCard } from "@/components/market-quote-card";
import { useCallback, useEffect, useRef, useState, type ComponentRef } from "react";
import { useVoiceAssistant } from "@/hooks/useVoiceAssistant";
import { TranslateSheet } from "@/components/translate-sheet";
import { VoiceModeOverlay } from "@/components/voice-mode-overlay";
import { Alert, FlatList, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChatList } from "@/components/chat-list";
import { api } from "@/lib/api";
import { AiDetectionCard, type AiDetectionResult } from "@/components/ai-detection-card";
import { ConnectorsSheet } from "@/components/connectors-sheet";
import { ImagineView } from "@/components/imagine";
import { Logo } from "@/components/logo";
import { MessageText } from "@/components/message-text";
import { Sidebar } from "@/components/sidebar";
import { pickAndScanImage } from "@/lib/vision";
import { pickAndUploadVideo, type SourceClip } from "@/lib/video-upload";
import { pickDocument, splitAttachment, type PickedDoc } from "@/lib/docs";
import { ask, loadChat, saveChat, type Msg } from "@/lib/chat";
import { C, SIZE } from "@/lib/chat-theme";
import { MAX_MESSAGE_CHARACTERS } from "@/lib/config";
import { newId } from "@/lib/storage";
import { darkTheme, TABLET_WIDTH } from "@/lib/theme";

type Shown = Msg & { notes?: string[] };
type Tab = "ask" | "imagine" | "build";

const TABS: { key: Tab; label: string }[] = [{ key: "ask", label: "Ask" }, { key: "imagine", label: "Imagine" }, { key: "build", label: "Build" }];

type Chip = { glyph: string; label: string; action: "prompt" | "connectors" | "imagine" | "video" | "editvideo" | "camera" | "docs" | "detect" | "translate" | "finance"; prompt?: string; hint?: string };

const CHIPS: Record<Exclude<Tab, "imagine">, Chip[]> = {
  ask: [
    { glyph: "🏛", label: "Try Finance", action: "finance" },
    { glyph: "🧩", label: "Connectors", action: "connectors" },
    { glyph: "🎬", label: "Create Videos", action: "video" },
    { glyph: "✂️", label: "Edit Video", action: "editvideo" },
    { glyph: "🖼", label: "Edit Image", action: "imagine" },
    { glyph: "📷", label: "Open Camera", action: "camera" },
    { glyph: "📄", label: "Docs Analysis", action: "docs" },
    { glyph: "🔍", label: "AI Image Detect", action: "detect" },
    { glyph: "🌍", label: "Translate", action: "translate" },
  ],
  build: [
    { glyph: "🌐", label: "Try a website", action: "prompt", prompt: "Build a simple landing page for a coffee shop." },
    { glyph: "🎮", label: "Try a game", action: "prompt", prompt: "Build a small browser game I can play with the arrow keys." },
  ],
};

const soon = (what: string) => Alert.alert(what, "This isn't available in the app yet.");

const MODELS = [
  { key: "build", glyph: "🛠", label: "Build", sub: "Build apps and sites", beta: true },
  { key: "expert", glyph: "💡", label: "Expert", sub: "Thinks hard" },
  { key: "fast", glyph: "⚡", label: "Fast", sub: "Quick responses" },
  { key: "auto", glyph: "🚀", label: "Auto", sub: "Chooses Fast or Expert" },
] as const;
type ModelKey = (typeof MODELS)[number]["key"];

function RoundButton({ glyph, label, onPress, size = 40, bg = C.pill, ink = C.ink }: { glyph: string; label: string; onPress: () => void; size?: number; bg?: string; ink?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6}
      style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1 })}>
      <Text style={{ color: ink, fontSize: SIZE.icon, lineHeight: SIZE.icon + 4, includeFontPadding: false }}>{glyph}</Text>
    </Pressable>
  );
}

/**
 * Chat. Black theme: header (menu, logo, new chat), Ask / Imagine / Build switcher, a conversation area
 * (a large logo watermark when empty), suggestion chips, and a rounded composer fixed to the bottom.
 * On a tablet the saved chats sit in a permanent sidebar; on a phone the hamburger opens them.
 */
export default function ChatScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= TABLET_WIDTH;
  const { open, prompt } = useLocalSearchParams<{ open?: string; prompt?: string }>();

  const [chatId, setChatId] = useState(newId);
  const [tab, setTab] = useState<Tab>("ask");
  const [messages, setMessages] = useState<Shown[]>([]);
  const [input, setInput] = useState("");
  const [finance, setFinance] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [listKey, setListKey] = useState(0);
  const [menu, setMenu] = useState(false);
  const [connectors, setConnectors] = useState(false);
  const [hint, setHint] = useState("");
  const [doc, setDoc] = useState<PickedDoc | null>(null);
  const [reading, setReading] = useState(false);
  const [scans, setScans] = useState<AiDetectionResult[]>([]);
  const [scanning, setScanning] = useState(false);
  const [clip, setClip] = useState<SourceClip | null>(null);
  const [uploading, setUploading] = useState(false);
  const [imagineKind, setImagineKind] = useState<"image" | "video">("image");
  const [focused, setFocused] = useState(true);
  const [model, setModel] = useState<ModelKey>("auto");
  const [models, setModels] = useState(false);
  const [translating, setTranslating] = useState(false);
  const list = useRef<FlatList<Shown>>(null);
  const field = useRef<ComponentRef<typeof TextInput>>(null);
  const dictationBase = useRef(""); // text already in the box when the Mic was pressed; dictated words are added after it

  const picked = MODELS.find(m => m.key === (tab === "build" ? "build" : model)) ?? MODELS[3];
  const mode = tab === "build" ? "code" : "chat"; // Build uses the server's Code mode
  const canSend = tab !== "imagine" && !sending && input.trim().length > 0;

  // Past AI-image scans (newest first from the server) reload into the feed; they have no thumbnail because
  // the server does not keep the image, and the card simply leaves the picture out.
  useEffect(() => {
    let alive = true;
    api<{ scans: AiDetectionResult[] }>("/api/vision/scans")
      .then(r => { if (alive && r.scans?.length) setScans(now => [...[...r.scans].reverse().filter(h => !now.some(n => n.scanId === h.scanId)), ...now]); })
      .catch(() => undefined); // history is a convenience; a failure leaves the feed as it is
    return () => { alive = false; };
  }, []);

  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));

  const reset = useCallback(() => { setHint(""); setDoc(null); setScans([]); setChatId(newId()); setMessages([]); setError(""); setInput(""); }, []);

  const openChat = useCallback(async (id: string) => {
    setError("");
    try {
      const chat = await loadChat(id);
      setChatId(chat.id); setTab(chat.mode === "code" ? "build" : "ask"); setMessages(chat.messages);
    } catch (e) { setError((e as Error).message); }
  }, []);

  // History, Favorites and Library hand over an id or a prompt through the route.
  useEffect(() => { if (open) { void openChat(open); router.setParams({ open: undefined }); } }, [open, openChat, router]);
  useEffect(() => { if (prompt) { reset(); setTab("ask"); setInput(prompt.slice(0, 4000)); router.setParams({ prompt: undefined }); } }, [prompt, reset, router]);

  async function attachDocument() {
    if (reading) return;
    setReading(true); setError("");
    try {
      const picked = await pickDocument();
      if (picked) {
        setDoc(picked); setTab("ask");
        setInput(v => v.trim() ? v : `Summarize the key points, dates and totals in ${picked.fileName}`);
        setHint("Ask about this document…");
      }
    } catch (e) { Alert.alert("Document", (e as Error).message); }
    finally { setReading(false); }
  }

  // The card disappears at once; if the server call fails it comes back.
  async function removeScan(scanId: string) {
    const before = scans;
    setScans(list => list.filter(x => x.scanId !== scanId));
    try { await api(`/api/vision/scans/${scanId}`, { method: "DELETE" }); }
    catch (e) { setScans(before); Alert.alert("Delete scan", (e as Error).message); }
  }

  async function clearScans() {
    const before = scans;
    setScans([]);
    try { await api("/api/vision/scans", { method: "DELETE" }); }
    catch (e) { setScans(before); Alert.alert("Clear scans", (e as Error).message); }
  }

  async function attachVideo() {
    if (uploading) return;
    setUploading(true);
    try {
      const picked = await pickAndUploadVideo();
      if (picked) { setClip(picked); setImagineKind("video"); setTab("imagine"); }
    } catch (e) { Alert.alert("Edit Video", (e as Error).message); }
    finally { setUploading(false); }
  }

  async function detectImage() {
    if (scanning) return;
    setScanning(true); setError("");
    try {
      const scan = await pickAndScanImage();
      if (scan) { setTab("ask"); setScans(list => [...list, scan]); }
    } catch (e) { Alert.alert("AI Image Detect", (e as Error).message); }
    finally { setScanning(false); }
  }

  function runChip(c: Chip) {
    switch (c.action) {
      case "prompt": setInput(c.prompt ?? ""); setHint(c.hint ?? ""); field.current?.focus(); break;
      case "connectors": setConnectors(true); break;
      case "imagine": setImagineKind("image"); setTab("imagine"); break;
      case "video": setImagineKind("video"); setTab("imagine"); break;
      case "camera":
        // Opens the phone's camera app. The photo can't be handed back to A-Zee until the app has a camera module.
        if (Platform.OS === "android") Linking.sendIntent("android.media.action.IMAGE_CAPTURE").catch(() => soon("Camera"));
        else soon("Camera");
        break;
      case "docs": void attachDocument(); break;
      case "detect": void detectImage(); break;
      case "editvideo": void attachVideo(); break;
      case "translate": setTranslating(true); break;
      case "finance": setFinance(v => !v); break;
    }
  }

  // One spoken turn of voice mode: goes through the same chat call, history and saving as a typed message.
  async function voiceTurn(spoken: string): Promise<string | null> {
    if (sending || tab === "imagine") return null;
    const next: Shown[] = [...messages, { role: "user", content: spoken.slice(0, MAX_MESSAGE_CHARACTERS) }];
    setMessages(next); setSending(true); setError("");
    try {
      const reply = await ask(mode, next);
      const done: Shown[] = [...next, { role: "assistant", content: reply.answer, notes: reply.notes.slice(0, 2) }];
      setMessages(done);
      saveChat(chatId, mode, done).then(() => setListKey(k => k + 1)).catch(() => undefined);
      return reply.answer;
    } catch (e) {
      setError((e as Error).message);
      setMessages(messages);
      return null;
    } finally { setSending(false); }
  }

  const voice = useVoiceAssistant({
    onDictationText: (text, isFinal) => {
      const base = dictationBase.current.trim();
      setInput((base ? `${base} ${text}` : text).slice(0, MAX_MESSAGE_CHARACTERS));
      if (isFinal) dictationBase.current = base ? `${base} ${text}` : text;
    },
    onVoiceTurnSubmit: voiceTurn,
  });
  const listening = voice.voiceState === "listening" && !voice.isVoiceModeActive;

  async function send() {
    const text = input.trim();
    if (!text || sending || tab === "imagine") return;
    if (text.length > MAX_MESSAGE_CHARACTERS) { setError(`That message is too long (limit ${MAX_MESSAGE_CHARACTERS.toLocaleString()} characters).`); return; }
    const content = doc ? text + doc.attachment : text;
    if (content.length > MAX_MESSAGE_CHARACTERS) { setError("The document plus your question is too long. Shorten the question."); return; }
    const next: Shown[] = [...messages, { role: "user", content }];
    setMessages(next); setInput(""); setDoc(null); setSending(true); setError("");
    try {
      const reply = await ask(mode, next);
      const done: Shown[] = [...next, { role: "assistant", content: reply.answer, notes: reply.notes.slice(0, 2) }];
      setMessages(done);
      // Saved to the account so it also appears on the website. A failed save never loses the answer.
      saveChat(chatId, mode, done).then(() => setListKey(k => k + 1)).catch(() => undefined);
    } catch (e) {
      setError((e as Error).message);
      setMessages(messages); setInput(text); if (doc) setDoc(doc); // put the message back so nothing is lost
    } finally { setSending(false); }
  }

  const empty = (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, minHeight: 240 }}>
      <Logo size={64} color={C.watermark} />
      {tab === "imagine" ? <Text style={{ color: C.muted, fontSize: SIZE.chip, textAlign: "center", marginTop: 24 }}>Image and video creation is coming to the app soon.</Text> : null}
    </View>
  );

  const conversation = (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={wide ? ["top", "right", "bottom"] : ["top", "left", "right", "bottom"]}>
      {focused ? <StatusBar style="light" /> : null}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {/* Header */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingTop: 6, height: 52 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            {!wide ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Open menu" onPress={() => setMenu(true)} hitSlop={8} style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: C.ink, fontSize: 26, lineHeight: 30, includeFontPadding: false }}>☰</Text>
              </Pressable>
            ) : null}
            <Logo size={20} />
          </View>
          <View style={{ flexDirection: "row", gap: 4 }}>
            <RoundButton glyph="🔌" label="Connectors" onPress={() => setConnectors(true)} size={38} bg="transparent" />
            <RoundButton glyph="✎" label="New chat" onPress={reset} size={38} bg="transparent" />
          </View>
        </View>

        {/* Ask / Imagine / Build */}
        <View style={{ alignItems: "center", paddingVertical: 6 }}>
          <View accessibilityRole="tablist" style={{ flexDirection: "row", backgroundColor: C.surface, borderRadius: 999, padding: 3 }}>
            {TABS.map(x => (
              <Pressable key={x.key} accessibilityRole="tab" accessibilityState={{ selected: tab === x.key }} onPress={() => setTab(x.key)}
                style={{ paddingHorizontal: 20, height: 34, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: tab === x.key ? C.pill : "transparent" }}>
                <Text style={{ color: tab === x.key ? C.ink : C.muted, fontSize: SIZE.chip, fontWeight: "600" }}>{x.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Kept mounted so rendering videos keep polling while you look at other tabs */}
        <View style={{ flex: 1, display: tab === "imagine" ? "flex" : "none" }}><ImagineView kind={imagineKind} onKindChange={setImagineKind} clip={clip} onClearClip={() => setClip(null)} /></View>

        {/* Chat body (kept mounted while on Imagine so a half-written message isn't lost) */}
        <View style={{ flex: 1, display: tab === "imagine" ? "none" : "flex" }}>
        <FlatList
          ref={list} data={messages} keyExtractor={(_, i) => String(i)} keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 14, gap: 14, flexGrow: 1 }}
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={empty}
          renderItem={({ item }) => {
            const mine = item.role === "user";
            return (
              <View style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: mine ? (wide ? "70%" : "85%") : "100%" }}>
                <View style={mine ? { backgroundColor: C.pill, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10 } : { paddingHorizontal: 2 }}>
                  {(() => {
                    const part = mine ? splitAttachment(item.content) : { text: item.content, fileName: null };
                    return <>
                      {part.fileName ? <Text style={{ color: C.muted, fontSize: 13, marginBottom: part.text ? 6 : 0 }}>📄 {part.fileName}</Text> : null}
                      {part.text ? <MessageText text={part.text} color={C.ink} /> : null}
                    </>;
                  })()}
                </View>
                {item.notes?.length ? <Text style={{ color: C.muted, fontSize: 12, marginTop: 4, marginHorizontal: 6 }}>{item.notes[item.notes.length - 1]}</Text> : null}
              </View>
            );
          }}
          ListFooterComponent={<>
            {scans.length ? (
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 6 }}>
                <Text style={{ color: C.muted, fontSize: 12, fontWeight: "500" }}>Recent AI scans</Text>
                <Pressable accessibilityRole="button" hitSlop={8} onPress={() => void clearScans()}><Text style={{ color: C.muted, fontSize: 12 }}>Clear all</Text></Pressable>
              </View>
            ) : null}
            {scans.map((scan, i) => <AiDetectionCard key={scan.scanId ?? i} result={scan} onDelete={removeScan} />)}
            {scanning ? <Text style={{ color: C.muted, marginTop: 6 }}>Checking the image…</Text> : null}
            {sending ? <Text style={{ color: C.muted, marginTop: 6 }}>A-Zee is thinking…</Text> : null}
          </>}
        />

        {error ? <Text accessibilityRole="alert" style={{ color: C.danger, fontSize: 14, paddingHorizontal: 16, paddingBottom: 8 }}>{error}</Text> : null}

        {/* Attached document */}
        {doc || reading ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginHorizontal: 14, marginBottom: 8, paddingHorizontal: 14, height: 40, borderRadius: 20, backgroundColor: C.surface }}>
            <Text numberOfLines={1} style={{ color: C.ink, fontSize: 14, flex: 1 }}>{reading ? "Reading document…" : `📄 ${doc!.fileName}${doc!.truncated ? " (first part)" : ""}`}</Text>
            {doc && !reading ? <Pressable accessibilityRole="button" accessibilityLabel="Remove document" hitSlop={10} onPress={() => { setDoc(null); setHint(""); }}><Text style={{ color: C.muted, fontSize: 18, paddingLeft: 12 }}>✕</Text></Pressable> : null}
          </View>
        ) : null}

        {finance && tab !== "imagine" ? <MarketQuoteCard onAsk={q => { setInput(`Analyze ${q.symbol} (${q.assetClass.replace("_", "/")})${q.price == null ? "" : ` currently around ${q.price} ${q.currency}`}: key catalysts, risk levels and outlook. Data may be delayed.`); setHint(""); field.current?.focus(); }} /> : null}

        {/* Suggestion chips */}
        {tab !== "imagine" ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ paddingHorizontal: 14, gap: 8, paddingBottom: 10 }}>
            {CHIPS[tab].map(c => (
              <Pressable key={c.label} accessibilityRole="button" onPress={() => runChip(c)}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 8, height: 40, paddingHorizontal: 16, borderRadius: 20, backgroundColor: C.surface, opacity: pressed ? 0.7 : 1 })}>
                <Text style={{ fontSize: 16 }}>{c.glyph}</Text>
                <Text style={{ color: C.ink, fontSize: 14, fontWeight: "500" }}>{c.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {/* Composer */}
        <View style={{ marginHorizontal: 10, marginBottom: 10, backgroundColor: C.surface, borderRadius: 24, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10 }}>
          <TextInput
            ref={field} accessibilityLabel="Message" value={input} onChangeText={setInput} multiline editable={!sending && tab !== "imagine"}
            placeholder={listening ? "Listening…" : hint || "Ask Anything"} placeholderTextColor={C.muted} maxLength={MAX_MESSAGE_CHARACTERS} selectionColor={C.ink}
            style={{ color: C.ink, fontSize: SIZE.placeholder, fontWeight: "400", maxHeight: 140, minHeight: 36, paddingHorizontal: 4, paddingTop: 4, paddingBottom: 8 }} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <RoundButton glyph="+" label="Add attachment" size={28} onPress={() => soon("Attachments")} bg={C.pill} />
            <Pressable accessibilityRole="button" accessibilityLabel={`Model: ${picked.label}`} onPress={() => setModels(true)}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, height: 28, paddingHorizontal: 11, borderRadius: 14, backgroundColor: C.pill, opacity: pressed ? 0.7 : 1 })}>
              <Text style={{ color: C.ink, fontSize: 11 }}>{picked.glyph}</Text>
              <Text style={{ color: C.ink, fontSize: 12, fontWeight: "500" }}>{picked.label}</Text>
            </Pressable>
            <View style={{ flex: 1 }} />
            <RoundButton glyph={listening ? "⏹" : "🎙"} label={listening ? "Stop dictating" : "Dictate"} size={28} onPress={() => { if (!listening) dictationBase.current = input; void voice.toggleDictation(); }} bg={listening ? "#14532d" : C.pill} />
            {input.trim() ? (
              <RoundButton glyph="↑" label="Send" size={28} onPress={() => void send()} bg={canSend ? C.ink : C.pill} ink={canSend ? C.bg : C.muted} />
            ) : (
              <Pressable accessibilityRole="button" accessibilityLabel="Speak" onPress={() => void voice.toggleVoiceMode()}
                style={{ flexDirection: "row", alignItems: "center", gap: 4, height: 28, paddingHorizontal: 11, borderRadius: 14, backgroundColor: C.ink }}>
                <Text style={{ color: C.bg, fontSize: 11, fontWeight: "700" }}>⏦</Text>
                <Text style={{ color: C.bg, fontSize: 12, fontWeight: "600" }}>Speak</Text>
              </Pressable>
            )}
          </View>
        </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );

  const lastAnswer = [...messages].reverse().find(m => m.role === "assistant")?.content ?? "";
  const translateSheet = <TranslateSheet visible={translating} initialText={input.trim() || lastAnswer} onClose={() => setTranslating(false)} onUse={t => setInput(t.slice(0, MAX_MESSAGE_CHARACTERS))} />;

  const voiceOverlay = <VoiceModeOverlay visible={voice.isVoiceModeActive} voiceState={voice.voiceState} liveTranscript={voice.liveTranscript} onInterrupt={() => void voice.interruptAndListen()} onClose={() => void voice.toggleVoiceMode()} />;

  const modelMenu = (
    <Modal visible={models} transparent animationType="fade" onRequestClose={() => setModels(false)}>
      <Pressable accessibilityLabel="Close model menu" onPress={() => setModels(false)} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
        <View style={{ marginHorizontal: 16, marginBottom: 120, padding: 8, borderRadius: 24, backgroundColor: "#1B1B1B", gap: 2 }}>
          {MODELS.map(m => {
            const on = m.key === picked.key;
            return (
              <Pressable key={m.key} accessibilityRole="button" onPress={() => { setModel(m.key === "build" ? "auto" : m.key); setTab(m.key === "build" ? "build" : "ask"); setModels(false); }}
                style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderRadius: 18, backgroundColor: on ? "#2A2A2A" : "transparent" }}>
                <Text style={{ fontSize: 20, width: 26, textAlign: "center" }}>{m.glyph}</Text>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ color: C.ink, fontSize: 16, fontWeight: "600" }}>{m.label}</Text>
                    {"beta" in m ? <Text style={{ color: C.muted, fontSize: 10, fontWeight: "700", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: "#333" }}>BETA</Text> : null}
                  </View>
                  <Text style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>{m.sub}</Text>
                </View>
                {on ? <Text style={{ color: C.ink, fontSize: 18 }}>✓</Text> : null}
              </Pressable>
            );
          })}
        </View>
      </Pressable>
    </Modal>
  );

  const sheet = <ConnectorsSheet visible={connectors} onClose={() => setConnectors(false)} />;
  const sidebar = <Sidebar visible={menu} onClose={() => setMenu(false)} onNewChat={reset} onOpenChat={id => void openChat(id)} selectedId={chatId} refreshKey={listKey} />;

  if (!wide) return <>{conversation}{sidebar}{sheet}{modelMenu}{voiceOverlay}{translateSheet}</>;
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: C.bg }}>
      <SafeAreaView edges={["top", "left", "bottom"]} style={{ width: 300, borderRightColor: C.line, borderRightWidth: 1 }}>
        <Text style={{ color: C.ink, fontSize: 18, fontWeight: "700", padding: 14 }}>Chats</Text>
        <ChatList theme={darkTheme} onOpen={id => void openChat(id)} selectedId={chatId} refreshKey={listKey} />
      </SafeAreaView>
      <View style={{ flex: 1 }}>{conversation}</View>
      {sheet}{modelMenu}{voiceOverlay}{translateSheet}
    </View>
  );
}
