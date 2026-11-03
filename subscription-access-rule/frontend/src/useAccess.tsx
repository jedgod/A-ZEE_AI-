// Example React component that gates UI on server entitlements
// Place in your frontend (Next.js / Vite / etc.)

import { useEffect, useState } from 'react';

type Access = {
  plan: string;
  planName: string;
  entitlements: { feature: string; enabled: boolean; monthly_limit: number | null }[];
};

export function useAccess(token: string | null) {
  const [access, setAccess] = useState<Access | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    fetch('/api/me/access', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.ok ? r.json() : null)
      .then(setAccess)
      .finally(() => setLoading(false));
  }, [token]);

  const can = (feature: string) =>
    access?.entitlements.find((e) => e.feature === feature)?.enabled ?? false;

  return { access, loading, can };
}

// Usage:
// const { can, access } = useAccess(token);
// if (!can('premium_articles')) return <UpgradePrompt />;
