// ============================================================
// 01_INTAKE / TASK_TYPE / SHADCN UI PAGE
// File: app/intake/task_type/page.tsx
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
import { taskTypeSchema } from "@/lib/intake/task_type";

export default function TaskTypePage() {
  const [form, setForm] = useState({
  "type": "question_answering"
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
    const result = taskTypeSchema.safeParse(payload);
    if (!result.success) {
      setStatus(result.error.issues.map(i => i.message).join("; "));
      return;
    }

    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/intake/task_type", {
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
          01_INTAKE / task_type
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Task type</h1>
      </header>
      <form onSubmit={save} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="type">Task category</Label>
        <Select value={form.type}
          onValueChange={value => update("type", value)}>
          <SelectTrigger id="type"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="question_answering">question_answering</SelectItem>
            <SelectItem value="summarization">summarization</SelectItem>
            <SelectItem value="writing">writing</SelectItem>
            <SelectItem value="coding">coding</SelectItem>
            <SelectItem value="extraction">extraction</SelectItem>
            <SelectItem value="planning">planning</SelectItem>
            <SelectItem value="other">other</SelectItem>
          </SelectContent>
        </Select>
      </div>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save task type"}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
      </form>
    </main>
  );
}
