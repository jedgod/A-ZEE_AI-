import type { ReactNode } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme";

/** A scrolling, keyboard-aware page. `narrow` keeps forms readable on tablets. */
export function Screen({ children, narrow = false, scroll = true, edges }: { children: ReactNode; narrow?: boolean; scroll?: boolean; edges?: ("top" | "bottom" | "left" | "right")[] }) {
  const t = useTheme();
  const body = <View style={[styles.body, narrow && styles.narrow]}>{children}</View>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={edges ?? ["top", "left", "right"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {scroll ? <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">{body}</ScrollView> : body}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Title({ children, sub }: { children: ReactNode; sub?: string }) {
  const t = useTheme();
  return (
    <View style={{ marginBottom: 16 }}>
      <Text accessibilityRole="header" style={{ color: t.ink, fontSize: 28, fontWeight: "700" }}>{children}</Text>
      {sub ? <Text style={{ color: t.muted, fontSize: 14, marginTop: 4 }}>{sub}</Text> : null}
    </View>
  );
}

export function Body({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: object }) {
  const t = useTheme();
  return <Text style={[{ color: muted ? t.muted : t.ink, fontSize: 15, lineHeight: 22 }, style]}>{children}</Text>;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[{ backgroundColor: t.card, borderColor: t.line, borderWidth: StyleSheet.hairlineWidth * 2, borderRadius: 14, padding: 14 }, style]}>{children}</View>;
}

export function Button({ title, onPress, busy, disabled, variant = "primary", style }: {
  title: string; onPress: () => void; busy?: boolean; disabled?: boolean; variant?: "primary" | "outline" | "danger" | "ghost"; style?: ViewStyle;
}) {
  const t = useTheme();
  const off = disabled || busy;
  const palette = {
    primary: { bg: t.accent, ink: t.accentInk, border: t.accent },
    danger: { bg: t.danger, ink: "#ffffff", border: t.danger },
    outline: { bg: "transparent", ink: t.ink, border: t.line },
    ghost: { bg: "transparent", ink: t.accent, border: "transparent" },
  }[variant];
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!off, busy: !!busy }} disabled={off} onPress={onPress}
      style={({ pressed }) => [{ backgroundColor: palette.bg, borderColor: palette.border, borderWidth: 1, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", minHeight: 48, opacity: off ? 0.55 : pressed ? 0.85 : 1 }, style]}>
      {busy ? <ActivityIndicator color={palette.ink} /> : <Text style={{ color: palette.ink, fontSize: 16, fontWeight: "600" }}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const t = useTheme();
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: t.ink, fontSize: 14, fontWeight: "600", marginBottom: 6 }}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor={t.muted} autoCapitalize="none" autoCorrect={false}
        style={{ color: t.ink, backgroundColor: t.card, borderColor: t.line, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, minHeight: 48 }} {...props} />
    </View>
  );
}

export function ErrorText({ children }: { children?: string | null }) {
  const t = useTheme();
  return children ? <Text accessibilityRole="alert" style={{ color: t.danger, fontSize: 14, marginBottom: 12 }}>{children}</Text> : null;
}

export function Empty({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={{ color: t.muted, fontSize: 15, textAlign: "center", padding: 28 }}>{children}</Text>;
}

export function Loading() {
  const t = useTheme();
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.bg }}><ActivityIndicator color={t.accent} size="large" /></View>;
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1 },
  body: { flex: 1, padding: 20, width: "100%" },
  narrow: { maxWidth: 520, alignSelf: "center" },
});
