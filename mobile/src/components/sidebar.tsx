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
        <SafeAreaView style={{ width: "82%", maxWidth: 360, backgroundColor: C.bg, borderRightColor: C.line, borderRightWidth: 1 }}>
          <View style={{ padding: 16 }}><Logo size={22} /></View>
          <Pressable accessibilityRole="button" onPress={() => { onClose(); onNewChat(); }}
            style={{ marginHorizontal: 14, marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.surface, borderRadius: 14, paddingHorizontal: 14, height: 48 }}>
            <Text style={{ color: C.ink, fontSize: 20 }}>✎</Text>
            <Text style={{ color: C.ink, fontSize: 16, fontWeight: "600" }}>New chat</Text>
          </Pressable>
          {LINKS.map(l => (
            <Pressable key={l.href} accessibilityRole="button" onPress={() => go(l.href)} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, height: 44 }}>
              <Text style={{ color: C.muted, fontSize: 18, width: 24, textAlign: "center" }}>{l.glyph}</Text>
              <Text style={{ color: C.ink, fontSize: 16 }}>{l.label}</Text>
              {"badge" in l ? <Text style={{ color: C.muted, fontSize: 11, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 9, backgroundColor: C.surface, overflow: "hidden" }}>{l.badge}</Text> : null}
            </Pressable>
          ))}
          <Text style={{ color: C.muted, fontSize: 13, fontWeight: "600", paddingHorizontal: 20, paddingTop: 14, paddingBottom: 4 }}>CHATS</Text>
          <View style={{ flex: 1 }}>
            <ChatList theme={darkTheme} selectedId={selectedId} refreshKey={refreshKey} onOpen={id => { onClose(); onOpenChat(id); }} />
          </View>
          <Pressable accessibilityRole="button" onPress={() => go("/account")} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderTopColor: C.line, borderTopWidth: 1 }}>
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.pill, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: C.ink, fontWeight: "700" }}>{(user?.name ?? "?").slice(0, 1).toUpperCase()}</Text>
            </View>
            <Text numberOfLines={1} style={{ color: C.ink, fontSize: 15, flex: 1 }}>{user?.name ?? "Account"}</Text>
          </Pressable>
        </SafeAreaView>
        <Pressable accessibilityLabel="Close menu" onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)" }} />
      </View>
    </Modal>
  );
}
