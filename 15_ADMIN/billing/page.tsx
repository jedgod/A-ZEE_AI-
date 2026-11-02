const billing = [
  { label: "Monthly spend", value: "$24,800", delta: "+7.2%" },
  { label: "Token usage", value: "18.4M", delta: "+11.1%" },
  { label: "Latency budget", value: "420 ms", delta: "-3.4%" },
  { label: "Storage usage", value: "1.8 TB", delta: "+2.6%" },
];

export default function BillingPage() {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="mb-6 border-b pb-4">
        <p className="font-mono text-xs text-muted-foreground">BILLING</p>
        <h1 className="mt-2 text-3xl font-semibold">Usage and limits</h1>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {billing.map((item) => (
          <div key={item.label} className="rounded-xl border p-4">
            <p className="text-sm text-muted-foreground">{item.label}</p>
            <p className="mt-4 text-3xl font-semibold">{item.value}</p>
            <p className="mt-2 text-xs text-emerald-600">{item.delta}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
