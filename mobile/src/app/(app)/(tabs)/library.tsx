import { useCallback, useState } from "react";
import { Alert, FlatList, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, Empty, ErrorText, Field, Title } from "@/components/ui";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";

type Prompt = { id: string; title: string; content: string };

export default function Library() {
  const t = useTheme();
  const router = useRouter();
  const [items, setItems] = useState<Prompt[] | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => { try { setItems(await api<Prompt[]>("/api/prompts")); setError(""); } catch (e) { setError((e as Error).message); setItems(i => i ?? []); } }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function add() {
    setBusy(true); setError("");
    try { await api("/api/prompts", { method: "POST", body: { title: title.trim(), content: content.trim() } }); setTitle(""); setContent(""); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const remove = (p: Prompt) => Alert.alert("Delete prompt?", p.title, [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: async () => { try { await api(`/api/prompts?id=${p.id}`, { method: "DELETE" }); await load(); } catch (e) { setError((e as Error).message); } } },
  ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["top", "left", "right"]}>
      <FlatList
        data={items ?? []} keyExtractor={p => p.id} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 10 }}
        ListHeaderComponent={<View>
          <Title sub="Prompts you reuse. Tap one to start a chat with it.">Prompt library</Title>
          <Card style={{ marginBottom: 14 }}>
            <Field label="Title" value={title} onChangeText={setTitle} maxLength={80} autoCapitalize="sentences" />
            <Field label="Prompt" value={content} onChangeText={setContent} maxLength={4000} multiline autoCapitalize="sentences" style={{ minHeight: 90, textAlignVertical: "top" }} />
            <ErrorText>{error}</ErrorText>
            <Button title="Save prompt" onPress={add} busy={busy} disabled={!title.trim() || !content.trim()} />
          </Card>
        </View>}
        ListEmptyComponent={items === null ? <Empty>Loading…</Empty> : <Empty>Your library is empty.</Empty>}
        renderItem={({ item }) => (
          <Card>
            <Text style={{ color: t.ink, fontSize: 16, fontWeight: "600" }}>{item.title}</Text>
            <Text numberOfLines={4} style={{ color: t.muted, marginTop: 4, lineHeight: 20 }}>{item.content}</Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <Button title="Use" onPress={() => router.navigate({ pathname: "/", params: { prompt: item.content } })} style={{ flex: 1 }} />
              <Button title="Delete" variant="outline" onPress={() => remove(item)} style={{ flex: 1 }} />
            </View>
          </Card>
        )} />
    </SafeAreaView>
  );
}
