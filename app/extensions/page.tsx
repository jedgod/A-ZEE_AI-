// ============================================================
// 15_EXTENSIONS / SHADCN + TAILWIND MANAGEMENT PAGE
// ============================================================
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { manifestSchema, type Manifest } from "@/lib/extensions/manifest";
import { z } from "zod";

const rowSchema = manifestSchema.extend({
  installation: z.object({
    id: z.string(), version: z.string(), enabled: z.boolean(),
    grants: z.array(z.string()),
  }).nullable(),
});
type Row = z.infer<typeof rowSchema>;

export default function ExtensionsPage() {
  const [items, setItems] = useState<Row[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/extensions", { cache: "no-store" });
    if (!response.ok) throw new Error("Catalog unavailable");
    setItems(z.array(rowSchema).parse(await response.json()));
  }

  useEffect(() => {
    load().catch(() => setStatus("Unable to load the catalog."));
  }, []);

  async function toggle(item: Row) {
    const enabled = !item.installation?.enabled;
    if (enabled && !window.confirm(
      "Approve version " + item.version + " with permissions: " +
      item.permissions.join(", ") + "?"
    )) return;
    setBusy(true);
    try {
      const response = await fetch("/api/extensions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id, enabled, grants: item.permissions,
        }),
      });
      if (!response.ok) throw new Error("Save failed");
      await load();
      setStatus("Configuration saved.");
    } catch {
      setStatus("Unable to save extension configuration.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-6">
      <header className="border-b pb-6">
        <p className="font-mono text-xs text-muted-foreground">15_EXTENSIONS</p>
        <h1 className="mt-3 text-4xl font-semibold">Governed extensions</h1>
        <p className="mt-3 text-muted-foreground">
          Reviewed built-ins. Tenant-scoped approval. Explicit permissions.
        </p>
      </header>
      <div role="status" className="text-sm">{status}</div>
      <ul className="divide-y">
        {items.map(item => (
          <li key={item.id} className="flex flex-col gap-5 py-6 sm:flex-row sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold">{item.name}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{item.description}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="outline">v{item.version}</Badge>
                {item.permissions.map(p => <Badge key={p} variant="secondary">{p}</Badge>)}
              </div>
            </div>
            <Button disabled={busy} onClick={() => toggle(item)}>
              {item.installation?.enabled ? "Disable" : "Review & enable"}
            </Button>
          </li>
        ))}
      </ul>
    </main>
  );
}

// Protect this page in your application auth middleware.
// API independently enforces authorization.
