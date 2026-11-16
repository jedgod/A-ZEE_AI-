import { useEffect } from "react";
import { Redirect, Stack } from "expo-router";
import { Loading } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { registerForPush } from "@/lib/push";

/** Everything signed-in. Guests go to sign-in; unverified accounts go to verification. */
export default function AppLayout() {
  const { loading, user, verified } = useAuth();
  // Once signed in and verified, ask to receive alerts on the lock screen (does nothing in a build without the push module).
  useEffect(() => { if (user && verified) void registerForPush(); }, [user?.id, verified]);
  if (loading) return <Loading />;
  if (!user) return <Redirect href="/sign-in" />;
  if (!verified) return <Redirect href="/verify" />;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="keyboard" options={{ headerShown: true, title: "AZLinqext keyboard" }} />
      <Stack.Screen name="review" options={{ headerShown: true, title: "Review draft" }} />
      <Stack.Screen name="autopilot" options={{ headerShown: true, title: "Autopilot" }} />
      <Stack.Screen name="delete-account" options={{ headerShown: true, title: "Delete account", presentation: "modal" }} />
    </Stack>
  );
}
