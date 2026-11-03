// components/pricing-plans.tsx
"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { formatUsd } from "@/lib/pricing";

// Plans, prices, features, and limits come from the database (plans / usage_limits tables,
// migrations 008–009) via /api/plans, which applies regional pricing from lib/pricing.ts.
// Edit plans there, not in this file.

type Feature = "messages" | "reasoning" | "research";
type Plan = {
  id: string; name: string; interval: "month" | "user/month" | "custom"; bestFor: string | null; popular: boolean;
  features: string[]; price: number | null; annualPrice: number | null; basePriceUsd: number;
  limits: Partial<Record<Feature, number | null>>;
};
type PlansData = {
  region: string | null; regionalDiscount: boolean; plans: Plan[]; canSubscribe: boolean;
  current: {
    planId: string;
    subscription: { active: { planId: string; name: string } | null; pending: { planId: string; name: string } | null } | null;
  };
};

const limit = (n: number | null | undefined) => (n === null ? "Unlimited" : n === undefined ? "—" : n.toLocaleString());

export function PricingPlans() {
  const [billing, setBilling] = useState<"monthly" | "annual">("monthly");
  const [data, setData] = useState<PlansData | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => fetch("/api/plans", { cache: "no-store" })
    .then(r => (r.ok ? r.json() : Promise.reject()))
    .then(j => setData(j.data))
    .catch(() => setError("Plans couldn't be loaded. Check that the database is running."));
  useEffect(() => { load(); }, []);

  async function choose(plan: Plan) {
    setBusy(plan.id); setMessage("");
    try {
      const response = await fetch("/api/subscriptions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: plan.id, billing: plan.annualPrice !== null ? billing : "monthly" }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(json.error === "LOCAL_ONLY" ? "Plans can only be changed from the machine running AZ_AI." : "Couldn't change your plan. Try again.");
        return;
      }
      const r = json.data;
      setMessage(
        r.status === "active" ? `You're now on ${plan.name}.`
          : r.status === "contact_sales" ? (r.ticket ? `Thanks! Our team will contact you (request ${r.ticket}).` : "Thanks! Contact sales to set up Enterprise.")
          : `${plan.name} is reserved at ${formatUsd(r.price)}/${r.billing === "annual" ? (plan.interval === "user/month" ? "user/year" : "year") : plan.interval}. Payments aren't connected yet, so an administrator activates it once paid.`,
      );
      load();
    } finally {
      setBusy(null);
    }
  }

  const priceOf = (plan: Plan) => {
    if (plan.price === null) return { amount: "Custom", unit: "" };
    if (billing === "annual" && plan.annualPrice !== null) return { amount: formatUsd(plan.annualPrice), unit: plan.interval === "user/month" ? "user/year" : "year" };
    return { amount: formatUsd(plan.price), unit: plan.interval };
  };

  const plus = data?.plans.find(p => p.id === "plus");
  const pros = data?.plans.filter(p => p.id.startsWith("pro")) ?? [];
  const proPrices = pros.map(p => p.price ?? 0);
  const proRange = pros.length ? `${formatUsd(Math.min(...proPrices))}–${formatUsd(Math.max(...proPrices))}` : "";

  return (
    <div className="max-w-7xl mx-auto px-4 py-12">
      <div className="text-center mb-10">
        <h2 className="text-3xl font-bold">Pricing</h2>
        <p className="text-muted-foreground mt-2">Subscription plans, monthly allowances, and advanced features.</p>
        <Tabs value={billing} onValueChange={(v) => setBilling(v as "monthly" | "annual")} className="mt-6 inline-flex">
          <TabsList>
            <TabsTrigger value="monthly">Monthly</TabsTrigger>
            <TabsTrigger value="annual">Annual <Badge variant="secondary" className="ml-2">2 months free</Badge></TabsTrigger>
          </TabsList>
        </Tabs>
        {data?.regionalDiscount && <p className="mt-3 text-sm text-emerald-700">Regional pricing for {data.region}: 10% off.</p>}
      </div>

      {error && <p role="alert" className="text-center text-sm text-destructive">{error}</p>}
      {message && <p role="status" className="mx-auto mb-6 max-w-2xl rounded-md border bg-card p-3 text-center text-sm">{message}</p>}

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {data?.plans.map((plan) => {
          const { amount, unit } = priceOf(plan);
          const current = data.current.planId === plan.id;
          const pending = data.current.subscription?.pending?.planId === plan.id;
          return (
            <Card key={plan.id} className={plan.popular ? "border-primary shadow-lg" : ""}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  {plan.name}
                  <span className="flex gap-1">
                    {current && <Badge variant="secondary">Current</Badge>}
                    {plan.popular && <Badge variant="default">Popular</Badge>}
                  </span>
                </CardTitle>
                <CardDescription>{plan.bestFor}</CardDescription>
                <div className="text-3xl font-bold mt-2">
                  {amount}
                  {unit && <span className="text-sm font-normal text-muted-foreground">/{unit}</span>}
                </div>
                {billing === "annual" && plan.price !== null && plan.price > 0 && plan.annualPrice === null && (
                  <p className="text-xs text-muted-foreground">Monthly billing only</p>
                )}
                {data.regionalDiscount && plan.price !== null && plan.basePriceUsd > 0 && (
                  <p className="text-xs text-emerald-600">Regional pricing applied</p>
                )}
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <Check className="h-4 w-4 shrink-0 text-primary" /> {f}
                    </li>
                  ))}
                </ul>
                {plan.limits.messages !== undefined && (
                  <p className="mt-4 text-xs text-muted-foreground">
                    {limit(plan.limits.messages)} messages · {limit(plan.limits.reasoning)} reasoning · {limit(plan.limits.research)} research per month
                  </p>
                )}
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full"
                  variant={plan.popular ? "default" : "outline"}
                  disabled={current || pending || busy !== null || !data.canSubscribe}
                  onClick={() => choose(plan)}
                >
                  {current ? "Your plan" : pending ? "Awaiting payment" : plan.price === null ? "Contact sales" : "Get started"}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
      {data && !data.canSubscribe && <p className="mt-4 text-center text-xs text-muted-foreground">Plans can be changed from the machine running AZ_AI.</p>}

      <div className="mt-16">
        <h3 className="text-xl font-semibold mb-4">What you're paying for</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3">Feature</th>
                <th className="p-3">Plus{plus?.price != null ? ` (${formatUsd(plus.price)})` : ""}</th>
                <th className="p-3">Pro{proRange ? ` (${proRange})` : ""}</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["AZ · Reasoning (draft, review, revise)", limit(plus?.limits.reasoning), "Higher limits"],
                ["Explore deeply (research plans)", limit(plus?.limits.research), "Higher limits"],
                ["Code mode and development canvas", "Yes", "Yes"],
                ["AZee Connect for VS Code and other editors", "Included", "Included"],
                ["Messages per month", limit(plus?.limits.messages), pros.length ? `${limit(pros[0].limits.messages)} – ${limit(pros[pros.length - 1].limits.messages)}` : "—"],
                ["Personalization and file attachments", "Yes", "Yes"],
              ].map(([feature, plusValue, pro]) => (
                <tr key={feature} className="border-b">
                  <td className="p-3">{feature}</td>
                  <td className="p-3 text-center">{plusValue}</td>
                  <td className="p-3 text-center">{pro}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Ordinary conversations use a fixed monthly allowance. Requests from VS Code and other editors use your API token&apos;s own rate limit.
          Prices in USD; final pricing is confirmed at checkout.
        </p>
      </div>
    </div>
  );
}
