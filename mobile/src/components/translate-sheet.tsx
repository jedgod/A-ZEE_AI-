import { useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/lib/api";
import { C } from "@/lib/chat-theme";
import { SUPPORTED_LANGUAGES } from "@/lib/languages";
import { resolveAvailableSpeechLocale } from "@/lib/speech-locale";
import { speakable } from "@/hooks/useVoiceAssistant";

type Result = { text: string; language: string; provider: string | null };

/** Translate any text into one of ten languages, read it aloud, or drop it into the chat box. */
export function TranslateSheet({ visible, initialText, onClose, onUse }: { visible: boolean; initialText: string; onClose: () => void; onUse: (text: string) => void }) {
  const [text, setText] = useState("");
  const [target, setTarget] = useState("tw");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shownFor, setShownFor] = useState(false);

  // Each time the sheet opens it starts from whatever was in the chat box.
  if (visible && !shownFor) { setShownFor(true); setText(initialText); setResult(null); setError(""); }
  if (!visible && shownFor) setShownFor(false);

  const lang = SUPPORTED_LANGUAGES.find(l => l.code === target) ?? SUPPORTED_LANGUAGES[0];
  const short = lang.label.split(" ")[0];

  async function translate() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true); setError(""); setResult(null);
    try { setResult(await api<Result>("/api/translate", { method: "POST", body: { text: t, targetLanguage: target } })); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function speak() {
    if (!result) return;
    let speech: typeof import("expo-speech") | null = null;
    try { speech = require("expo-speech"); } catch { /* not in this build */ }
    if (!speech || typeof speech.speak !== "function") { Alert.alert("Update needed", "Reading aloud needs the latest version of the app."); return; }
    const language = await resolveAvailableSpeechLocale(speech, lang);
    void speech.stop();
    speech.speak(speakable(result.text), { language });
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, height: 52 }}>
            <Text style={{ color: C.ink, fontSize: 18, fontWeight: "700" }}>Translate</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={10}><Text style={{ color: C.muted, fontSize: 20 }}>✕</Text></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 14 }}>
            <TextInput accessibilityLabel="Text to translate" value={text} onChangeText={setText} multiline maxLength={20000} placeholder="Type or paste text…" placeholderTextColor={C.muted} selectionColor={C.ink}
              style={{ color: C.ink, fontSize: 15, minHeight: 110, maxHeight: 220, padding: 14, borderRadius: 16, backgroundColor: C.surface, textAlignVertical: "top" }} />
            <Text style={{ color: C.muted, fontSize: 12 }}>Translate into</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {SUPPORTED_LANGUAGES.map(l => {
                const on = l.code === target;
                return (
                  <Pressable key={l.code} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => { setTarget(l.code); setResult(null); }}
                    style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: on ? C.ink : C.surface }}>
                    <Text style={{ color: on ? C.bg : C.ink, fontSize: 13, fontWeight: "500" }}>{l.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable accessibilityRole="button" onPress={() => void translate()} disabled={busy || !text.trim()}
              style={{ height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: C.ink, opacity: busy || !text.trim() ? 0.5 : 1 }}>
              {busy ? <ActivityIndicator color={C.bg} /> : <Text style={{ color: C.bg, fontSize: 15, fontWeight: "600" }}>Translate to {lang.label}</Text>}
            </Pressable>
            {error ? <Text style={{ color: "#f87171", fontSize: 13 }}>{error}</Text> : null}
            {result ? (
              <View style={{ padding: 14, borderRadius: 16, backgroundColor: C.surface, gap: 12 }}>
                <Text selectable style={{ color: C.ink, fontSize: 16, lineHeight: 23 }}>{result.text}</Text>
                {lang.fallbackSpeechLocale ? <Text style={{ color: C.muted, fontSize: 12 }}>Few phones have a {short} voice installed, so it may be read with an English voice. Machine translation of {short} can be imperfect.</Text> : null}
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Pressable accessibilityRole="button" onPress={() => void speak()} style={{ paddingHorizontal: 14, height: 34, borderRadius: 17, backgroundColor: C.pill, alignItems: "center", justifyContent: "center" }}><Text style={{ color: C.ink, fontSize: 13 }}>🔊 Listen</Text></Pressable>
                  <Pressable accessibilityRole="button" onPress={() => { onUse(result.text); onClose(); }} style={{ paddingHorizontal: 14, height: 34, borderRadius: 17, backgroundColor: C.pill, alignItems: "center", justifyContent: "center" }}><Text style={{ color: C.ink, fontSize: 13 }}>Use in chat</Text></Pressable>
                </View>
              </View>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
