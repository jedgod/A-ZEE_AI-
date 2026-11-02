// ============================================================
// 01_INTAKE / MODALITY / SHADCN UI PAGE
// File: app/intake/modality/page.tsx
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
import { modalitySchema } from "@/lib/intake/modality";

export default function ModalityPage() {
  const [form, setForm] = useState({
  "kind": "text",
  "attachmentIds": ""
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
      attachmentIds: form.attachmentIds.split(",").map(s => s.trim()).filter(Boolean),
    };
    const result = modalitySchema.safeParse(payload);
    if (!result.success) {
      setStatus(result.error.issues.map(i => i.message).join("; "));
      return;
    }

    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/intake/modality", {
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
          01_INTAKE / modality
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Modality</h1>
      </header>
      <form onSubmit={save} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="kind">Input modality</Label>
        <Select value={form.kind}
          onValueChange={value => update("kind", value)}>
          <SelectTrigger id="kind"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="text">text</SelectItem>
            <SelectItem value="image">image</SelectItem>
            <SelectItem value="audio">audio</SelectItem>
            <SelectItem value="document">document</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="attachmentIds">Attachment IDs (comma-separated)</Label>
        <Input id="attachmentIds"
          
          value={form.attachmentIds}
          onChange={event => update("attachmentIds", event.target.value)}
        />
      </div>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save modality"}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
      </form>
    </main>
  );
}
