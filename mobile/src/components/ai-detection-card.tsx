import type { Classification, Discovery } from "@/lib/image-provider-types";
import { Image, Linking, Pressable, Text, View } from "react-native";
import { C } from "@/lib/chat-theme";

export type PixelScores = { aiGeneratedScore: number; deepfakeScore: number };

export type GoogleSection =
  | { status: "ran"; model: string; observations: { summary: string; visibleText: string[]; placeClues: string[]; captureClues: string[]; aiArtifactClues: string[]; limits: string } }
  | { status: "skipped" | "unavailable"; reason: string };

export type AiDetectionResult = {
  scanId?: string;
  verdict: "AI_GENERATED" | "LIKELY_REAL" | "INCONCLUSIVE";
  /** Compatibility value, not a probability. */
  confidence: number;
  pixelScores?: PixelScores | null;
  likelySource: string;
  signals: string[];
  verification?: {
    classification?: Classification;
    discovery?: Discovery;
    credential?: "trusted_ai_creation" | "trusted_other" | "untrusted" | "invalid" | "absent" | "unavailable";
    publicIndex: {
      status: "checked" | "not_configured" | "unavailable";
      matches: { url: string; observedAt: string; kind: "exact" | "possible"; provider?: string; method?: "region" }[];
      indexedImages?: number;
    };
    google?: GoogleSection;
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
  const v = result.verification?.credential === "trusted_ai_creation" ? VERDICTS.AI_GENERATED : VERDICTS.INCONCLUSIVE;
  const index = result.verification?.publicIndex;
  const google = result.verification?.google;
  const classification = result.verification?.classification;
  const discovery = result.verification?.discovery;
  const box = { backgroundColor: C.bg, borderColor: C.line, borderWidth: 1, borderRadius: 12 };
  return (
    <View style={{ marginVertical: 8, borderRadius: 18, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, overflow: "hidden", maxWidth: 340 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line }}>
        <Text style={{ color: C.ink, fontSize: 13, fontWeight: "600" }}>🔍  A-Zee Image Evidence</Text>
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
        <Text style={{ color: C.muted, fontSize: 12 }}>{"Signed provenance, estimated AI classification, local copies and public web matches are separate evidence. Estimates can be wrong. Public search covers only the provider index, not private messages/profiles or every social post. A match does not prove the original source."}</Text>
        {!resultIsCurrent && <Text style={{ color: C.muted }}>Previous scan. Scan again to verify signed credentials.</Text>}
        {index && (
          <View style={[box, { padding: 12, gap: 6 }]}>
            <Text style={{ color: C.ink, fontWeight: "700" }}>Configured local copy matches</Text>
            <Text style={{ color: C.muted }}>{index.status === "checked"
              ? `${index.matches.length ? "Showing " + index.matches.length + " matches." : "No matches in the configured local index."} A-Zee index: ${index.indexedImages ?? 0} source entries.`
              : index.status === "unavailable" ? "The A-Zee index could not be checked." : "Local copy matching is not configured."}</Text>
            {index.matches.map(match => (
              <View key={match.url}>
                <Text style={{ color: C.ink }}>{match.kind === "exact" ? "Exact file" : match.method === "region" ? "Possible shared image region" : "Possible visual match"} · Observed {match.observedAt.slice(0, 10)}{match.provider ? ` · ${match.provider}` : ""}</Text>
                <Text selectable style={{ color: C.muted }}>{match.url}</Text>
              </View>
            ))}
          </View>
        )}

        {classification && (
          <View style={[box, { padding: 12, gap: 6 }]}>
            <Text style={{ color: C.ink, fontWeight: "700" }}>Estimated AI classification - Sightengine</Text>
            {classification.status === "checked" ? <>
              <Text style={{ color: C.ink }}>{classification.label === "LIKELY_AI" ? "Likely AI-generated" : classification.label === "LOW_AI_SIGNAL" ? "Low AI signal; authenticity unknown" : "Inconclusive estimate"} ? Provider score {Math.round(classification.score * 100)} / 100</Text>
              <Text style={{ color: C.muted }}>Model: {classification.model} (provider-managed version). Not calibrated by A-Zee; this score is not a verified probability or signed declaration. Checked {classification.checkedAt.slice(0, 10)}.</Text>
            </> : <Text style={{ color: C.muted }}>{classification.status}: {classification.reason}</Text>}
          </View>
        )}
        {discovery && (
          <View style={[box, { padding: 12, gap: 6 }]}>
            <Text style={{ color: C.ink, fontWeight: "700" }}>Public web and social links - Google Cloud Vision</Text>
            {discovery.status === "checked" ? <>
              <Text style={{ color: C.muted }}>{discovery.matches.length ? "Provider-reported visual matches:" : "No matches returned within this provider's public index."} Checked {discovery.checkedAt.slice(0, 10)}. No private content or direct social-account access.</Text>
              {discovery.matches.map(match => <View key={match.url} style={{ gap: 3 }}>
                <Text style={{ color: C.ink }}>{match.platform} ? {match.kind.replaceAll("_", " ")}</Text>
                <Pressable accessibilityRole="link" onPress={() => { if (match.url.startsWith("https://")) void Linking.openURL(match.url).catch(() => undefined); }}><Text selectable style={{ color: C.muted, textDecorationLine: "underline" }}>{match.url}</Text></Pressable>
              </View>)}
            </> : <Text style={{ color: C.muted }}>{discovery.status}: {discovery.reason}</Text>}
          </View>
        )}
        {google && (
          <View style={[box, { padding: 12, gap: 8 }]}>
            <Text style={{ color: C.ink, fontWeight: "700" }}>Visual clues from Google Gemini</Text>
            {google.status === "ran" ? (
              <>
                <Text style={{ color: C.ink, fontSize: 13, lineHeight: 18 }}>{google.observations.summary}</Text>
                {([["TEXT IN THE PICTURE", google.observations.visibleText], ["PLACE CLUES", google.observations.placeClues], ["HOW IT SEEMS TO HAVE BEEN MADE OR CAPTURED", google.observations.captureClues], ["VISUAL SIGNS OF AI OR EDITING", google.observations.aiArtifactClues]] as [string, string[]][]).filter(([, items]) => items.length).map(([label, items]) => (
                  <View key={label} style={{ gap: 3 }}>
                    <Text style={{ color: C.muted, fontSize: 10, fontWeight: "700", letterSpacing: 0.6 }}>{label}</Text>
                    {items.map(item => <Text key={item} style={{ color: C.ink, fontSize: 13, lineHeight: 18 }}>• {item}</Text>)}
                  </View>
                ))}
                {google.observations.limits ? <Text style={{ color: C.muted, fontSize: 12 }}>{google.observations.limits}</Text> : null}
                <Text style={{ color: C.muted, fontSize: 11, lineHeight: 15 }}>Described by Google's Gemini. These are clues from a model, not proof of where the picture came from, and they do not change the AI-origin result above.</Text>
              </>
            ) : <Text style={{ color: C.muted }}>{google.reason}</Text>}
          </View>
        )}
        {resultIsCurrent && result.signals.length ? (
          <View style={{ gap: 5 }}>
            <Text style={{ color: C.muted, fontSize: 10, fontWeight: "700", letterSpacing: 0.6 }}>SIGNED PROVENANCE AND METADATA CLUES</Text>
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
