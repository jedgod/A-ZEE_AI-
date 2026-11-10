import { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Empty, ErrorText } from "./ui";
import { deleteChat, listChats, type ChatSummary } from "@/lib/chat";
import { useTheme } from "@/lib/theme";

/** The signed-in user's saved chats. Tap to open, long-press to delete. Used by History and the tablet sidebar. */
export function ChatList({ onOpen, selectedId, refreshKey }: { onOpen: (id: string) => void; selectedId?: string | null; refreshKey?: number }) {
  const t = useTheme();
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setChats(await listChats()); setError(""); } catch (e) { setError((e as Error).message); setChats(c => c ?? []); }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { void load(); }, [load, refreshKey]));

  const remove = (chat: ChatSummary) => Alert.alert("Delete chat?", chat.title, [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: async () => { try { await deleteChat(chat.id); await load(); } catch (e) { setError((e as Error).message); } } },
  ]);

  return (
    <View style={{ flex: 1 }}>
      <ErrorText>{error}</ErrorText>
      <FlatList
        data={chats ?? []} keyExtractor={c => c.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={t.accent} />}
        ListEmptyComponent={chats === null ? <Empty>Loading…</Empty> : <Empty>No chats yet. Start one in the Chat tab.</Empty>}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" accessibilityLabel={`Open chat ${item.title}`} onPress={() => onOpen(item.id)} onLongPress={() => remove(item)}
            style={{ paddingVertical: 12, paddingHorizontal: 14, borderBottomColor: t.line, borderBottomWidth: 1, backgroundColor: item.id === selectedId ? t.card : "transparent" }}>
            <Text numberOfLines={1} style={{ color: t.ink, fontSize: 16, fontWeight: "600" }}>{item.title}</Text>
            <Text style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>{item.mode} · {new Date(item.updatedAt).toLocaleDateString()}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}
