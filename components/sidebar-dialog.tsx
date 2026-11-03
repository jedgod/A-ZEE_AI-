"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// Dialogs for sidebar actions: names (add/rename), confirms (deletes), forms (project Edit and
// Settings), and share links.

export type FormField =
  | { name: string; label: string; type: "text" | "textarea"; initial: string; maxLength: number; hint?: string; placeholder?: string }
  | { name: string; label: string; type: "select"; initial: string; options: { value: string; label: string }[]; hint?: string };

export type SidebarDialogState =
  | { kind: "name"; title: string; label: string; initial: string; maxLength: number; confirm: string; submit: (value: string) => Promise<string | null> }
  | { kind: "confirm"; title: string; description: string; confirm: string; submit: () => Promise<void> }
  | { kind: "form"; title: string; description?: string; fields: FormField[]; confirm: string; submit: (values: Record<string, string>) => Promise<string | null> }
  | { kind: "share"; title: string; description: string; link: string }
  | null;

export function SidebarDialog({ state, onClose }: { state: SidebarDialogState; onClose: () => void }) {
  const [value, setValue] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setValue(state?.kind === "name" ? state.initial : "");
    setValues(state?.kind === "form" ? Object.fromEntries(state.fields.map(f => [f.name, f.initial])) : {});
    setError(""); setBusy(false); setCopied(false);
  }, [state]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!state || state.kind === "share") { onClose(); return; }
    setBusy(true); setError("");
    try {
      const failure = state.kind === "name" ? await state.submit(value.trim())
        : state.kind === "form" ? await state.submit(values)
        : (await state.submit(), null);
      if (failure) { setError(failure); return; }
      onClose();
    } catch (e) {
      setError((e as Error).message || "Something went wrong.");
    } finally { setBusy(false); }
  }

  async function copy(link: string) {
    try { await navigator.clipboard.writeText(link); setCopied(true); }
    catch { setError("Couldn't copy automatically. Select the link and copy it."); }
  }

  const invalid = state?.kind === "name" ? !value.trim()
    : state?.kind === "form" ? state.fields.some(f => f.type === "text" && f.name === "name" && !values[f.name]?.trim()) : false;

  return (
    <Dialog open={!!state} onOpenChange={open => { if (!open && !busy) onClose(); }}>
      <DialogContent className={state?.kind === "form" ? "sm:max-w-lg" : "sm:max-w-md"}>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{state?.title}</DialogTitle>
            {(state?.kind === "confirm" || state?.kind === "share" || (state?.kind === "form" && state.description)) && (
              <DialogDescription>{state.description}</DialogDescription>
            )}
          </DialogHeader>

          {state?.kind === "name" && (
            <div className="space-y-2">
              <Label htmlFor="sidebar-name">{state.label}</Label>
              <Input id="sidebar-name" value={value} autoFocus maxLength={state.maxLength} onChange={e => setValue(e.target.value)} />
            </div>
          )}

          {state?.kind === "form" && state.fields.map((f, i) => (
            <div key={f.name} className="space-y-2">
              <Label htmlFor={`sidebar-${f.name}`}>{f.label}</Label>
              {f.type === "select" ? (
                <select id={`sidebar-${f.name}`} value={values[f.name] ?? ""} onChange={e => setValues(v => ({ ...v, [f.name]: e.target.value }))}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : f.type === "textarea" ? (
                <Textarea id={`sidebar-${f.name}`} value={values[f.name] ?? ""} maxLength={f.maxLength} rows={f.maxLength > 1000 ? 7 : 3}
                  placeholder={f.placeholder} autoFocus={i === 0} onChange={e => setValues(v => ({ ...v, [f.name]: e.target.value }))} />
              ) : (
                <Input id={`sidebar-${f.name}`} value={values[f.name] ?? ""} maxLength={f.maxLength} placeholder={f.placeholder}
                  autoFocus={i === 0} onChange={e => setValues(v => ({ ...v, [f.name]: e.target.value }))} />
              )}
              {(f.hint || f.type !== "select") && (
                <p className="flex justify-between gap-3 text-xs text-muted-foreground">
                  <span>{f.hint}</span>
                  {f.type !== "select" && <span>{(values[f.name] ?? "").length}/{f.maxLength}</span>}
                </p>
              )}
            </div>
          ))}

          {state?.kind === "share" && (
            <div className="flex gap-2">
              <Input aria-label="Share link" readOnly value={state.link} onFocus={e => e.currentTarget.select()} className="font-mono text-xs" />
              <Button type="button" variant="outline" onClick={() => copy(state.link)} className="shrink-0">
                {copied ? <><Check className="h-4 w-4" /> Copied</> : <><Copy className="h-4 w-4" /> Copy link</>}
              </Button>
            </div>
          )}

          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <DialogFooter>
            {state?.kind === "share" ? (
              <Button type="submit">Done</Button>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
                <Button type="submit" variant={state?.kind === "confirm" ? "destructive" : "default"} disabled={busy || invalid}>
                  {busy ? "Saving…" : state?.confirm}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
