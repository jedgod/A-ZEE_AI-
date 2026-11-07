"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: "Email or password is incorrect.",
  RATE_LIMITED: "Too many attempts. Wait a minute and try again.",
  REGISTRATION_FAILED: "We couldn't create that account. Try signing in, or use a different email.",
  WEAK_PASSWORD: "Use at least 12 characters and avoid repeating the same few characters.",
  INVALID_INPUT: "Check your name, email and password.",
  EMAIL_NOT_CONFIGURED: "Email isn't set up on this server yet, so accounts can't be created.",
  INVALID_ORIGIN: "This page can't reach the server from here. Open it from the app's own address.",
  SERVICE_UNAVAILABLE: "The service is unavailable right now. Try again soon.",
};

/** Only same-site paths are honored after sign-in (no open redirects). */
const safeNext = (raw: string) => (raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\") ? raw : "/");

export function AuthForm({ mode, next }: { mode: "signin" | "register"; next: string }) {
  const register = mode === "register";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const res = await fetch(register ? "/api/auth/register" : "/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(register
          ? { name: form.get("name"), email: form.get("email"), password: form.get("password") }
          : { email: form.get("email"), password: form.get("password") }),
      });
      if (!res.ok) { const data = await res.json().catch(() => ({})); setError(MESSAGES[data.error] ?? "Something went wrong. Try again."); return; }
      const body = await res.json().catch(() => ({}));
      // An unverified account can't use the app yet: send it to the "check your inbox" page first.
      window.location.assign(body?.data?.user?.verified === false ? "/verify-email?pending=1" : safeNext(next)); // full load so every component sees the new session
    } catch { setError("Couldn't reach the server."); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm" noValidate={false}>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{register ? "Create your account" : "Sign in"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{register ? "Chats, favorites, projects and your prompt library are saved to your account." : "Welcome back."}</p>
      </div>
      {register && (
        <div className="space-y-1.5"><Label htmlFor="name">Name</Label><Input id="name" name="name" required maxLength={100} autoComplete="name" /></div>
      )}
      <div className="space-y-1.5"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" required maxLength={254} autoComplete="email" /></div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" required maxLength={200} minLength={register ? 12 : 1} autoComplete={register ? "new-password" : "current-password"} />
        {register ? <p className="text-xs text-muted-foreground">At least 12 characters.</p>
          : <p className="text-xs"><Link className="text-muted-foreground underline" href="/forgot-password">Forgot your password?</Link></p>}
      </div>
      {error && <p role="alert" className="rounded-md border border-destructive/40 p-2 text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>{busy ? "Please wait…" : register ? "Create account" : "Sign in"}</Button>
      <p className="text-center text-sm text-muted-foreground">
        {register ? <>Already have an account? <Link className="underline" href={`/signin?next=${encodeURIComponent(next)}`}>Sign in</Link></>
          : <>New here? <Link className="underline" href={`/register?next=${encodeURIComponent(next)}`}>Create an account</Link></>}
      </p>
    </form>
  );
}
