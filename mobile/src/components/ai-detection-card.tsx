import { Image, Pressable, Text, View } from "react-native";
import { C } from "@/lib/chat-theme";

export type PixelScores = { aiGeneratedScore: number; deepfakeScore: number };

export type AiDetectionResult = {
  scanId?: string;
  verdict: "AI_GENERATED" | "LIKELY_REAL" | "INCONCLUSIVE";
  /** 0-100 */
  confidence: number;
  /** Present when a pixel-level classifier ran; otherwise only the overall confidence is shown. */
  pixelScores?: PixelScores | null;
  likelySource: string;
  signals: string[];
  previewUrl?: string;
};

const ROSE = "#f43f5e", AMBER = "#f59e0b", EMERALD = "#10b981";
const pct = (n: number) => Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 0)));
/** High synthetic probability is red, mixed is amber, low is green. */
const meterColor = (score: number) => (score >= 70 ? ROSE : score >= 35 ? AMBER : EMERALD);

const VERDICTS = {
  AI_GENERATED: { label: "AI GENERATED", color: ROSE, bg: "rgba(244,63,94,0.16)", glyph: "⚠" },
  LIKELY_REAL: { label: "LIKELY REAL", color: EMERALD, bg: "rgba(16,185,129,0.16)", glyph: "✓" },
  INCONCLUSIVE: { label: "INCONCLUSIVE", color: AMBER, bg: "rgba(245,158,11,0.16)", glyph: "?" },
} as const;

function Meter({ glyph, label, score, color }: { glyph?: string; label: string; score: number; color: string }) {
  return (
    <View accessible accessibilityLabel={`${label} ${score} percent`} style={{ gap: 5 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: C.muted, fontSize: 12, fontWeight: "500" }}>{glyph ? `${glyph}  ${label}` : label}</Text>
        <Text style={{ color, fontSize: 12, fontWeight: "700" }}>{score}%</Text>
      </View>
      <View style={{ height: 6, backgroundColor: C.pill, borderRadius: 999, overflow: "hidden" }}>
        <View style={{ width: `${score}%`, height: "100%", backgroundColor: color, borderRadius: 999 }} />
      </View>
    </View>
  );
}

/**
 * The result of an AI-image check: verdict badge, the scanned photo, two meters (GenAI diffusion and face
 * deepfake) when pixel scores are available or a single overall meter when they are not, the suspected
 * source, and the forensic clues. It only displays a result; nothing in the app produces one yet.
 */
export function AiDetectionCard({ result, onDelete }: { result: AiDetectionResult; onDelete?: (scanId: string) => void }) {
  const v = VERDICTS[result.verdict] ?? VERDICTS.INCONCLUSIVE;
  const confidence = pct(result.confidence);
  const scores = result.pixelScores;
  const box = { backgroundColor: C.bg, borderColor: C.line, borderWidth: 1, borderRadius: 12 };

  return (
    <View style={{ marginVertical: 8, borderRadius: 18, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, overflow: "hidden", maxWidth: 340 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line }}>
        <Text style={{ color: C.ink, fontSize: 13, fontWeight: "600" }}>🔍  A-Zee AI Detector</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 1, borderColor: v.color, backgroundColor: v.bg }}>
            <Text style={{ color: v.color, fontSize: 10, fontWeight: "700" }}>{v.label}</Text>
          </View>
          {result.scanId && onDelete ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Delete scan" hitSlop={10} onPress={() => onDelete(result.scanId!)}>
              <Text style={{ color: C.muted, fontSize: 16 }}>🗑</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {result.previewUrl ? (
        <View style={{ height: 140, width: "100%", backgroundColor: "#000" }}>
          <Image source={{ uri: result.previewUrl }} accessibilityLabel="Scanned image" style={{ width: "100%", height: "100%", opacity: 0.9 }} resizeMode="cover" />
          <View style={{ position: "absolute", right: 8, bottom: 8, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(0,0,0,0.82)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: C.pill }}>
            <Text style={{ color: v.color, fontSize: 12, fontWeight: "700" }}>{v.glyph}</Text>
            <Text style={{ color: C.ink, fontSize: 12, fontWeight: "700" }}>{confidence}%</Text>
          </View>
        </View>
      ) : null}

      <View style={{ padding: 14, gap: 12 }}>
        {scores ? (
          <View style={[box, { gap: 10, padding: 10 }]}>
            <Meter glyph="⚙" label="GenAI Diffusion" score={pct(scores.aiGeneratedScore)} color={meterColor(pct(scores.aiGeneratedScore))} />
            <Meter glyph="☺" label="Face Deepfake" score={pct(scores.deepfakeScore)} color={meterColor(pct(scores.deepfakeScore))} />
          </View>
        ) : (
          <Meter label="Overall Confidence" score={confidence} color={v.color} />
        )}

        <View style={[box, { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8 }]}>
          <Text style={{ color: C.muted, fontSize: 12 }}>Suspected Source</Text>
          <Text numberOfLines={1} style={{ color: C.ink, fontSize: 12, fontWeight: "600", maxWidth: 170 }}>{result.likelySource}</Text>
        </View>

        {result.signals.length ? (
          <View style={{ gap: 5 }}>
            <Text style={{ color: C.muted, fontSize: 10, fontWeight: "700", letterSpacing: 0.6 }}>FORENSIC SIGNALS</Text>
            {result.signals.map((clue, i) => (
              <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
                <Text style={{ color: C.muted, fontSize: 13, lineHeight: 17 }}>•</Text>
                <Text style={{ flex: 1, color: C.ink, fontSize: 13, lineHeight: 17 }}>{clue}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}
