"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Building2, CreditCard, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, Empty, ErrorLine } from "./shell";

type Method = {
  id: string; kind: "card" | "bank_account"; brand: string | null; funding: string | null; accountType: string | null;
  last4: string; expMonth: number | null; expYear: number | null; isDefault: boolean;
};

// Card and bank details are typed into Stripe's own secure form (an iframe served by Stripe).
// They never reach this app's server; the app only learns Stripe's token, brand and last four digits.

declare global { interface Window { Stripe?: (key: string) => any } }

export function loadStripe(): Promise<NonNullable<Window["Stripe"]>> {
  if (window.Stripe) return Promise.resolve(window.Stripe);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://js.stripe.com/v3/"]');
    const script = existing ?? Object.assign(document.createElement("script"), { src: "https://js.stripe.com/v3/", async: true });
    script.addEventListener("load", () => (window.Stripe ? resolve(window.Stripe) : reject(new Error("Stripe failed to load"))));
    script.addEventListener("error", () => reject(new Error("Stripe failed to load")));
    if (!existing) document.head.appendChild(script);
  });
}

const title = (m: Method) =>
  m.kind === "card"
    ? `${(m.brand ?? "Card").replace(/^./, c => c.toUpperCase())} ${m.funding === "debit" ? "debit" : m.funding === "credit" ? "credit" : ""} card`.replace(/\s+/g, " ")
    : `${m.brand ?? "Bank"} ${m.accountType ?? "account"}`.replace(/^./, c => c.toUpperCase());

function AddMethod({ onSaved, onClose }: { onSaved: () => void; onClose: () => void }) {
  const [kind, setKind] = useState<"card" | "bank_account" | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const mount = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<any>(null);
  const elementsRef = useRef<any>(null);

  async function choose(next: "card" | "bank_account") {
    setKind(next); setError(""); setBusy(true);
    try {
      const { clientSecret, publishableKey } = await api<{ clientSecret: string; publishableKey: string }>("/api/payment-methods/setup", "POST", { kind: next });
      const Stripe = await loadStripe();
      const stripe = Stripe(publishableKey);
      const elements = stripe.elements({ clientSecret });
      stripeRef.current = stripe; elementsRef.current = elements;
      elements.create("payment", { layout: "tabs" }).mount(mount.current);
    } catch (e) { setError((e as Error).message); setKind(null); } finally { setBusy(false); }
  }

  async function submit() {
    if (!stripeRef.current || busy) return;
    setBusy(true); setError("");
    try {
      const { error: stripeError, setupIntent } = await stripeRef.current.confirmSetup({
        elements: elementsRef.current, redirect: "if_required",
        confirmParams: { return_url: `${window.location.origin}/account/payment-methods` },
      });
      if (stripeError) { setError(stripeError.message ?? "We couldn't verify those details."); return; }
      const done = await api<{ pending: boolean }>("/api/payment-methods", "POST", { setupIntentId: setupIntent.id });
      if (done.pending) { setNote("Your bank is verifying this account. It will appear here once it's confirmed."); return; }
      onSaved(); onClose();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <section className="mb-6 rounded-xl border p-4">
      <div className="mb-3 flex items-center justify-between"><h2 className="font-medium">Add a payment method</h2><Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button></div>
      {!kind && (
        <div className="grid gap-3 sm:grid-cols-2">
          <button onClick={() => choose("card")} className="rounded-xl border p-4 text-left hover:bg-muted/50"><CreditCard className="mb-2 h-5 w-5" /><p className="font-medium">Debit or credit card</p><p className="text-xs text-muted-foreground">Visa, Mastercard, Amex and more.</p></button>
          <button onClick={() => choose("bank_account")} className="rounded-xl border p-4 text-left hover:bg-muted/50"><Building2 className="mb-2 h-5 w-5" /><p className="font-medium">Bank account</p><p className="text-xs text-muted-foreground">Checking or savings (US). You'll connect securely through your bank.</p></button>
        </div>
      )}
      <ErrorLine message={error} />
      {note && <p role="status" className="mb-3 rounded-md border p-2 text-sm">{note}</p>}
      <div ref={mount} className={kind ? "min-h-24" : "hidden"} />
      {kind && !note && <Button className="mt-4" onClick={submit} disabled={busy}>{busy ? "Please wait…" : "Save payment method"}</Button>}
      <p className="mt-3 text-xs text-muted-foreground">Your details go directly to Stripe. We never see or store your full card or account number.</p>
    </section>
  );
}

type Sub = { active: { name: string; billing: string; renewsOn: string | null; cancelAtPeriodEnd: boolean; charged: boolean } | null; pending: { name: string } | null };
type Payment = { id: string; plan: string; kind: string; billing: string; amount: number; currency: string; status: string; failureCode: string | null; createdAt: string };
const money = (n: number, c: string) => new Intl.NumberFormat("en-US", { style: "currency", currency: c }).format(n);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US") : "the end of the period");

/** The current plan with cancel-at-period-end, and the payment history. */
export function BillingSections() {
  const [sub, setSub] = useState<Sub | null>(null);
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { const [s, p] = await Promise.all([api<Sub>("/api/subscriptions"), api<Payment[]>("/api/payments")]); setSub(s); setPayments(p); }
    catch (e) { setError((e as Error).message); setPayments([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const toggle = async (cancel: boolean) => { try { setSub(await api<Sub>("/api/subscriptions", "PATCH", { cancelAtPeriodEnd: cancel })); } catch (e) { setError((e as Error).message); } };
  const a = sub?.active;
  return (
    <div className="mt-10 space-y-8">
      <ErrorLine message={error} />
      <section>
        <h2 className="mb-2 text-lg font-semibold">Your plan</h2>
        {!a ? <Empty>{sub?.pending ? `${sub.pending.name} is waiting for payment.` : "You're on the Free plan."}</Empty> : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
            <div>
              <p className="font-medium">{a.name} <Badge variant="secondary" className="ml-1">{a.billing}</Badge></p>
              <p className="text-xs text-muted-foreground">
                {!a.charged ? "Managed by an administrator." : a.cancelAtPeriodEnd ? `Ends on ${day(a.renewsOn)}. You won't be charged again.` : `Renews on ${day(a.renewsOn)} using your default payment method.`}
              </p>
            </div>
            {a.charged && (a.cancelAtPeriodEnd
              ? <Button variant="outline" size="sm" onClick={() => toggle(false)}>Keep my plan</Button>
              : <Button variant="outline" size="sm" onClick={() => { if (window.confirm("Stop renewal? Your plan stays active until the end of the paid period.")) toggle(true); }}>Cancel renewal</Button>)}
          </div>
        )}
      </section>
      <section>
        <h2 className="mb-2 text-lg font-semibold">Payment history</h2>
        {payments === null ? <Empty>Loading…</Empty> : !payments.length ? <Empty>No payments yet.</Empty> : (
          <ul className="divide-y rounded-xl border">
            {payments.map(p => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <span>{p.plan} · {p.kind === "renewal" ? "renewal" : "new plan"} <span className="text-muted-foreground">· {new Date(p.createdAt).toLocaleDateString("en-US")}</span></span>
                <span className="flex items-center gap-2"><span className="tabular-nums">{money(p.amount, p.currency)}</span>
                  <Badge variant={p.status === "succeeded" ? "secondary" : p.status === "failed" ? "destructive" : "outline"}>{p.status === "succeeded" ? "Paid" : p.status === "failed" ? "Failed" : "Processing"}</Badge></span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function PaymentMethods() {
  const [methods, setMethods] = useState<Method[] | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setMethods(await api<Method[]>("/api/payment-methods")); setError(""); }
    catch (e) { setError((e as Error).message); setMethods([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Back from a bank's redirect (or a 3-D Secure step): finish the setup Stripe reports in the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("setup_intent");
    if (!id) return;
    window.history.replaceState(null, "", window.location.pathname);
    api("/api/payment-methods", "POST", { setupIntentId: id }).then(load).catch(e => setError((e as Error).message));
  }, [load]);

  const act = async (id: string, work: () => Promise<unknown>) => {
    setBusyId(id); setError("");
    try { await work(); await load(); } catch (e) { setError((e as Error).message); } finally { setBusyId(null); }
  };

  return (
    <div>
      <div className="mb-4 flex justify-end">{!adding && <Button onClick={() => setAdding(true)}>Add payment method</Button>}</div>
      {adding && <AddMethod onSaved={load} onClose={() => setAdding(false)} />}
      <ErrorLine message={error} />
      {methods === null ? <Empty>Loading…</Empty> : !methods.length ? <Empty>No saved payment methods yet.</Empty> : (
        <ul className="divide-y rounded-xl border">
          {methods.map(m => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3">
                {m.kind === "card" ? <CreditCard className="h-5 w-5 text-muted-foreground" /> : <Building2 className="h-5 w-5 text-muted-foreground" />}
                <div>
                  <p className="font-medium">{title(m)} ending in {m.last4}{m.isDefault && <Badge variant="secondary" className="ml-2">Default</Badge>}</p>
                  <p className="text-xs text-muted-foreground">{m.kind === "card" && m.expMonth && m.expYear ? `Expires ${String(m.expMonth).padStart(2, "0")}/${m.expYear}` : "Bank account"}</p>
                </div>
              </div>
              <div className="flex gap-2">
                {!m.isDefault && <Button variant="outline" size="sm" disabled={busyId === m.id} onClick={() => act(m.id, () => api(`/api/payment-methods/${m.id}`, "PATCH"))}>Make default</Button>}
                <Button variant="ghost" size="icon" aria-label={`Remove ${title(m)} ending in ${m.last4}`} disabled={busyId === m.id}
                  onClick={() => { if (window.confirm(`Remove ${title(m)} ending in ${m.last4}?`)) act(m.id, () => api(`/api/payment-methods/${m.id}`, "DELETE")); }}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
