import { endpoint, json } from "@/lib/admin/errors";
import { rateLimit, readBody, requireActor, sameOrigin } from "@/lib/admin/security";
import { bulkPromote } from "@/lib/admin/user-tools";

export const runtime = "nodejs";

// Body: { ids: uuid[] (max 20), confirmPhrase: "PROMOTE" }. Owner-only.
export function POST(request: Request) {
  return endpoint(async () => {
    sameOrigin(request);
    const actor = await requireActor();
    await rateLimit(actor, true);
    return json(await bulkPromote(actor, await readBody(request)));
  });
}
