"use client";

import { useEffect, useState } from "react";

/** Shown in the workspace while the signed-in account's email is unverified (it works as a guest until then). */
export function VerifyBanner() {
  const [email, setEmail] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" }).then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.data?.user && !d.data.verified) setEmail(d.data.user.email); }).catch(() => undefined);
  }, []);
  if (!email) return null;
  const resend = async () => {
    setState("sending");
    const res = await fetch("/api/auth/resend-verification", { method: "POST" }).catch(() => null);
    setState(res?.ok ? "sent" : "failed");
  };
  return (
    <div role="status" className="fixed bottom-4 left-1/2 z-50 flex max-w-[92vw] -translate-x-1/2 flex-wrap items-center gap-3 rounded-lg border bg-background px-4 py-2.5 text-sm shadow-lg">
      <span>Verify <strong>{email}</strong> to unlock your saved chats, favorites and library.</span>
      <button onClick={resend} disabled={state === "sending" || state === "sent"} className="rounded-md border px-2.5 py-1 hover:bg-muted disabled:opacity-60">
        {state === "sending" ? "Sending…" : state === "sent" ? "Link sent" : state === "failed" ? "Try again" : "Resend email"}
      </button>
    </div>
  );
}
