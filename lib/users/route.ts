import "server-only";
import { readJson } from "@/lib/http";
import { requireUser, userFailure } from "./auth";
import type { SessionUser } from "./types";

const NO_STORE = { "Cache-Control": "no-store" };

/** Runs `work` for the signed-in user (401 otherwise); writes also get the same-origin and rate-limit checks. */
export async function userRoute(request: Request, write: boolean, work: (user: SessionUser) => Promise<unknown>, status = 200): Promise<Response> {
  try {
    const user = await requireUser(request, write);
    const out = await work(user);
    return out instanceof Response ? out : Response.json({ data: out }, { status, headers: NO_STORE });
  } catch (error) {
    return userFailure(error);
  }
}

export const jsonBody = (request: Request, limit = 16_000) => readJson(request, limit);
