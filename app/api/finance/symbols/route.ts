import { userRoute } from "@/lib/users/route";
import { searchCatalog } from "@/lib/finance/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?q=btc: the assets the monitors and charts can name ("BTC-USD · Bitcoin / US Dollar"), each flagged live/history for this server. */
export const GET = (request: Request) => userRoute(request, false, async () => {
  const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 40);
  return { results: searchCatalog(q) };
});
