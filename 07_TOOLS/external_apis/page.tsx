// ============================================================
// 07_TOOLS / EXTERNAL_APIS / SHADCN UI PAGE
// File: app/execution/external_apis/page.tsx
// Install shadcn: button, textarea, label. Configure Tailwind.
// ============================================================

"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export default function ModulePage() {
  const [input, setInput] = useState("{}");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    let payload: unknown;
    try { payload = JSON.parse(input); }
    catch { setResult("Enter valid JSON."); return; }

    setBusy(true);
    setResult("");
    try {
      const response = await fetch("/api/execution/external_apis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error("Request failed");
      const output: unknown = await response.json();
      setResult(JSON.stringify(output, null, 2));
    } catch {
      setResult("Request unavailable or not authorized.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="border-b pb-6">
        <p className="font-mono text-xs text-muted-foreground">
          07_TOOLS / external_apis
        </p>
        <h1 className="mt-3 text-3xl font-semibold">External APIs</h1>
      </header>
      <form onSubmit={submit} className="space-y-4">
        <Label htmlFor="input">Module arguments (JSON)</Label>
        <Textarea id="input" value={input} maxLength={100000}
          className="min-h-48 font-mono text-xs"
          onChange={event => setInput(event.target.value)} />
        <Button disabled={busy}>
          {busy ? "Processing…" : "Run module"}
        </Button>
      </form>
      <pre aria-live="polite" aria-busy={busy}
        className="overflow-auto whitespace-pre-wrap border-t pt-6 text-xs">
        {result}
      </pre>
    </main>
  );
}

// This is an authorized developer-console UI, not an end-user form.
// Implement the referenced route separately:
// authenticate → same-origin/CSRF checks → rate-limit → validate
// → load trusted policy/adapters → authorize → execute → redact.
// Do not allow this UI to edit privileged prompt policy.
// Never trust client-provided user IDs, permissions, or tool limits.
