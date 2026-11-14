import { useEffect, useRef } from "react";
import { Animated, Modal, Pressable, Text, View } from "react-native";
import type { VoiceState } from "@/hooks/useVoiceAssistant";

const STATUS: Record<VoiceState, string> = {
  idle: "Starting voice…",
  listening: "Listening…",
  processing: "A-Zee is thinking…",
  speaking: "Speaking · tap the circle to interrupt",
};
const RING: Record<VoiceState, string> = { idle: "#3f3f46", listening: "#10b981", processing: "#3f3f46", speaking: "#a855f7" };
const GLYPH: Record<VoiceState, string> = { idle: "✦", listening: "🎙", processing: "✦", speaking: "🔊" };

/** Full-screen hands-free conversation view: a pulsing circle, what you are saying, and an End button. */
export function VoiceModeOverlay({ visible, voiceState, liveTranscript, onInterrupt, onClose }: {
  visible: boolean; voiceState: VoiceState; liveTranscript: string; onInterrupt: () => void; onClose: () => void;
}) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visible) return;
    const peak = voiceState === "listening" ? 1.12 : voiceState === "speaking" ? 1.2 : 1.04;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: peak, duration: 650, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [visible, voiceState, pulse]);

  const ring = RING[voiceState];
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#000", justifyContent: "space-between", alignItems: "center", paddingVertical: 56, paddingHorizontal: 24 }}>
        <View style={{ alignItems: "center", gap: 6 }}>
          <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700" }}>A-Zee Voice</Text>
          <Text style={{ color: "#a1a1aa", fontSize: 11, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, borderWidth: 1, borderColor: "#27272a", backgroundColor: "#18181b" }}>Hands-free conversation</Text>
        </View>

        <View style={{ alignItems: "center", gap: 22, width: "100%" }}>
          <Pressable accessibilityRole="button" accessibilityLabel={STATUS[voiceState]} onPress={voiceState === "speaking" ? onInterrupt : undefined}>
            <Animated.View style={{ width: 152, height: 152, borderRadius: 76, borderWidth: 2, borderColor: ring, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(24,24,27,0.7)", transform: [{ scale: pulse }] }}>
              <View style={{ width: 102, height: 102, borderRadius: 51, alignItems: "center", justifyContent: "center", backgroundColor: ring }}>
                <Text style={{ fontSize: 32, color: "#fff" }}>{GLYPH[voiceState]}</Text>
              </View>
            </Animated.View>
          </Pressable>
          <Text style={{ color: "#e4e4e7", fontSize: 15, fontWeight: "600", textAlign: "center" }}>{STATUS[voiceState]}</Text>
          {liveTranscript ? <Text numberOfLines={4} style={{ color: "#a1a1aa", fontSize: 15, lineHeight: 22, textAlign: "center", paddingHorizontal: 12 }}>“{liveTranscript}”</Text> : null}
        </View>

        <Pressable accessibilityRole="button" accessibilityLabel="End voice mode" onPress={onClose} style={{ backgroundColor: "#ef4444", paddingHorizontal: 28, paddingVertical: 14, borderRadius: 999 }}>
          <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>✕  End voice mode</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
