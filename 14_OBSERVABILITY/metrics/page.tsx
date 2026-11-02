// ============================================================
// 14_OBSERVABILITY / METRICS / SHADCN PAGE
// File: app/operations/metrics/page.tsx
// Install shadcn: button, textarea, label; configure Tailwind.
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
      const response = await fetch("/api/operations/metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error("Request unavailable");
      const text = await response.text();
      setResult(text);
    } catch {
      setResult("Unable to complete this request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="border-b pb-6">
        <p className="font-mono text-xs text-muted-foreground">
          14_OBSERVABILITY / metrics
        </p>
        <h1 className="mt-3 text-3xl font-semibold">Metrics</h1>
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

// Developer-console template; referenced API route is not included.
// Authenticate → CSRF/origin checks → rate-limit → validate arguments
// → authorize request ownership → inject trusted adapters → execute.
// Server instrumentation modules must not accept arbitrary client events.
// streaming_output: this debug page buffers SSE as text;
// production client must parse SSE incrementally and handle cancellation.
