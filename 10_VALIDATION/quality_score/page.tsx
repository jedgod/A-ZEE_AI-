// ============================================================
// 10_VALIDATION / QUALITY_SCORE / SHADCN UI PAGE
// File: app/reliability/quality_score/page.tsx
// Install: shadcn button, textarea, label; configure Tailwind.
// ============================================================

"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export default function ModulePage() {
  const [input, setInput] = useState("{}");
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    let payload: unknown;
    try { payload = JSON.parse(input); }
    catch { setOutput("Enter valid JSON."); return; }

    setBusy(true);
    setOutput("");
    try {
      const response = await fetch("/api/reliability/quality_score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) throw new Error("Request failed");
      const data: unknown = await response.json();
      setOutput(JSON.stringify(data, null, 2));
    } catch {
      setOutput("Unable to complete this request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="border-b pb-6">
        <p className="font-mono text-xs text-muted-foreground">
          10_VALIDATION / quality_score
        </p>
        <h1 className="mt-3 text-3xl font-semibold">Quality score</h1>
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
        {output}
      </pre>
    </main>
  );
}

// Developer-console template; match JSON input to service contract.
// Implement API route separately:
// authenticate → CSRF/origin checks → rate-limit → validate
// → load owner-scoped evidence → inject trusted adapters → execute.
// Evidence statuses, policy decisions, schemas, and scoring inputs
// must come from server-controlled checks, not arbitrary client JSON.
// Never expose private internal reasoning or provider credentials.
