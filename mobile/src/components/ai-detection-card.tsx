import { Image, Pressable, Text, View } from "react-native";
import { C } from "@/lib/chat-theme";

export type PixelScores = { aiGeneratedScore: number; deepfakeScore: number };

export type AiDetectionResult = {
  scanId?: string;
  verdict: "AI_GENERATED" | "LIKELY_REAL" | "INCONCLUSIVE";
  /** 0-100 */
  confidence: number;
  pixelScores?: PixelScores | null;
  likelySource: string;
  signals: string[];
  verification?: {
    publicIndex: {
      status: "checked" | "not_configured" | "unavailable";
      matches: { url: string; observedAt: string; kind: "exact" | "possible" }[];
      indexedImages?: number;
    };
  } | null;
  previewUrl?: string;
};

const ROSE = "#f43f5e", AMBER = "#f59e0b", EMERALD = "#10b981";
const VERDICTS = {
  AI_GENERATED: { label: "SIGNED AI CLAIM", color: ROSE, bg: "rgba(244,63,94,0.16)", glyph: "⚠" },
  LIKELY_REAL: { label: "LIKELY REAL", color: EMERALD, bg: "rgba(16,185,129,0.16)", glyph: "✓" },
  INCONCLUSIVE: { label: "INCONCLUSIVE", color: AMBER, bg: "rgba(245,158,11,0.16)", glyph: "?" },
} as const;

export function AiDetectionCard({ result, onDelete }: { result: AiDetectionResult; onDelete?: (scanId: string) => void }) {
  const resultIsCurrent = Boolean(result.verification);
  const v = resultIsCurrent ? VERDICTS[result.verdict] ?? VERDICTS.INCONCLUSIVE : VERDICTS.INCONCLUSIVE;
  const index = result.verification?.publicIndex;
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

        </View>
      ) : null}

      <View style={{ padding: 14, gap: 12 }}>
        {!resultIsCurrent && <Text style={{ color: C.muted }}>Previous scan. Scan again to verify signed credentials.</Text>}
        {index && (
          <View style={[box, { padding: 12, gap: 6 }]}>
            <Text style={{ color: C.ink, fontWeight: "700" }}>Public image matches</Text>
            <Text style={{ color: C.muted }}>{index.status === "checked"
              ? `${index.matches.length ? "Showing " + index.matches.length + " matches." : "No matches found."} A-Zee index: ${index.indexedImages ?? 0} source entries.`
              : index.status === "unavailable" ? "The A-Zee index could not be checked." : "Public matching is not configured."}</Text>
            {index.matches.map(match => (
              <View key={match.url}>
                <Text style={{ color: C.ink }}>{match.kind === "exact" ? "Exact file" : "Possible visual match"} · Observed {match.observedAt.slice(0, 10)}</Text>
                <Text selectable style={{ color: C.muted }}>{match.url}</Text>
              </View>
            ))}
          </View>
        )}

        {resultIsCurrent && result.signals.length ? (
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
