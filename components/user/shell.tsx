"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

// Shared by the rail pages (/favorites, /notifications, /library, /projects).

const MESSAGES: Record<string, string> = {
  SIGN_IN_REQUIRED: "Please sign in to continue.", INVALID_ORIGIN: "Origin check failed.", RATE_LIMITED: "Too many requests. Wait a minute.",
  CHAT_NOT_FOUND: "That chat wasn't found.", LIBRARY_FULL: "Your prompt library is full (200).", INVALID_INPUT: "Check the fields and try again.",
  SERVICE_UNAVAILABLE: "The service is unavailable right now.",
};

export async function api<T = unknown>(url: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(url, { method, cache: "no-store", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(MESSAGES[data.error] ?? data.error ?? `Request failed (${res.status})`), { status: res.status });
  return data.data as T;
}

/** Sends guests to sign-in (and back here afterwards). Returns the user once known. */
export function useUserGate() {
  const router = useRouter();
  const [user, setUser] = useState<{ id: string; name: string; email: string } | null | undefined>(undefined);
  useEffect(() => {
    api<{ user: { id: string; name: string; email: string } | null; verified: boolean }>("/api/auth/me").then(d => {
      if (d.user && d.verified) setUser(d.user);
      else if (d.user) router.replace("/verify-email?pending=1");
      else router.replace(`/signin?next=${encodeURIComponent(window.location.pathname)}`);
    }).catch(() => setUser(null));
  }, [router]);
  return user;
}

export function RailShell({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-10">
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Workspace</Link>
      <header className="mb-6 mt-3 flex flex-wrap items-end justify-between gap-3 border-b pb-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </header>
      {children}
    </main>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{children}</p>;

export function ErrorLine({ message }: { message: string }) {
  return message ? <p role="alert" className="mb-3 rounded-md border border-destructive/40 p-2 text-sm text-destructive">{message}</p> : null;
}
