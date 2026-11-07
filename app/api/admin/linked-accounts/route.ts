import { randomUUID } from "node:crypto";
import { z } from "zod";
import { flaggedCsv, listFlagged, setAllowed } from "@/lib/abuse/signals";
import { pool } from "@/lib/admin/db";
import { endpoint, json } from "@/lib/admin/errors";
import { authorize, rateLimit, readBody, requireActor, sameOrigin } from "@/lib/admin/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?q=: free accounts linked to others by device, with who they're linked to and why. Owners and admins only. */
export function GET(request: Request) {
  return endpoint(async () => {
    const actor = await requireActor();
    authorize(actor, "users.write");
    await rateLimit(actor, false);
    const params = new URL(request.url).searchParams;
    const accounts = await listFlagged((params.get("q") ?? "").slice(0, 100));
    if (params.get("format") === "csv") {
      return new Response(flaggedCsv(accounts), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
          "Content-Disposition": `attachment; filename="linked-accounts-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }
    return json({ accounts });
  });
}

const input = z.object({ userId: z.string().min(1).max(100), allowed: z.boolean(), note: z.string().trim().max(300).optional() }).strict();

/** POST { userId, allowed, note? }: clear the upgrade wall for an account (a false positive), or restore automatic handling. */
export function POST(request: Request) {
  return endpoint(async () => {
    sameOrigin(request);
    const actor = await requireActor();
    authorize(actor, "users.write");
    await rateLimit(actor, true);
    const body = input.parse(await readBody(request));
    if (!await setAllowed(body.userId, body.allowed, body.note ?? null)) return json({ error: "NOT_FOUND" }, 404);
    if (z.string().uuid().safeParse(body.userId).success) {
      await pool.query(`INSERT INTO admin_audit (id, tenant_id, actor_id, action, resource_id) VALUES ($1,$2,$3,$4,$5)`,
        [randomUUID(), actor.tenantId, actor.userId, body.allowed ? "users.abuse_allow" : "users.abuse_reset", body.userId]);
    }
    return json({ ok: true });
  });
}
