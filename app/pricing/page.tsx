import { PricingPlans } from "@/components/pricing-plans";

export const metadata = { title: "Pricing · AZ_AI" };

export default function PricingPage() {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-4 pt-6"><a href="/" className="text-sm text-muted-foreground hover:text-foreground">← Back to AZ_AI</a></div>
      <PricingPlans />
    </main>
  );
}
