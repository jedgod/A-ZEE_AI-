import { Redirect, Stack } from "expo-router";
import { Loading } from "@/components/ui";
import { useAuth } from "@/lib/auth";

/** Everything signed-in. Guests go to sign-in; unverified accounts go to verification. */
export default function AppLayout() {
  const { loading, user, verified } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Redirect href="/sign-in" />;
  if (!verified) return <Redirect href="/verify" />;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="keyboard" options={{ headerShown: true, title: "AZLinqext keyboard" }} />
      <Stack.Screen name="delete-account" options={{ headerShown: true, title: "Delete account", presentation: "modal" }} />
    </Stack>
  );
}
