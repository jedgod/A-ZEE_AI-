"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Polls a JSON endpoint so a page stays current without a reload. Pauses while the tab is hidden
 * (and refreshes the moment it's visible again), keeps the last good data on a failed refresh,
 * and can be paused by the user.
 */
export function useLive<T>(url: string, initial: T | null, intervalMs: number, pick: (body: any) => T) {
  const [data, setData] = useState<T | null>(initial);
  const [updatedAt, setUpdatedAt] = useState<number | null>(initial ? Date.now() : null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(false);
  const pickRef = useRef(pick);
  pickRef.current = pick;

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await fetch(url, { cache: "no-store", signal });
      if (!res.ok) throw new Error(res.status === 403 ? "Not allowed" : `Request failed (${res.status})`);
      setData(pickRef.current(await res.json()));
      setUpdatedAt(Date.now());
      setError(null);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally { setLoading(false); }
  }, [url]);

  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    if (paused) return;
    const tick = () => { if (document.visibilityState === "visible") refresh(); };
    const timer = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [paused, intervalMs, refresh]);

  return { data, updatedAt, error, paused, setPaused, loading, refresh: () => refresh() };
}
