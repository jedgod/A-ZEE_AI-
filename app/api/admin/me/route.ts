import { endpoint, json } from "@/lib/admin/core";
import { requireHostActor } from "@/lib/admin/host-auth";

export const runtime = "nodejs";

export const GET = () =>
  endpoint(async () => {
    const actor = await requireHostActor();
    return json({
      userId: actor.userId,
      tenantId: actor.tenantId,
      role: actor.role,
      platform: actor.platform,
    });
  });
