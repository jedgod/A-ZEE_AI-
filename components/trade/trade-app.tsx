"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Me = { user: { name: string; email: string }; plan: string; planName: string; tier: string; allowance: { used: number; limit: number | null } };
type Position = { symbol: string; shares: string; entry_price: string; current_price: string | null; market_value: string | null };
type Order = { id: string; symbol: string; side: string; shares: string; price: string; status: string };
type Account = { cash: string; positions: Position[]; history: Order[] };
type Quote = { symbol: string; price: string; source_name: string; observed_at: string };
type Market = { status: "licensed" | "unavailable"; quotes: Quote[] };
type Msg = { role: "user" | "assistant"; content: string };

const api = async (path: string, init?: RequestInit) => {
  const res = await fetch(`/api/trade/${path}`, { ...init, headers: { "content-type": "application/json" }, cache: "no-store" });
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
};
const money = (text: string | null | undefined) => (text == null ? "-" : `$${Number(text).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export function TradeApp() {
  const [me, setMe] = useState<Me | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [market, setMarket] = useState<Market | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [expired, setExpired] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [backtest, setBacktest] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const orderKey = useRef<string | null>(null);        // the same key is reused until the order is answered, so a retry can never place it twice
  const chatId = useRef<string | null>(null);

  const guard = useCallback((status: number) => { if (status === 401) { setExpired(true); return true; } return false; }, []);
  const refresh = useCallback(async () => {
    const [m, a, k, h] = await Promise.all([fetch("/api/trade/me", { cache: "no-store" }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) })), api("account"), api("markets"), api("assistant/history")]);
    if ([m.status, a.status, k.status, h.status].some(guard)) return;
    if (m.status === 200) setMe(m.body);
    if (a.status === 200) setAccount(a.body);
    if (k.status === 200) setMarket(k.body); else setMarket({ status: "unavailable", quotes: [] });
    if (h.status === 200) setMessages((h.body as { role: "user" | "assistant"; content: string }[]).map(x => ({ role: x.role, content: x.content })));
  }, [guard]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function placeOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    orderKey.current ??= `ui-${crypto.randomUUID()}`;
    setBusy(true); setNotice(null);
    try {
      const r = await api("orders", { method: "POST", body: JSON.stringify({ symbol: String(form.get("symbol")).trim().toUpperCase(), side: form.get("side"), shares: String(form.get("shares")).trim(), idempotencyKey: orderKey.current }) });
      if (guard(r.status)) return;
      if (r.status === 201 || r.status === 200) { orderKey.current = null; setNotice({ kind: "ok", text: r.status === 200 ? "This order was already placed; no second order was created." : "Paper order filled." }); await refresh(); }
      else if (r.status === 403) { orderKey.current = null; setNotice({ kind: "error", text: "You do not have permission to do that." }); }
      else if (r.status === 503) setNotice({ kind: "error", text: "Trading is temporarily unavailable. Retry: the same request will not be placed twice." });
      else { orderKey.current = null; setNotice({ kind: "error", text: String(r.body?.error ?? "The order was refused.") }); }
    } catch { setNotice({ kind: "error", text: "Network problem. Retry: the same request will not be placed twice." }); }
    finally { setBusy(false); }
  }

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget; const text = String(new FormData(form).get("message") ?? "").trim();
    if (!text) return;
    chatId.current ??= crypto.randomUUID(); setBusy(true); setAiNotice(null);
    try {
      const r = await api("assistant/chat", { method: "POST", body: JSON.stringify({ message: text, requestId: chatId.current }) });
      if (guard(r.status)) return;
      if (r.status === 200) { chatId.current = null; form.reset(); await refresh(); }
      else if (r.status === 429) { chatId.current = null; setAiNotice("Your AI allowance for this month is used up."); await refresh(); }
      else if (r.status === 409) setAiNotice("That question is still being answered. Try again in a moment.");
      else { setAiNotice("The assistant is unavailable right now. You were not charged."); }
    } catch { setAiNotice("Network problem. Try again; you will not be charged twice."); }
    finally { setBusy(false); }
  }

  async function runBacktest() {
    setBacktest(null);
    const r = await api("strategies/momentum/backtest", { method: "POST", body: JSON.stringify({}) });
    if (guard(r.status)) return;
    if (r.status === 403) setBacktest({ kind: "error", text: "Strategy backtests need the Plus plan or higher." });
    else if (r.status === 200) setBacktest({ kind: "ok", text: `Simulated illustration, not market data: ${r.body.trades} trades, ${r.body.winRate}% win rate, ${r.body.returnPct}% return.` });
    else setBacktest({ kind: "error", text: "Backtest unavailable." });
  }

  async function signOut() { await fetch("/api/auth/logout", { method: "POST", headers: { "x-az-client": "web" } }).catch(() => undefined); window.location.href = "/signin"; }

  if (expired) return (
    <main className="mx-auto max-w-xl p-6" data-testid="session-expired">
      <Card><CardHeader><CardTitle>Your session has ended</CardTitle></CardHeader>
        <CardContent><p className="mb-4 text-sm text-muted-foreground">For your security, sign in again to continue. Nothing was changed.</p><a className="underline" href="/signin?next=/trade">Sign in</a></CardContent></Card>
    </main>
  );

  const allowance = me ? (me.allowance.limit === null ? `${me.allowance.used} used (unlimited plan)` : `${me.allowance.used} of ${me.allowance.limit} used`) : "";
  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-xl font-semibold">AZTrade <span className="text-sm font-normal text-muted-foreground">paper trading</span></h1>
          <p className="text-xs text-muted-foreground" data-testid="mode-note">Paper money only. Live trading is off. The assistant explains data; it cannot place orders.</p></div>
        <div className="flex items-center gap-2 text-sm">
          {me && <><span data-testid="user-name">{me.user.name}</span><Badge data-testid="plan-badge">{me.planName} · {me.tier}</Badge></>}
          <Button variant="outline" size="sm" onClick={signOut}>Sign out</Button>
        </div>
      </header>

      <Card data-testid="market-panel"><CardHeader><CardTitle>Market data</CardTitle></CardHeader><CardContent>
        {market?.status === "licensed" ? (
          <table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th>Symbol</th><th>Price</th><th>Source</th><th>Observed</th></tr></thead>
            <tbody>{market.quotes.map(q => <tr key={q.symbol} data-testid={`quote-${q.symbol}`}><td>{q.symbol}</td><td>{money(q.price)}</td><td>{q.source_name}</td><td>{new Date(q.observed_at).toLocaleString()}</td></tr>)}</tbody></table>
        ) : <p data-testid="market-unavailable" className="text-sm">No licensed market data is connected. No prices are shown, and paper orders cannot be filled until a licensed source is registered.</p>}
      </CardContent></Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card data-testid="account-panel"><CardHeader><CardTitle>Paper account</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
          <div>Cash: <strong data-testid="cash">{account ? money(account.cash) : "…"}</strong></div>
          <div><div className="font-medium">Positions</div>
            {account?.positions.length ? <ul data-testid="positions">{account.positions.map(p => <li key={p.symbol}>{p.symbol}: {Number(p.shares)} @ {money(p.entry_price)} (market value {money(p.market_value)})</li>)}</ul> : <p className="text-muted-foreground" data-testid="no-positions">No positions.</p>}</div>
          <div><div className="font-medium">Orders</div>
            {account?.history.length ? <ul data-testid="orders">{account.history.map(o => <li key={o.id}>{o.side} {Number(o.shares)} {o.symbol} @ {money(o.price)} · {o.status}</li>)}</ul> : <p className="text-muted-foreground" data-testid="no-orders">No orders.</p>}</div>
        </CardContent></Card>

        <Card><CardHeader><CardTitle>Place a paper order</CardTitle></CardHeader><CardContent>
          <form onSubmit={placeOrder} className="space-y-3" data-testid="order-form">
            <div><Label htmlFor="symbol">Symbol</Label><Input id="symbol" name="symbol" required maxLength={32} /></div>
            <div><Label htmlFor="side">Side</Label><select id="side" name="side" className="h-9 w-full rounded-md border bg-background px-2 text-sm"><option>BUY</option><option>SELL</option></select></div>
            <div><Label htmlFor="shares">Shares</Label><Input id="shares" name="shares" required inputMode="decimal" /></div>
            <Button type="submit" disabled={busy}>Place paper order</Button>
            {notice && <p role="status" data-testid="order-notice" className={notice.kind === "error" ? "text-sm text-red-600" : "text-sm text-green-600"}>{notice.text}</p>}
          </form>
        </CardContent></Card>
      </div>

      <Card data-testid="assistant-panel"><CardHeader><CardTitle>AI assistant</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">Answers use only your own AZTrade data. With no licensed market data it will not quote a price. It can suggest ideas to study; it cannot trade for you.</p>
        <p data-testid="ai-allowance">AI allowance this month: {allowance}</p>
        <ul className="space-y-2" data-testid="messages">{messages.map((m, i) => <li key={i} className={m.role === "user" ? "text-muted-foreground" : ""}><strong>{m.role === "user" ? "You" : "AZTrade AI"}:</strong> {m.content}</li>)}</ul>
        <form onSubmit={ask} className="flex gap-2" data-testid="chat-form"><Input name="message" aria-label="Ask the assistant" maxLength={4000} required /><Button type="submit" disabled={busy}>Send</Button></form>
        {aiNotice && <p role="status" data-testid="ai-notice" className="text-red-600">{aiNotice}</p>}
      </CardContent></Card>

      <Card data-testid="strategy-panel"><CardHeader><CardTitle>Strategy lab</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
        <Button variant="outline" onClick={runBacktest}>Run momentum backtest (Plus plan)</Button>
        {backtest && <p role="status" data-testid="backtest-result" className={backtest.kind === "error" ? "text-red-600" : ""}>{backtest.text}</p>}
      </CardContent></Card>
    </main>
  );
}
