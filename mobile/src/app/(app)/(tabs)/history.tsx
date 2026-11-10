import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChatList } from "@/components/chat-list";
import { Title } from "@/components/ui";
import { useTheme } from "@/lib/theme";
import { View } from "react-native";

export default function History() {
  const t = useTheme();
  const router = useRouter();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["top", "left", "right"]}>
      <View style={{ padding: 20, paddingBottom: 4 }}><Title sub="Tap a chat to continue it. Press and hold to delete.">History</Title></View>
      <ChatList onOpen={id => router.navigate({ pathname: "/", params: { open: id } })} />
    </SafeAreaView>
  );
}
