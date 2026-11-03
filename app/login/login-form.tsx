"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ERRORS: Record<string, string> = {
  INVALID_CREDENTIALS: "That email and password don't match.",
  LOCKED: "Too many attempts. This account is locked for 15 minutes.",
  NO_ACTIVE_MEMBERSHIP: "This account isn't active on any team. Ask an administrator.",
  RATE_LIMITED: "Too many attempts. Wait a minute and try again.",
};

export function LoginForm({ next, signedInAs, mustChange }: { next: string; signedInAs: { name: string; role: string } | null; mustChange: boolean }) {
  const [step, setStep] = useState<"signin" | "change">(mustChange ? "change" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function post(url: string, body: unknown) {
    setBusy(true); setError("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await response.json().catch(() => ({}));
      return { ok: response.ok, json };
    } catch {
      return { ok: false, json: { error: "OFFLINE" } };
    } finally {
      setBusy(false);
    }
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    const { ok, json } = await post("/api/staff/session", { email, password });
    if (!ok) return setError(ERRORS[json.error] ?? "Sign-in failed. Try again.");
    if (json.data.mustChangePassword) { setStep("change"); return; }
    window.location.assign(next);
  }

  async function change(e: React.FormEvent) {
    e.preventDefault();
    if (nextPassword !== confirm) return setError("The new passwords don't match.");
    const { ok, json } = await post("/api/staff/password", { current: password, next: nextPassword });
    if (!ok) return setError(json.message ?? "Couldn't change the password.");
    window.location.assign(next);
  }

  if (signedInAs && step === "signin") {
    return (
      <Card>
        <CardHeader><CardTitle>Signed in</CardTitle><CardDescription>{signedInAs.name} · {signedInAs.role}</CardDescription></CardHeader>
        <CardContent className="grid gap-2">
          <Button asChild><a href={next}>Continue to the operations workspace</a></Button>
          <Button variant="outline" onClick={async () => { await fetch("/api/staff/session", { method: "DELETE" }); window.location.reload(); }}>Sign in as someone else</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      {step === "signin" ? (
        <>
          <CardHeader><CardTitle>Staff sign-in</CardTitle><CardDescription>For administrators and support staff.</CardDescription></CardHeader>
          <CardContent>
            <form onSubmit={signIn} className="grid gap-4">
              <div className="grid gap-1.5"><Label htmlFor="email">Email</Label><Input id="email" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></div>
              <div className="grid gap-1.5"><Label htmlFor="password">Password</Label><Input id="password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={busy} className="bg-[#315fe9] text-white hover:bg-[#244dcc]">{busy ? "Signing in…" : "Sign in"}</Button>
            </form>
          </CardContent>
        </>
      ) : (
        <>
          <CardHeader><CardTitle>Set your password</CardTitle><CardDescription>Your one-time password worked. Choose your own (at least 12 characters).</CardDescription></CardHeader>
          <CardContent>
            <form onSubmit={change} className="grid gap-4">
              {mustChange && (
                <div className="grid gap-1.5"><Label htmlFor="current">One-time password</Label><Input id="current" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></div>
              )}
              <div className="grid gap-1.5"><Label htmlFor="new-password">New password</Label><Input id="new-password" type="password" autoComplete="new-password" minLength={12} required value={nextPassword} onChange={e => setNextPassword(e.target.value)} /></div>
              <div className="grid gap-1.5"><Label htmlFor="confirm-password">Confirm new password</Label><Input id="confirm-password" type="password" autoComplete="new-password" minLength={12} required value={confirm} onChange={e => setConfirm(e.target.value)} /></div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={busy} className="bg-[#315fe9] text-white hover:bg-[#244dcc]">Save and continue</Button>
            </form>
          </CardContent>
        </>
      )}
    </Card>
  );
}
