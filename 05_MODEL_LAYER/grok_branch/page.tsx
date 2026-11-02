// ============================================================
// 05_MODEL_LAYER / GROK_BRANCH / UI PAGE
// File: app/model-layer/grok_branch/page.tsx
// Requires shadcn Button, Textarea, Alert; Tailwind configured.
// ============================================================

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function ModulePage() {
  const [prompt, setPrompt] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError("");
    setOutput("");

    try {
      const response = await fetch("/api/model-layer/grok_branch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
        signal: AbortSignal.timeout(180_000),
      });

      if (!response.ok) throw new Error("Request failed");
      const data = await response.json();
      if (typeof data.text !== "string") {
        throw new Error("Invalid response contract");
      }
      setOutput(data.text);
    } catch {
      setError("Unable to complete this request. Please retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="border-b pb-6">
        <p className="font-mono text-xs text-muted-foreground">
          05_MODEL_LAYER / grok_branch
        </p>
        <h1 className="mt-3 text-3xl font-semibold">
          Grok branch
        </h1>
      </header>
      <label htmlFor="prompt" className="block text-sm font-medium">
        Request
      </label>
      <Textarea
        id="prompt"
        value={prompt}
        onChange={event => setPrompt(event.target.value)}
        maxLength={100000}
        className="min-h-40"
        placeholder="Describe the task…"
      />
      <Button onClick={run} disabled={busy || !prompt.trim()}>
        {busy ? "Running…" : "Run module"}
      </Button>
      {error && (
        <Alert role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <section aria-live="polite" aria-busy={busy}
        className="whitespace-pre-wrap border-t pt-6">
        {output}
      </section>
    </main>
  );
}

// Implement the referenced API route separately:
// authenticate → validate → rate-limit → select server config
// → invoke module → validate output → return { text }.
// Never import provider adapters into this client component.
