"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MESSAGES: Record<string, string> = {
  WRONG_PASSWORD: "That password is incorrect.", RATE_LIMITED: "Too many attempts. Wait a minute and try again.",
  PAYMENT_PROVIDER_ERROR: "We couldn't remove your saved payment methods. Nothing was deleted; please try again.",
  SIGN_IN_REQUIRED: "Please sign in first.", INVALID_INPUT: "Enter your password and type DELETE.",
};

/** What is deleted, what is kept, and the confirmed deletion form. Signed-out visitors are asked to sign in first. */
export function DeleteAccount() {
  const [user, setUser] = useState<{ email: string } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => { fetch("/api/auth/me", { cache: "no-store" }).then(r => r.json()).then(d => setUser(d.data.user)).catch(() => setUser(null)); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get("confirm") !== "DELETE") { setError("Type DELETE to confirm."); return; }
    if (!window.confirm("This permanently deletes your account and cannot be undone. Continue?")) return;
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/account", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: form.get("password"), confirm: "DELETE" }) });
      if (res.ok) { setDone(true); return; }
      const data = await res.json().catch(() => ({}));
      setError(MESSAGES[data.error] ?? "Something went wrong. Try again.");
    } catch { setError("Couldn't reach the server."); } finally { setBusy(false); }
  }

  if (done) return <p role="status" className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4 text-sm">Your account and its data have been deleted, and you've been signed out everywhere.</p>;
  return (
    <div className="space-y-6">
      <section className="rounded-xl border p-4 text-sm">
        <h2 className="mb-2 font-semibold">What happens</h2>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li><strong className="text-foreground">Deleted now:</strong> your profile, sign-in details, chats, projects, favorites, prompt library, notifications, saved payment methods (removed at Stripe too), subscription and usage records.</li>
          <li><strong className="text-foreground">Your plan ends</strong> immediately. There are no refunds for the current period.</li>
          <li><strong className="text-foreground">Kept, no longer linked to you:</strong> payment records, as accounting rules require. If you had used your free allowance, the technical device signals from it are kept for up to 90 days to stop the free plan being reset, then deleted.</li>
        </ul>
      </section>

      {user === undefined ? <p className="text-sm text-muted-foreground">Loading…</p> : user === null ? (
        <div className="rounded-xl border p-4 text-sm">
          <p className="mb-3">Sign in to delete your account.</p>
          <Button asChild><Link href="/signin?next=/account/delete">Sign in</Link></Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-destructive/40 p-4">
          <p className="text-sm">Deleting <strong>{user.email}</strong> is permanent.</p>
          <div className="space-y-1.5"><Label htmlFor="password">Password</Label><Input id="password" name="password" type="password" required maxLength={200} autoComplete="current-password" /></div>
          <div className="space-y-1.5"><Label htmlFor="confirm">Type DELETE to confirm</Label><Input id="confirm" name="confirm" required maxLength={10} autoComplete="off" /></div>
          {error && <p role="alert" className="rounded-md border border-destructive/40 p-2 text-sm text-destructive">{error}</p>}
          <Button type="submit" variant="destructive" disabled={busy}>{busy ? "Deleting…" : "Delete my account"}</Button>
        </form>
      )}
    </div>
  );
}
