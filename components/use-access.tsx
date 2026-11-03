"use client";

// Adapted from subscription-access-rule/frontend/src/useAccess.tsx. The app identifies the
// visitor by cookie (local account or guest), so no bearer token is needed. This only shapes the
// UI; /api/chat and /api/translate enforce the same entitlements on the server.

import { useCallback, useEffect, useState } from "react";

export type Access = {
  plan: string;
  planName: string;
  entitlements: { feature: string; enabled: boolean; monthlyLimit: number | null; used: number }[];
};

export function useAccess() {
  const [access, setAccess] = useState<Access | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    fetch("/api/me/access", { cache: "no-store" })
      .then(r => (r.ok ? r.json() : null))
      .then(j => setAccess(j?.data ?? null))
      .catch(() => setAccess(null))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // Unknown access (offline, no database) doesn't hide features; the server still decides.
  const can = (feature: string) => (access ? access.entitlements.find(e => e.feature === feature)?.enabled ?? false : true);

  return { access, loading, can, refresh };
}
