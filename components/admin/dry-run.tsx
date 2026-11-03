"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** "Try it" panel for deterministic stage modules. Calls /api/admin/pipeline/run; nothing is stored. */
export function DryRun({ slug, example, hint }: { slug: string; example: string; hint: string }) {
  const [input, setInput] = useState(example);
  const [output, setOutput] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setOutput(""); setFailed(false);
    try {
      const response = await fetch("/api/admin/pipeline/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, input }), signal: AbortSignal.timeout(15_000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFailed(true);
        const details = Array.isArray(data.details) ? data.details.join("\n") : typeof data.details === "string" ? data.details : "";
        setOutput([data.error ?? `Request failed (${response.status})`, details].filter(Boolean).join("\n"));
      } else setOutput(JSON.stringify(data.result, null, 2));
    } catch {
      setFailed(true); setOutput("Request unavailable.");
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={run} className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor="dry-run-input" className="text-base font-semibold">Try it</Label>
        <span className="text-xs text-muted-foreground">Runs the real module · no AI call · nothing stored</span>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <Textarea id="dry-run-input" value={input} onChange={e => setInput(e.target.value)} rows={6} maxLength={20_000} className="font-mono text-xs" />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !input.trim()}>{busy ? "Running…" : "Run"}</Button>
        <Button type="button" variant="outline" onClick={() => { setInput(example); setOutput(""); }}>Reset example</Button>
      </div>
      {output && (
        <pre role={failed ? "alert" : "status"} className={`max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border p-3 font-mono text-xs ${failed ? "border-destructive/50 text-destructive" : "bg-muted/40"}`}>{output}</pre>
      )}
    </form>
  );
}
