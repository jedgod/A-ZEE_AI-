'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchQuotes } from './api';
import { DEFAULT_WATCH, guessClass, parseWatch, SYMBOL_PATTERN, type Asset, type AssetClass, type QuoteState, type WatchItem } from './logic';

/** The symbols the user follows. Stored in this browser only; symbols, never prices or balances. */
export function useWatchlist(userKey: string) {
  const key = `azee.aztrade.watchlist.${userKey}`;
  const [items, setItems] = useState<WatchItem[]>(DEFAULT_WATCH);
  useEffect(() => { try { setItems(parseWatch(window.localStorage.getItem(key))); } catch { setItems(DEFAULT_WATCH); } }, [key]);
  const save = useCallback((next: WatchItem[]) => { setItems(next); try { window.localStorage.setItem(key, JSON.stringify(next)); } catch { /* private window: the list still works for this visit */ } }, [key]);
  const add = useCallback((a: Asset) => {
    const symbol = a.symbol.trim().toUpperCase();
    if (!SYMBOL_PATTERN.test(symbol)) return;
    setItems(prev => {
      if (prev.some(i => i.symbol === symbol) || prev.length >= 50) return prev;
      const next = [...prev, { symbol, assetClass: a.assetClass }];
      try { window.localStorage.setItem(key, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [key]);
  const remove = useCallback((symbol: string) => setItems(prev => { const next = prev.filter(i => i.symbol !== symbol); try { window.localStorage.setItem(key, JSON.stringify(next)); } catch { /* ignore */ } return next; }), [key]);
  const classOf = useCallback((symbol: string): AssetClass => items.find(i => i.symbol === symbol)?.assetClass ?? guessClass(symbol), [items]);
  return { items, save, add, remove, classOf };
}

/** Delayed, informational quotes for a list of assets (the batch endpoint caches for a minute, so refreshing is cheap). */
export function useQuotes(wanted: Asset[], active: boolean) {
  const [quotes, setQuotes] = useState<QuoteState>({});
  const [busy, setBusy] = useState(false);
  const stamp = useRef({ key: '', at: 0 });
  const unique = useMemo(() => [...new Map(wanted.map(a => [a.symbol, a])).values()].slice(0, 25), [wanted]);
  const key = unique.map(a => a.symbol).join(',');
  const load = useCallback(async (force = false) => {
    if (!unique.length) return;
    if (!force && stamp.current.key === key && Date.now() - stamp.current.at < 60_000) return;
    stamp.current = { key, at: Date.now() };
    setBusy(true);
    try {
      const r = await fetchQuotes(unique);
      setQuotes(prev => { const next = { ...prev }; for (const x of r.results) next[x.symbol] = x.quote ? { quote: x.quote } : { error: x.error ?? 'QUOTE_UNAVAILABLE' }; return next; });
    } catch { /* keep what is already shown */ }
    finally { setBusy(false); }
  }, [unique, key]);
  useEffect(() => { if (active) void load(); }, [active, load]);
  return { quotes, busy, reload: () => load(true) };
}
