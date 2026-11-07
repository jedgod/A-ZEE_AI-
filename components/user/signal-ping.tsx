"use client";

import { useEffect } from "react";
import { browserFingerprint } from "@/lib/users/fingerprint";

/** Reports this device once per browser session for signed-in users (free-plan abuse prevention). */
export function SignalPing() {
  useEffect(() => {
    try { if (sessionStorage.getItem("az-signal")) return; } catch { /* storage blocked: still fine */ }
    (async () => {
      const fingerprint = await browserFingerprint();
      const res = await fetch("/api/signals/record", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fingerprint ? { fingerprint } : {}),
      }).catch(() => null);
      if (res?.ok) { try { sessionStorage.setItem("az-signal", "1"); } catch { /* ignore */ } }
    })();
  }, []);
  return null;
}
