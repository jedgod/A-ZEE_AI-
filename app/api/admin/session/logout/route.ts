import { endpoint, json, sameOrigin } from "@/lib/admin/core";
import { requireHostActor } from "@/lib/admin/host-auth";
import { revokeCurrentSession } from "@/lib/admin/host-session";

export const runtime = "nodejs";

export const POST = (request: Request) =>
  endpoint(async () => {
    sameOrigin(request);
    await requireHostActor();
    await revokeCurrentSession();
    return json({ loggedOut: true });
  });
