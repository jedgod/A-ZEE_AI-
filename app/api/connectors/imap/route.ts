import { allow, clientKey } from "@/lib/users/auth";
import { connectAccount, disconnectAccount, isImapProvider, listAccounts } from "@/lib/connectors/imap";
import { connectorRoute, NO_STORE } from "@/lib/connectors/route";
import { ConnectorError } from "@/lib/connectors/types";
import { body } from "@/lib/sidebar-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/connectors/imap -> { data: { accounts: [{ provider, email }] } }. Credentials are never returned. */
export function GET(request: Request) {
  return connectorRoute(request, false, async owner => Response.json({ data: { accounts: await listAccounts(owner) } }, { headers: NO_STORE }));
}

/**
 * POST /api/connectors/imap { provider: "yahoo" | "icloud", email, appPassword } -> { data: { provider, email } }.
 * Verifies the login over TLS first and stores it sealed only if it works. Limited to 5 attempts a minute.
 */
export function POST(request: Request) {
  return connectorRoute(request, true, async owner => {
    if (!await allow("imap-connect", owner, 5)) throw new ConnectorError(429, "RATE_LIMITED");
    return Response.json({ data: await connectAccount(owner, await body(request) as never) }, { status: 201, headers: NO_STORE });
  });
}

/** DELETE /api/connectors/imap?provider=yahoo|icloud: disconnects and deletes the stored credentials. */
export function DELETE(request: Request) {
  return connectorRoute(request, true, async owner => {
    const provider = new URL(request.url).searchParams.get("provider");
    if (!isImapProvider(provider)) throw new ConnectorError(422, "INVALID_INPUT");
    if (!await disconnectAccount(owner, provider)) throw new ConnectorError(404, "NOT_FOUND");
    return Response.json({ data: { disconnected: true } }, { headers: NO_STORE });
  });
}
