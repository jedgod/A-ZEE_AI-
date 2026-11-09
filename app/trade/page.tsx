import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { TradeApp } from "@/components/trade/trade-app";
import { sessionUser } from "@/lib/users/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "AZTrade · AZ_AI" };

/** AZTrade workspace (paper trading). Requires a signed-in, verified A-Zee account; everything it shows comes from the AZTrade API through the server-side proxy. */
export default async function TradePage() {
  const request = new Request("http://localhost/trade", { headers: await headers() });
  if (!await sessionUser(request)) redirect("/signin?next=/trade");
  return <TradeApp />;
}
