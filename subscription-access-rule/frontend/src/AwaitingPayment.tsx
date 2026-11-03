// frontend/src/AwaitingPayment.tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Pending = {
  id: string;
  email: string;
  plan_id: string;
  plan_name: string;
  created_at: string;
  provider?: string;
};

export function AwaitingPayment({ token }: { token: string }) {
  const [rows, setRows] = useState<Pending[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch("/api/admin/subscriptions/pending", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then(setRows)
      .finally(() => setLoading(false));
  };

  useEffect(load, [token]);

  const activate = async (id: string) => {
    const r = await fetch(`/api/admin/subscriptions/${id}/activate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.ok) load();
    else alert(await r.text());
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Awaiting payment</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending subscriptions.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <div key={row.id} className="flex items-center justify-between border rounded-lg px-3 py-2">
                <div className="text-sm">
                  <div className="font-medium">{row.email}</div>
                  <div className="text-muted-foreground">
                    {row.plan_name} · {new Date(row.created_at).toLocaleDateString()}
                  </div>
                </div>
                <Button size="sm" onClick={() => activate(row.id)}>
                  Activate
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
