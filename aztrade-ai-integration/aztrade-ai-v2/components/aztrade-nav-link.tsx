"use client";
import Link from "next/link";
import { ChartCandlestick } from "lucide-react";
/** Drop into the existing A-Zee workspace sidebar or icon rail; navigation never grants API authorization. */
export function AZTradeNavLink({ className = "" }: { className?: string }) {
  return <Link href="/aztrade" className={className} aria-label="AZTrade AI" title="AZTrade AI">
    <ChartCandlestick size={20} aria-hidden="true" />
    <span className="sr-only">AZTrade AI</span>
  </Link>;
}
