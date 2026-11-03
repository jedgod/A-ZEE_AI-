"use client";

import { useEffect, useState } from "react";
import { Download, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { KEYBOARD_SHORTCUTS, RELEASE_NOTES } from "@/lib/release-notes";

export type AccountDialog = "profile" | "personalization" | "plan" | "shortcuts" | "release-notes" | "download" | "support" | "bug";

export type AccountData = {
  local: boolean;
  account: {
    id: string; name: string; email: string; initials: string; plan: string; planName: string; region: string | null;
    preferences: { customInstructions: string; style: "default" | "concise" | "detailed" };
    workspaces: { id: string; name: string; personal: boolean; status: "active" | "deactivated"; role: string }[];
  } | null;
  staff: { name: string; email: string; role: string } | null;
  links: { terms: string | null; privacy: string | null; help: string | null };
};

type Props = { dialog: AccountDialog | null; onClose: () => void; data: AccountData | null; onChanged: () => void; notify: (m: string) => void };

async function send(url: string, method: string, body: unknown): Promise<{ ok: boolean; data?: any; message?: string }> {
  try {
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await response.json().catch(() => ({}));
    if (response.ok) return { ok: true, data: json.data };
    const issue = json.issues?.[0];
    return { ok: false, message: json.message ?? (issue ? `Check ${issue.path || "the form"}: ${issue.message}` : MESSAGES[json.error] ?? "Something went wrong. Try again.") };
  } catch {
    return { ok: false, message: "You appear to be offline." };
  }
}

const MESSAGES: Record<string, string> = {
  SUPPORT_NOT_CONFIGURED: "Support isn't set up on this server yet (an administrator runs npm run staff:create).",
  RATE_LIMITED: "Too many requests. Wait a minute and try again.",
  LOCAL_ONLY: "Account settings can only be changed on this machine.",
  ALREADY_EXISTS: "That email is already in use.",
};

const STATUS: Record<string, string> = { open: "Received", in_progress: "Being handled", pending_review: "Awaiting approval", resolved: "Resolved" };

function Field({ id, label, children, hint }: { id: string; label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function AccountDialogs({ dialog, onClose, data, onChanged, notify }: Props) {
  return (
    <>
      <ProfileDialog open={dialog === "profile"} onClose={onClose} data={data} onChanged={onChanged} notify={notify} />
      <PersonalizationDialog open={dialog === "personalization"} onClose={onClose} data={data} onChanged={onChanged} notify={notify} />
      <PlanDialog open={dialog === "plan"} onClose={onClose} data={data} />
      <ShortcutsDialog open={dialog === "shortcuts"} onClose={onClose} />
      <ReleaseNotesDialog open={dialog === "release-notes"} onClose={onClose} />
      <DownloadDialog open={dialog === "download"} onClose={onClose} />
      <SupportDialog open={dialog === "support" || dialog === "bug"} kind={dialog === "bug" ? "bug" : "support"} onClose={onClose} data={data} notify={notify} />
    </>
  );
}

type D = { open: boolean; onClose: () => void };

function ProfileDialog({ open, onClose, data, onChanged, notify }: D & Omit<Props, "dialog">) {
  const account = data?.account;
  const [form, setForm] = useState({ name: "", email: "", avatarInitials: "", region: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open && account) { setForm({ name: account.name, email: account.email, avatarInitials: account.initials, region: account.region ?? "" }); setError(""); }
  }, [open, account]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const result = await send("/api/account", "PATCH", { name: form.name, email: form.email, region: form.region.trim().toUpperCase(), ...(form.avatarInitials ? { avatarInitials: form.avatarInitials } : {}) });
    setBusy(false);
    if (!result.ok) return setError(result.message ?? "");
    onChanged(); notify("Profile saved."); onClose();
  }
  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Profile</DialogTitle><DialogDescription>Shown in the account menu and on support requests you send.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          <Field id="profile-name" label="Name"><Input id="profile-name" value={form.name} maxLength={100} required onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
          <Field id="profile-email" label="Email"><Input id="profile-email" type="email" value={form.email} maxLength={254} required onChange={e => setForm({ ...form, email: e.target.value })} /></Field>
          <Field id="profile-initials" label="Avatar initials" hint="1–3 letters or digits."><Input id="profile-initials" value={form.avatarInitials} maxLength={3} onChange={e => setForm({ ...form, avatarInitials: e.target.value })} /></Field>
          <Field id="profile-region" label="Country code (optional)" hint="Two letters, e.g. NG or US. Used for regional pricing."><Input id="profile-region" value={form.region} maxLength={2} onChange={e => setForm({ ...form, region: e.target.value })} /></Field>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>Save profile</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PersonalizationDialog({ open, onClose, data, onChanged, notify }: D & Omit<Props, "dialog">) {
  const prefs = data?.account?.preferences;
  const [instructions, setInstructions] = useState("");
  const [style, setStyle] = useState<"default" | "concise" | "detailed">("default");
  const [error, setError] = useState("");
  useEffect(() => {
    if (open && prefs) { setInstructions(prefs.customInstructions); setStyle(prefs.style); setError(""); }
  }, [open, prefs]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const result = await send("/api/account/preferences", "PUT", { customInstructions: instructions, style });
    if (!result.ok) return setError(result.message ?? "");
    onChanged(); notify("Personalization saved. It applies to your next message."); onClose();
  }
  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Personalization</DialogTitle><DialogDescription>Tell AZ_AI how to answer. Applied to every new answer on this machine.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Answer style</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup">
              {(["default", "concise", "detailed"] as const).map(s => (
                <Button key={s} type="button" role="radio" aria-checked={style === s} variant={style === s ? "default" : "outline"} size="sm" onClick={() => setStyle(s)} className="capitalize">{s}</Button>
              ))}
            </div>
          </fieldset>
          <Field id="custom-instructions" label="Custom instructions" hint={`${instructions.length}/1500. E.g. "I'm a teacher; use simple examples."`}>
            <Textarea id="custom-instructions" value={instructions} maxLength={1500} rows={5} onChange={e => setInstructions(e.target.value)} />
          </Field>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit">Save</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type PlanSummary = {
  plans: { id: string; name: string }[];
  current: {
    planId: string; usage: Record<"messages" | "reasoning" | "research", number> | null;
    limits: Partial<Record<"messages" | "reasoning" | "research", number | null>>;
    subscription: { pending: { name: string } | null } | null;
  };
};

/** Upgrade plan: current plan and this month's usage against its allowances; full comparison on /pricing. */
function PlanDialog({ open, onClose, data }: D & { data: AccountData | null }) {
  const [summary, setSummary] = useState<PlanSummary | null>(null);
  useEffect(() => {
    if (open) fetch("/api/plans", { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).then(j => j && setSummary(j.data)).catch(() => {});
  }, [open]);
  const name = summary?.plans.find(p => p.id === summary.current.planId)?.name ?? data?.account?.planName ?? "Free";
  const rows = [["messages", "Messages"], ["reasoning", "AZ · Reasoning"], ["research", "Explore deeply"]] as const;
  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Your plan: {name}</DialogTitle><DialogDescription>Usage this month. Allowances reset on the 1st.</DialogDescription></DialogHeader>
        {summary?.current.subscription?.pending && (
          <p className="rounded-md border bg-muted p-3 text-sm">{summary.current.subscription.pending.name} is waiting for payment. An administrator activates it once paid.</p>
        )}
        <div className="grid gap-3">
          {rows.map(([key, label]) => {
            const used = summary?.current.usage?.[key] ?? 0;
            const max = summary?.current.limits[key];
            const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
            return (
              <div key={key}>
                <div className="flex justify-between text-sm"><span>{label}</span><span className="text-muted-foreground">{used.toLocaleString()} / {max === null || max === undefined ? "Unlimited" : max.toLocaleString()}</span></div>
                {max ? <div className="mt-1 h-1.5 rounded bg-muted" role="progressbar" aria-label={`${label} used`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className={`h-full rounded ${pct >= 90 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${pct}%` }} /></div> : null}
              </div>
            );
          })}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button><Button asChild><a href="/pricing">Compare plans</a></Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShortcutsDialog({ open, onClose }: D) {
  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Keyboard shortcuts</DialogTitle></DialogHeader>
        <dl className="grid gap-2 text-sm">
          {KEYBOARD_SHORTCUTS.map(s => (
            <div key={s.keys} className="flex items-center justify-between border-b pb-2 last:border-0">
              <dt>{s.action}</dt><dd><kbd className="rounded border bg-muted px-2 py-0.5 font-mono text-xs">{s.keys}</kbd></dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}

function ReleaseNotesDialog({ open, onClose }: D) {
  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Release notes</DialogTitle></DialogHeader>
        <div className="grid gap-5">
          {RELEASE_NOTES.map(r => (
            <section key={r.title}>
              <p className="text-xs text-muted-foreground">{r.date}</p>
              <h3 className="font-semibold">{r.title}</h3>
              <ul className="mt-1.5 grid gap-1 text-sm text-muted-foreground">{r.items.map(i => <li key={i}>• {i}</li>)}</ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DownloadDialog({ open, onClose }: D) {
  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Download apps</DialogTitle><DialogDescription>Use AZ_AI from your editor with AZee Connect.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="flex items-start gap-3 rounded-lg border p-4">
            <Download className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold">VS Code extension</h3>
              <p className="text-sm text-muted-foreground">Explain, review, and ask about code from the editor.</p>
              <Button asChild size="sm" className="mt-2"><a href="/api/downloads/vscode" download>Download .vsix</a></Button>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-lg border p-4">
            <Terminal className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="min-w-0">
              <h3 className="font-semibold">Command line (Code::Blocks, Visual Studio, JetBrains, Vim…)</h3>
              <p className="text-sm text-muted-foreground">Run <code className="rounded bg-muted px-1">npm run connect:token -- --local</code>, then see <code className="rounded bg-muted px-1">azee-connect/README_AZEE_CONNECT.md</code>.</p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type MyRequest = { id: string; subject: string; status: string; resolution: string | null; updatedAt: string };

function SupportDialog({ open, kind, onClose, data, notify }: D & { kind: "bug" | "support"; data: AccountData | null; notify: (m: string) => void }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<MyRequest[]>([]);
  const signedInAccount = data?.account;

  useEffect(() => {
    if (!open) return;
    setSubject(""); setBody(""); setError("");
    fetch("/api/support", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(j => j && setMine(j.data)).catch(() => {});
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const result = await send("/api/support", "POST", { category: kind, subject, body, ...(signedInAccount ? {} : { name, contact }) });
    setBusy(false);
    if (!result.ok) return setError(result.message ?? "");
    notify(`Sent as ${result.data.id}. You can follow it here under Help.`);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{kind === "bug" ? "Report a bug" : "Contact support"}</DialogTitle>
          <DialogDescription>Goes to the support team's queue. {signedInAccount ? `Replies use ${signedInAccount.email}.` : "Add an email if you'd like a reply."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <Field id="support-subject" label={kind === "bug" ? "What went wrong?" : "Subject"}>
            <Input id="support-subject" value={subject} maxLength={150} required onChange={e => setSubject(e.target.value)} />
          </Field>
          <Field id="support-body" label="Details" hint={kind === "bug" ? "Steps to reproduce, what you expected, and what happened." : undefined}>
            <Textarea id="support-body" value={body} maxLength={5000} rows={5} required onChange={e => setBody(e.target.value)} />
          </Field>
          {!signedInAccount && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="support-name" label="Name (optional)"><Input id="support-name" value={name} maxLength={100} onChange={e => setName(e.target.value)} /></Field>
              <Field id="support-contact" label="Email (optional)"><Input id="support-contact" type="email" value={contact} maxLength={254} onChange={e => setContact(e.target.value)} /></Field>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>Send</Button></DialogFooter>
        </form>
        {mine.length > 0 && (
          <section aria-label="Your requests" className="border-t pt-4">
            <h3 className="mb-2 text-sm font-semibold">Your requests</h3>
            <ul className="grid gap-2">
              {mine.map(r => (
                <li key={r.id} className="rounded-md border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{r.subject}</span>
                    <Badge variant={r.status === "resolved" ? "default" : "secondary"}>{STATUS[r.status] ?? r.status}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{r.id} · updated {new Date(r.updatedAt).toLocaleDateString()}</p>
                  {r.resolution && <p className="mt-2 whitespace-pre-wrap text-sm">{r.resolution}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
