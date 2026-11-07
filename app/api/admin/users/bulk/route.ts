import { endpoint, json } from "@/lib/admin/errors";
import { rateLimit, readBody, requireActor, sameOrigin } from "@/lib/admin/security";
import { bulkAction } from "@/lib/admin/user-tools";

export const runtime = "nodejs";

// Body: { ids: uuid[] (max 100), action: "suspend" | "unsuspend" | "export" }
export function POST(request: Request) {
  return endpoint(async () => {
    sameOrigin(request);
    const actor = await requireActor();
    await rateLimit(actor, true);
    return json(await bulkAction(actor, await readBody(request)));
  });
}
