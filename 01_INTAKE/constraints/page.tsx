// ============================================================
// 01_INTAKE / CONSTRAINTS / SHADCN UI PAGE
// File: app/intake/constraints/page.tsx
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
import { constraintsSchema } from "@/lib/intake/constraints";

export default function ConstraintsPage() {
  const [form, setForm] = useState({
  "maxOutputTokens": "2048",
  "language": "en",
  "format": "text"
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
      maxOutputTokens: Number(form.maxOutputTokens),
    };
    const result = constraintsSchema.safeParse(payload);
    if (!result.success) {
      setStatus(result.error.issues.map(i => i.message).join("; "));
      return;
    }

    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/intake/constraints", {
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
          01_INTAKE / constraints
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Constraints</h1>
      </header>
      <form onSubmit={save} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="maxOutputTokens">Maximum output tokens</Label>
        <Input id="maxOutputTokens"
          type="number" min="128" max="8192"
          value={form.maxOutputTokens}
          onChange={event => update("maxOutputTokens", event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="language">Language code</Label>
        <Input id="language"
          
          value={form.language}
          onChange={event => update("language", event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="format">Output format</Label>
        <Select value={form.format}
          onValueChange={value => update("format", value)}>
          <SelectTrigger id="format"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="text">text</SelectItem>
            <SelectItem value="markdown">markdown</SelectItem>
            <SelectItem value="json">json</SelectItem>
          </SelectContent>
        </Select>
      </div>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save constraints"}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
      </form>
    </main>
  );
}
