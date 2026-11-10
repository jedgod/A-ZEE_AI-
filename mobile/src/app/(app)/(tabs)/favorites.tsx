import { useCallback, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Empty, ErrorText, Title } from "@/components/ui";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";

type Fav = { id: string; title: string; mode: string; updatedAt: string };

export default function Favorites() {
  const t = useTheme();
  const router = useRouter();
  const [items, setItems] = useState<Fav[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => { try { setItems(await api<Fav[]>("/api/favorites")); setError(""); } catch (e) { setError((e as Error).message); setItems(i => i ?? []); } }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const remove = async (id: string) => { try { await api(`/api/favorites?chatId=${id}`, { method: "DELETE" }); await load(); } catch (e) { setError((e as Error).message); } };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["top", "left", "right"]}>
      <View style={{ padding: 20, paddingBottom: 4 }}><Title sub="Chats you've starred on the website or here.">Favorites</Title></View>
      <ErrorText>{error}</ErrorText>
      <FlatList data={items ?? []} keyExtractor={f => f.id}
        ListEmptyComponent={items === null ? <Empty>Loading…</Empty> : <Empty>No favorites yet. Star a chat on the website to see it here.</Empty>}
        renderItem={({ item }) => (
          <View style={{ flexDirection: "row", alignItems: "center", borderBottomColor: t.line, borderBottomWidth: 1 }}>
            <Pressable accessibilityRole="button" onPress={() => router.navigate({ pathname: "/", params: { open: item.id } })} style={{ flex: 1, padding: 14 }}>
              <Text numberOfLines={1} style={{ color: t.ink, fontSize: 16, fontWeight: "600" }}>★ {item.title}</Text>
              <Text style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>{item.mode} · {new Date(item.updatedAt).toLocaleDateString()}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.title} from favorites`} onPress={() => remove(item.id)} style={{ padding: 14 }}>
              <Text style={{ color: t.muted, fontSize: 14 }}>Remove</Text>
            </Pressable>
          </View>
        )} />
    </SafeAreaView>
  );
}
