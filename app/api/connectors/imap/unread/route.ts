import { isImapProvider, unreadEmails } from "@/lib/connectors/imap";
import { connectorRoute, NO_STORE } from "@/lib/connectors/route";
import { ConnectorError } from "@/lib/connectors/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/connectors/imap/unread[?provider=yahoo|icloud] -> { data: { emails, errors } }: the latest unread mail (up to 10 per account). */
export function GET(request: Request) {
  return connectorRoute(request, false, async owner => {
    const provider = new URL(request.url).searchParams.get("provider");
    if (provider !== null && !isImapProvider(provider)) throw new ConnectorError(422, "INVALID_INPUT");
    return Response.json({ data: await unreadEmails(owner, provider ?? undefined) }, { headers: NO_STORE });
  });
}
