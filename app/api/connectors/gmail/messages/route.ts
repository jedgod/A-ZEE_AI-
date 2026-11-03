import { gmailProvider } from "@/lib/connectors/gmail";
import { withToken } from "@/lib/connectors/service";
import { preference } from "@/lib/plugins/store";
import { connectorRoute, NO_STORE } from "@/lib/connectors/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/connectors/gmail/messages[?q=]: newest messages matching a Gmail search (default: inbox). */
export function GET(request: Request) {
  return connectorRoute(request, false, async owner => {
    // A typed search wins; otherwise the account's "Default search" plugin setting.
    const typed = new URL(request.url).searchParams.get("q");
    const saved = (await preference(owner, "gmail")).settings.defaultQuery;
    const q = typed || (typeof saved === "string" && saved.trim() ? saved : null);
    const mail = gmailProvider();
    return Response.json({ data: await withToken(owner, "gmail", "messages.search", q, token => mail.search(token, q ?? undefined)) }, { headers: NO_STORE });
  });
}
