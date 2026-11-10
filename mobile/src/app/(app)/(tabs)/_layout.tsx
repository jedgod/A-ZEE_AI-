import { useEffect, useState } from "react";
import { AppState, Text, type ColorValue } from "react-native";
import { Tabs } from "expo-router";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";

const icon = (glyph: string) => ({ color }: { color: ColorValue }) => <Text style={{ color, fontSize: 20 }}>{glyph}</Text>;

/** The unread count for the Notifications tab, refreshed every minute and whenever the app returns to the foreground. */
function useUnread() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => api<{ count: number }>("/api/notifications/unread-count").then(r => { if (alive) setCount(r.count); }).catch(() => undefined);
    void load();
    const timer = setInterval(load, 60_000);
    const sub = AppState.addEventListener("change", s => { if (s === "active") void load(); });
    return () => { alive = false; clearInterval(timer); sub.remove(); };
  }, []);
  return count;
}

export default function TabsLayout() {
  const t = useTheme();
  const unread = useUnread();
  return (
    <Tabs screenOptions={{
      headerShown: false, tabBarActiveTintColor: t.accent, tabBarInactiveTintColor: t.muted,
      tabBarStyle: { backgroundColor: t.card, borderTopColor: t.line },
    }}>
      <Tabs.Screen name="index" options={{ title: "Chat", tabBarIcon: icon("💬") }} />
      <Tabs.Screen name="history" options={{ title: "History", tabBarIcon: icon("🕘") }} />
      <Tabs.Screen name="favorites" options={{ title: "Favorites", tabBarIcon: icon("★") }} />
      <Tabs.Screen name="library" options={{ title: "Library", tabBarIcon: icon("📚") }} />
      <Tabs.Screen name="notifications" options={{ title: "Alerts", tabBarIcon: icon("🔔"), tabBarBadge: unread > 0 ? (unread > 9 ? "9+" : unread) : undefined }} />
      <Tabs.Screen name="account" options={{ title: "Account", tabBarIcon: icon("👤") }} />
    </Tabs>
  );
}
