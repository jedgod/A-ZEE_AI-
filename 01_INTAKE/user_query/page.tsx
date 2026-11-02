// ============================================================
// 01_INTAKE / USER_QUERY / SHADCN UI PAGE
// File: app/intake/user_query/page.tsx
// Install shadcn: button input textarea label select
// Configure Tailwind in the host Next.js application.
// ============================================================

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { userQuerySchema } from "@/lib/intake/user_query";

export default function UserQueryPage() {
  const [form, setForm] = useState({
  "text": "Analyze our release notes and draft a concise summary."
});
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  function update(key: keyof typeof form, value: string) {
    setForm(previous => ({ ...previous, [key]: value }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const payload = {
      ...form,
    };
    const result = userQuerySchema.safeParse(payload);
    if (!result.success) {
      setStatus(result.error.issues.map(i => i.message).join("; "));
      return;
    }

    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/intake/user_query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.data),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("Save failed");
      setStatus("Saved.");
    } catch {
      setStatus("Could not save. Please retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <header className="border-b pb-6">
        <p className="font-mono text-xs text-muted-foreground">
          01_INTAKE / user_query
        </p>
        <h1 className="mt-2 text-3xl font-semibold">User query</h1>
      </header>
      <form onSubmit={save} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="text">Request</Label>
        <Textarea id="text"
          
          value={form.text}
          onChange={event => update("text", event.target.value)}
        />
      </div>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save user query"}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
      </form>
    </main>
  );
}
