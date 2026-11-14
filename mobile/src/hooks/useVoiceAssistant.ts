import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";

// Both packages are native modules. They are loaded defensively so an older build, which does not contain them,
// shows a friendly message instead of crashing at start-up.
type Recognizer = typeof import("expo-speech-recognition").ExpoSpeechRecognitionModule;
type SpeechModule = typeof import("expo-speech");

let Recognition: Recognizer | null = null;
let useRecognitionEvent: typeof import("expo-speech-recognition").useSpeechRecognitionEvent = (() => undefined) as never;
let Speech: SpeechModule | null = null;

try {
  const sr = require("expo-speech-recognition") as typeof import("expo-speech-recognition");
  if (sr.ExpoSpeechRecognitionModule && typeof sr.useSpeechRecognitionEvent === "function") {
    Recognition = sr.ExpoSpeechRecognitionModule;
    useRecognitionEvent = sr.useSpeechRecognitionEvent;
  }
} catch { /* native module not in this build */ }

try {
  const sp = require("expo-speech") as SpeechModule;
  if (typeof sp?.speak === "function") Speech = sp;
} catch { /* native module not in this build */ }

export type VoiceState = "idle" | "listening" | "processing" | "speaking";

type Options = {
  /** Mic: spoken words arrive here while the user talks (isFinal is true for the last version of a phrase). */
  onDictationText: (text: string, isFinal: boolean) => void;
  /** Speak: sends what was said to the chat and resolves with the assistant's reply (null when nothing came back). */
  onVoiceTurnSubmit: (transcript: string) => Promise<string | null>;
};

const MAX_EMPTY_TURNS = 3; // in voice mode, stop after this many silent turns in a row so it never loops forever

export function useVoiceAssistant({ onDictationText, onVoiceTurnSubmit }: Options) {
  const [voiceState, setVoiceStateRaw] = useState<VoiceState>("idle");
  const [isVoiceModeActive, setActiveRaw] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");

  // Refs hold the latest values for the native event callbacks, which would otherwise see stale state.
  const stateRef = useRef<VoiceState>("idle");
  const activeRef = useRef(false);
  const transcriptRef = useRef("");
  const emptyTurns = useRef(0);
  const mounted = useRef(true);
  const dictationCb = useRef(onDictationText);
  const turnCb = useRef(onVoiceTurnSubmit);
  dictationCb.current = onDictationText;
  turnCb.current = onVoiceTurnSubmit;

  const setVoiceState = useCallback((s: VoiceState) => { stateRef.current = s; if (mounted.current) setVoiceStateRaw(s); }, []);
  const setActive = useCallback((on: boolean) => { activeRef.current = on; if (mounted.current) setActiveRaw(on); }, []);

  const stopAudio = useCallback(() => {
    try { Recognition?.abort(); } catch { /* nothing running */ }
    try { void Speech?.stop(); } catch { /* nothing speaking */ }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; activeRef.current = false; stopAudio(); };
  }, [stopAudio]);

  const ensurePermissions = useCallback(async () => {
    if (!Recognition) {
      Alert.alert("Update needed", "Voice needs the latest version of the app. Rebuild the app and try again.");
      return false;
    }
    try {
      const perm = await Recognition.requestPermissionsAsync();
      if (perm.granted) return true;
    } catch { /* fall through to the message */ }
    Alert.alert("Microphone permission needed", "Allow the microphone and speech recognition for A-Zee in Android Settings.");
    return false;
  }, []);

  const listen = useCallback(async () => {
    if (!Recognition || stateRef.current === "listening") return;
    if (!(await ensurePermissions())) { setActive(false); setVoiceState("idle"); return; }
    transcriptRef.current = "";
    setLiveTranscript("");
    setVoiceState("listening");
    try {
      Recognition.start({ lang: "en-US", interimResults: true, maxAlternatives: 1, continuous: false, addsPunctuation: true });
    } catch {
      setActive(false); setVoiceState("idle");
      Alert.alert("Voice", "The microphone couldn't be started. Try again.");
    }
  }, [ensurePermissions, setActive, setVoiceState]);

  useRecognitionEvent("result", (event) => {
    const text = event.results?.[0]?.transcript ?? "";
    transcriptRef.current = text;
    setLiveTranscript(text);
    if (!activeRef.current) dictationCb.current(text, Boolean(event.isFinal));
  });

  useRecognitionEvent("end", () => {
    if (stateRef.current !== "listening") return; // we ended it ourselves (abort) or it was already handled
    if (!activeRef.current) { setVoiceState("idle"); return; } // dictation: the words stay in the text box

    const said = transcriptRef.current.trim();
    if (!said) {
      emptyTurns.current += 1;
      if (emptyTurns.current >= MAX_EMPTY_TURNS) { setActive(false); setVoiceState("idle"); return; }
      setVoiceState("idle");
      void listen();
      return;
    }
    emptyTurns.current = 0;
    void (async () => {
      setVoiceState("processing");
      let reply: string | null = null;
      try { reply = await turnCb.current(said); } catch { /* the chat shows its own error; keep listening */ }
      if (!activeRef.current || !mounted.current) return;
      if (reply && Speech) {
        setVoiceState("speaking");
        const again = () => { if (activeRef.current && stateRef.current === "speaking") { setVoiceState("idle"); void listen(); } };
        Speech.speak(speakable(reply), { language: "en-US", rate: 1.0, pitch: 1.0, onDone: again, onError: again });
      } else {
        setVoiceState("idle");
        void listen();
      }
    })();
  });

  useRecognitionEvent("error", () => {
    // A "no-speech" error is followed by an "end" event, which handles it. Other errors end the session quietly.
    if (stateRef.current === "listening" && !activeRef.current) setVoiceState("idle");
  });

  /** Mic button: start or stop dictating into the text box. */
  const toggleDictation = useCallback(async () => {
    if (activeRef.current) { setActive(false); stopAudio(); setVoiceState("idle"); return; }
    if (stateRef.current === "listening") { try { Recognition?.stop(); } catch { /* ignore */ } return; }
    await listen();
  }, [listen, setActive, setVoiceState, stopAudio]);

  /** Speak button: start or end the hands-free conversation. */
  const toggleVoiceMode = useCallback(async () => {
    if (activeRef.current) { setActive(false); stopAudio(); setVoiceState("idle"); setLiveTranscript(""); return; }
    if (!Speech) { Alert.alert("Update needed", "Voice mode needs the latest version of the app. Rebuild the app and try again."); return; }
    emptyTurns.current = 0;
    setActive(true);
    await listen();
  }, [listen, setActive, setVoiceState, stopAudio]);

  /** Tap the orb while A-Zee is talking to cut in and speak. */
  const interruptAndListen = useCallback(async () => {
    if (!activeRef.current) return;
    try { await Speech?.stop(); } catch { /* ignore */ }
    setVoiceState("idle");
    await listen();
  }, [listen, setVoiceState]);

  return { voiceState, isVoiceModeActive, liveTranscript, toggleDictation, toggleVoiceMode, interruptAndListen };
}

/** Strips Markdown so the speech engine doesn't read out symbols. */
export function speakable(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " Code snippet omitted. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 3900); // the speech engine rejects very long text
}
