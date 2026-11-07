"use client";

import { BillingSections, PaymentMethods } from "@/components/user/payment-methods";
import { RailShell, useUserGate } from "@/components/user/shell";

export default function Page() {
  const user = useUserGate();
  if (!user) return null;
  return (
    <RailShell title="Payment methods" description="Cards and bank accounts saved for quick payment. Details are held by Stripe, not by us.">
      <PaymentMethods />
      <BillingSections />
    </RailShell>
  );
}
