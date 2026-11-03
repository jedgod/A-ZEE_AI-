import { completeConnect, isProvider } from "@/lib/connectors/service";
import { ConnectorError } from "@/lib/connectors/types";
import { sidebarOwner } from "@/lib/sidebar-route";

export const runtime = "nodejs";

/** GET /api/connectors/:provider/callback?code&state: completes OAuth, then returns to /connectors. */
export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  const url = new URL(request.url);
  const back = (query: string) => Response.redirect(new URL(`/connectors?${query}`, process.env.APP_ORIGIN || url.origin), 303);
  if (!isProvider(provider)) return back("error=UNKNOWN_PROVIDER");
  try {
    const owner = await sidebarOwner(request);
    await completeConnect(owner, provider, { state: url.searchParams.get("state"), code: url.searchParams.get("code"), error: url.searchParams.get("error") });
    return back(`connected=${provider}`);
  } catch (error) {
    return back(`error=${encodeURIComponent(error instanceof ConnectorError ? error.code : "CONNECT_FAILED")}&provider=${provider}`);
  }
}
