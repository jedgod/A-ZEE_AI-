import { useCallback, useState } from "react";
import { FlatList, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Empty, ErrorText, Title } from "@/components/ui";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";

type Note = { id: string; title: string; body: string | null; read: boolean; createdAt: string };

export default function Notifications() {
  const t = useTheme();
  const [items, setItems] = useState<Note[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => { try { setItems(await api<Note[]>("/api/notifications")); setError(""); } catch (e) { setError((e as Error).message); setItems(i => i ?? []); } }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const mark = async (body: { id: string } | { all: true }) => { try { await api("/api/notifications", { method: "PATCH", body }); await load(); } catch (e) { setError((e as Error).message); } };
  const unread = items?.filter(n => !n.read).length ?? 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["top", "left", "right"]}>
      <View style={{ padding: 20, paddingBottom: 8 }}>
        <Title sub={unread ? `${unread} unread` : "You're all caught up."}>Alerts</Title>
        {unread > 0 && <Button title="Mark all read" variant="outline" onPress={() => mark({ all: true })} />}
      </View>
      <ErrorText>{error}</ErrorText>
      <FlatList data={items ?? []} keyExtractor={n => n.id}
        ListEmptyComponent={items === null ? <Empty>Loading…</Empty> : <Empty>No notifications.</Empty>}
        renderItem={({ item }) => (
          <View style={{ padding: 14, borderBottomColor: t.line, borderBottomWidth: 1, backgroundColor: item.read ? "transparent" : t.card }}>
            <Text style={{ color: t.ink, fontSize: 16, fontWeight: item.read ? "500" : "700" }}>{item.read ? "" : "● "}{item.title}</Text>
            {item.body ? <Text style={{ color: t.muted, marginTop: 4, lineHeight: 20 }}>{item.body}</Text> : null}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
              <Text style={{ color: t.muted, fontSize: 12 }}>{new Date(item.createdAt).toLocaleString()}</Text>
              {!item.read && <Text accessibilityRole="button" onPress={() => mark({ id: item.id })} style={{ color: t.accent, fontWeight: "600" }}>Mark read</Text>}
            </View>
          </View>
        )} />
    </SafeAreaView>
  );
}
