import { z } from "zod";
import { readJson } from "@/lib/http";
import { accountById } from "@/lib/accounts";
import { anonCookie, readAnonId } from "@/lib/pipeline/actor";
import { sessionUser } from "@/lib/users/auth";
import { supportTenantId } from "@/lib/staff/auth";
import { createComplaint, listForReporter } from "@/lib/support/complaints";
import { errorResponse, NO_STORE, rateLimit, requireSameOrigin, uuid } from "@/lib/staff/route";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

const body = z.object({
  category: z.enum(["bug", "support", "feedback"]),
  subject: z.string().trim().min(1).max(150),
  body: z.string().trim().min(1).max(5000),
  name: z.string().trim().max(100).optional(),
  contact: z.string().trim().email().max(254).optional().or(z.literal("").transform(() => undefined)),
  requestId: uuid.optional(),
}).strict();

/** Users send a bug report or support request to the staff queue (Help menu and 👎 feedback). */
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const tenantId = await supportTenantId();
    if (!tenantId) return Response.json({ error: "SUPPORT_NOT_CONFIGURED" }, { status: 503, headers: NO_STORE });
    const existing = readAnonId(request);
    const reporter = existing ?? randomUUID();
    if (!await rateLimit("support", reporter, 5)) return Response.json({ error: "RATE_LIMITED" }, { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } });
    const input = body.parse(await readJson(request, 20_000));
    // A signed-in user's account supplies the name and email; guests may give them.
    const signedIn = await sessionUser(request);
    const account = signedIn ? await accountById(signedIn.id) : null;
    const complaint = await createComplaint({
      tenantId, source: input.category === "feedback" ? "feedback" : "app", category: input.category, reporterRef: reporter,
      customerName: account?.name ?? (input.name || "App user"), customerContact: account?.email ?? input.contact ?? null,
      subject: input.subject, body: input.body, requestId: input.requestId ?? null,
    });
    return Response.json({ data: { id: complaint.display, status: complaint.status } }, {
      status: 201, headers: { ...NO_STORE, ...(existing ? {} : { "Set-Cookie": anonCookie(reporter) }) },
    });
  } catch (error) { return errorResponse(error); }
}

/** This browser's own requests and, once approved, their resolutions. */
export async function GET(request: Request) {
  try {
    const reporter = readAnonId(request);
    return Response.json({ data: reporter ? await listForReporter(reporter) : [] }, { headers: NO_STORE });
  } catch (error) { return errorResponse(error); }
}
