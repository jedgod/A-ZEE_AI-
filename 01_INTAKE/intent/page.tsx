// ============================================================
// 01_INTAKE / INTENT / SHADCN UI PAGE
// File: app/intake/intent/page.tsx
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
import { intentSchema } from "@/lib/intake/intent";

export default function IntentPage() {
  const [form, setForm] = useState({
  "goal": "Create a decision-ready executive summary.",
  "needsClarification": "no"
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
    const result = intentSchema.safeParse(payload);
    if (!result.success) {
      setStatus(result.error.issues.map(i => i.message).join("; "));
      return;
    }

    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/intake/intent", {
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
          01_INTAKE / intent
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Intent</h1>
      </header>
      <form onSubmit={save} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="goal">Desired outcome</Label>
        <Textarea id="goal"
          
          value={form.goal}
          onChange={event => update("goal", event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="needsClarification">Needs clarification</Label>
        <Select value={form.needsClarification}
          onValueChange={value => update("needsClarification", value)}>
          <SelectTrigger id="needsClarification"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="no">no</SelectItem>
            <SelectItem value="yes">yes</SelectItem>
          </SelectContent>
        </Select>
      </div>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save intent"}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
      </form>
    </main>
  );
}
