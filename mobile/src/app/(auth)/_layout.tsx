import { Redirect, Stack, useSegments } from "expo-router";
import { Loading } from "@/components/ui";
import { useAuth } from "@/lib/auth";

/**
 * Sign-in, sign-up and email verification. Someone signed in and verified goes straight to the
 * app; someone signed in but not yet verified is kept on the verification screen.
 */
export default function AuthLayout() {
  const { loading, user, verified } = useAuth();
  const segments = useSegments() as string[];
  if (loading) return <Loading />;
  if (user && verified) return <Redirect href="/" />;
  if (user && !verified && segments[segments.length - 1] !== "verify") return <Redirect href="/verify" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
