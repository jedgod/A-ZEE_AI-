import { endpoint, json } from "@/lib/admin/errors";
import { rateLimit, readBody, requireActor, sameOrigin } from "@/lib/admin/security";
import { promoteUser } from "@/lib/admin/user-tools";

export const runtime = "nodejs";

// Body: { userId: uuid, confirm: true }. Owner-only.
export function POST(request: Request) {
  return endpoint(async () => {
    sameOrigin(request);
    const actor = await requireActor();
    await rateLimit(actor, true);
    return json(await promoteUser(actor, await readBody(request)));
  });
}
