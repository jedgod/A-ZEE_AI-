import { Platform, Text, View } from "react-native";
import { useTheme } from "@/lib/theme";

const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

/** Plain text with fenced code blocks shown in a monospace box (selectable, so people can copy). */
export function MessageText({ text, color }: { text: string; color: string }) {
  const t = useTheme();
  const parts = text.split(/```[^\n]*\n?/);
  return (
    <View style={{ gap: 8 }}>
      {parts.map((part, i) => {
        if (!part.trim()) return null;
        const isCode = i % 2 === 1;
        return isCode ? (
          <View key={i} style={{ backgroundColor: t.bg, borderColor: t.line, borderWidth: 1, borderRadius: 10, padding: 10 }}>
            <Text selectable style={{ color: t.ink, fontFamily: MONO, fontSize: 13, lineHeight: 19 }}>{part.replace(/\n$/, "")}</Text>
          </View>
        ) : (
          <Text key={i} selectable style={{ color, fontSize: 16, lineHeight: 23 }}>{part.trim()}</Text>
        );
      })}
    </View>
  );
}
