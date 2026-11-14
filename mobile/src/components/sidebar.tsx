import { Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChatList } from "./chat-list";
import { Logo } from "./logo";
import { useAuth } from "@/lib/auth";
import { C } from "@/lib/chat-theme";
import { darkTheme } from "@/lib/theme";

const LINKS = [
  { label: "Favorites", glyph: "★", href: "/favorites" },
  { label: "Prompt library", glyph: "▤", href: "/library" },
  { label: "AZTrade", glyph: "📈", href: "/aztrade", badge: "Paper" },
  { label: "Notifications", glyph: "🔔", href: "/notifications" },
  { label: "Settings & account", glyph: "⚙", href: "/account" },
] as const;

/** Slide-over menu opened by the hamburger: New chat, saved chats, other pages and the profile. */
export function Sidebar({ visible, onClose, onNewChat, onOpenChat, selectedId, refreshKey }: {
  visible: boolean; onClose: () => void; onNewChat: () => void; onOpenChat: (id: string) => void; selectedId: string; refreshKey: number;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const go = (href: (typeof LINKS)[number]["href"]) => { onClose(); router.push(href); };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, flexDirection: "row" }}>
        <SafeAreaView style={{ width: "62%", maxWidth: 260, backgroundColor: C.bg, borderRightColor: C.line, borderRightWidth: 1 }}>
          <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}><Logo size={14} /></View>
          <Pressable accessibilityRole="button" onPress={() => { onClose(); onNewChat(); }}
            style={{ marginHorizontal: 8, marginBottom: 2, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.surface, borderRadius: 10, paddingHorizontal: 10, height: 32 }}>
            <Text style={{ color: C.ink, fontSize: 13 }}>✎</Text>
            <Text style={{ color: C.ink, fontSize: 12.5, fontWeight: "600" }}>New chat</Text>
          </Pressable>
          {LINKS.map(l => (
            <Pressable key={l.href} accessibilityRole="button" onPress={() => go(l.href)} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 30 }}>
              <Text style={{ color: C.muted, fontSize: 12, width: 18, textAlign: "center" }}>{l.glyph}</Text>
              <Text style={{ color: C.ink, fontSize: 12 }}>{l.label}</Text>
              {"badge" in l ? <Text style={{ color: C.muted, fontSize: 9, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 7, backgroundColor: C.surface, overflow: "hidden" }}>{l.badge}</Text> : null}
            </Pressable>
          ))}
          <Text style={{ color: C.muted, fontSize: 9.5, fontWeight: "700", letterSpacing: 0.6, paddingHorizontal: 12, paddingTop: 6, paddingBottom: 2 }}>CHATS</Text>
          <View style={{ flex: 1 }}>
            <ChatList compact theme={darkTheme} selectedId={selectedId} refreshKey={refreshKey} onOpen={id => { onClose(); onOpenChat(id); }} />
          </View>
          <Pressable accessibilityRole="button" onPress={() => go("/account")} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderTopColor: C.line, borderTopWidth: 1 }}>
            <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: C.pill, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: C.ink, fontWeight: "700", fontSize: 11 }}>{(user?.name ?? "?").slice(0, 1).toUpperCase()}</Text>
            </View>
            <Text numberOfLines={1} style={{ color: C.ink, fontSize: 12, flex: 1 }}>{user?.name ?? "Account"}</Text>
          </Pressable>
        </SafeAreaView>
        <Pressable accessibilityLabel="Close menu" onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)" }} />
      </View>
    </Modal>
  );
}
