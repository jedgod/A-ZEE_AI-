"use client";

import { use, useEffect, useState } from "react";

const validModules = [
  "dashboard",
  "tenants",
  "users",
  "roles",
  "approvals",
  "policies",
  "registry",
  "billing",
  "incidents",
] as const;

type ValidModule = (typeof validModules)[number];

export default function AdminModulePage({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module } = use(params);
  const [data, setData] = useState<string>("Loading...");
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/${module}`, {
        cache: "no-store",
      });
      const text = await response.text();
      setData(text);
    } catch {
      setData("Unable to load admin data.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if ((validModules as readonly string[]).includes(module)) {
      load();
    } else {
      setData("Unknown module.");
    }
  }, [module]);

  if (!(validModules as readonly string[]).includes(module)) {
    return (
      <main className="p-6">
        <h1 className="text-xl font-semibold">Unknown admin module</h1>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      <header className="flex items-center justify-between gap-4 border-b pb-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            15_ADMIN
          </p>
          <h1 className="mt-2 text-2xl font-semibold">{module}</h1>
        </div>
        <button
          className="rounded border px-3 py-2 text-sm hover:bg-muted"
          disabled={busy}
          onClick={load}
        >
          {busy ? "Loading…" : "Refresh"}
        </button>
      </header>

      <pre className="overflow-auto whitespace-pre-wrap rounded border p-4 text-xs">
        {data}
      </pre>
    </main>
  );
}
