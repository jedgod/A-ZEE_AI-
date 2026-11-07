"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MESSAGES: Record<string, string> = {
  INVALID_OR_EXPIRED_LINK: "This link has expired or was already used. Request a new one.",
  RATE_LIMITED: "Too many requests. Wait a minute and try again.",
  WEAK_PASSWORD: "Use at least 12 characters and avoid repeating the same few characters.",
  EMAIL_SEND_FAILED: "We couldn't send the email. Try again in a moment.",
  EMAIL_NOT_CONFIGURED: "Email isn't set up on this server yet.",
  WRONG_PASSWORD: "Your current password is incorrect.",
  SAME_PASSWORD: "Choose a different password from the current one.",
  SIGN_IN_REQUIRED: "Please sign in first.",
  INVALID_INPUT: "Check what you entered.",
};

async function post(url: string, body?: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, { method: "POST", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return MESSAGES[data.error] ?? "Something went wrong. Try again.";
  } catch { return "Couldn't reach the server."; }
}

const Card = ({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) => (
  <div className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
    <div><h1 className="text-2xl font-semibold tracking-tight">{title}</h1>{intro && <p className="mt-1 text-sm text-muted-foreground">{intro}</p>}</div>
    {children}
  </div>
);
const Err = ({ text }: { text: string }) => (text ? <p role="alert" className="rounded-md border border-destructive/40 p-2 text-sm text-destructive">{text}</p> : null);
const Ok = ({ children }: { children: ReactNode }) => <p role="status" className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2 text-sm">{children}</p>;

/** /verify-email: spends the emailed link, or (with ?pending) tells the user to check their inbox. */
export function VerifyEmail({ token }: { token: string | null }) {
  const [state, setState] = useState<"working" | "done" | "failed" | "pending">(token ? "working" : "pending");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (!token || started.current) return;
    started.current = true; // React strict mode runs effects twice; a token can only be spent once
    post("/api/auth/verify", { token }).then(e => { if (e) { setError(e); setState("failed"); } else setState("done"); });
  }, [token]);
  const resend = async () => { setError(""); setSent(false); const e = await post("/api/auth/resend-verification"); if (e) setError(e); else setSent(true); };

  if (state === "working") return <Card title="Verifying your email…"><p className="text-sm text-muted-foreground">One moment.</p></Card>;
  if (state === "done") return <Card title="Email verified"><Ok>Your account is ready.</Ok><Button asChild className="w-full"><Link href="/">Go to the workspace</Link></Button></Card>;
  return (
    <Card title={state === "failed" ? "We couldn't verify that link" : "Check your inbox"}
      intro={state === "failed" ? undefined : "We sent a verification link to your email. Open it to finish setting up your account. Until then you can only use the limited guest features."}>
      <Err text={error} />{sent && <Ok>A new link is on its way.</Ok>}
      <Button className="w-full" variant="outline" onClick={resend}>Send a new link</Button>
      <p className="text-center text-sm text-muted-foreground"><Link className="underline" href="/signin">Back to sign in</Link></p>
    </Card>
  );
}

/** /forgot-password: always shows the same confirmation. */
export function ForgotPassword() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    const e = await post("/api/auth/forgot", { email: new FormData(event.currentTarget).get("email") });
    setBusy(false);
    if (e) setError(e); else setDone(true);
  }
  return done ? (
    <Card title="Check your inbox"><Ok>If that email has an account, a reset link is on its way. It works once and expires in an hour.</Ok><Link className="text-sm underline" href="/signin">Back to sign in</Link></Card>
  ) : (
    <form onSubmit={submit}><Card title="Reset your password" intro="Enter your account email and we'll send you a link.">
      <div className="space-y-1.5"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" required maxLength={254} autoComplete="email" /></div>
      <Err text={error} /><Button type="submit" className="w-full" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</Button>
      <p className="text-center text-sm text-muted-foreground"><Link className="underline" href="/signin">Back to sign in</Link></p>
    </Card></form>
  );
}

/** /reset-password?token=: sets the new password. */
export function ResetPassword({ token }: { token: string | null }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get("password") !== form.get("confirm")) { setError("The two passwords don't match."); return; }
    setBusy(true); setError("");
    const e = await post("/api/auth/reset", { token, password: form.get("password") });
    setBusy(false);
    if (e) setError(e); else setDone(true);
  }
  if (!token) return <Card title="This link is incomplete"><Link className="text-sm underline" href="/forgot-password">Request a new reset link</Link></Card>;
  return done ? (
    <Card title="Password updated"><Ok>You've been signed out everywhere. Sign in with your new password.</Ok><Button asChild className="w-full"><Link href="/signin">Sign in</Link></Button></Card>
  ) : (
    <form onSubmit={submit}><Card title="Choose a new password">
      <div className="space-y-1.5"><Label htmlFor="password">New password</Label><Input id="password" name="password" type="password" required minLength={12} maxLength={200} autoComplete="new-password" /><p className="text-xs text-muted-foreground">At least 12 characters.</p></div>
      <div className="space-y-1.5"><Label htmlFor="confirm">Confirm password</Label><Input id="confirm" name="confirm" type="password" required minLength={12} maxLength={200} autoComplete="new-password" /></div>
      <Err text={error} /><Button type="submit" className="w-full" disabled={busy}>{busy ? "Saving…" : "Update password"}</Button>
    </Card></form>
  );
}

/** /account/security: change password, sign out everywhere. */
export function Security() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  async function change(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget, data = new FormData(form);
    if (data.get("next") !== data.get("confirm")) { setError("The two new passwords don't match."); return; }
    setBusy(true); setError(""); setOk("");
    const e = await post("/api/auth/password", { current: data.get("current"), next: data.get("next") });
    setBusy(false);
    if (e) setError(e); else { setOk("Password changed. Your other devices were signed out."); form.reset(); }
  }
  async function everywhere() {
    const e = await post("/api/auth/logout-all");
    if (e) setError(e); else window.location.assign("/signin");
  }
  return (
    <div className="space-y-6">
      <form onSubmit={change}><Card title="Change password">
        <div className="space-y-1.5"><Label htmlFor="current">Current password</Label><Input id="current" name="current" type="password" required maxLength={200} autoComplete="current-password" /></div>
        <div className="space-y-1.5"><Label htmlFor="next">New password</Label><Input id="next" name="next" type="password" required minLength={12} maxLength={200} autoComplete="new-password" /></div>
        <div className="space-y-1.5"><Label htmlFor="confirm">Confirm new password</Label><Input id="confirm" name="confirm" type="password" required minLength={12} maxLength={200} autoComplete="new-password" /></div>
        <Err text={error} />{ok && <Ok>{ok}</Ok>}
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Change password"}</Button>
      </Card></form>
      <Card title="Sign out everywhere" intro="Ends every session on every device, including this one."><Button variant="outline" onClick={everywhere}>Sign out of all devices</Button></Card>
    </div>
  );
}
