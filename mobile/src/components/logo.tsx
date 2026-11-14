import { Text, View } from "react-native";
import { C } from "@/lib/chat-theme";

/** The A-Zee mark: a ring with an "A" and the wordmark beside it. */
export function Logo({ size = 24, color = C.ink, wordmark = true }: { size?: number; color?: string; wordmark?: boolean }) {
  return (
    <View accessibilityRole="image" accessibilityLabel="A-Zee" style={{ flexDirection: "row", alignItems: "center", gap: size * 0.32 }}>
      <View style={{ width: size * 1.5, height: size * 1.5, borderRadius: size * 0.75, borderWidth: Math.max(2, size * 0.1), borderColor: color, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color, fontSize: size * 0.9, fontWeight: "800", includeFontPadding: false, lineHeight: size * 1.05 }}>A</Text>
      </View>
      {wordmark ? <Text style={{ color, fontSize: size, fontWeight: "700", letterSpacing: 0.3 }}>A-Zee</Text> : null}
    </View>
  );
}
