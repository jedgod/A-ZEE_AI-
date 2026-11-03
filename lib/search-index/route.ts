import "server-only";
import { z } from "zod";
import { ConnectorKeyMissingError } from "@/lib/connectors/crypto";
import { ConnectorError } from "@/lib/connectors/types";
import { SidebarError } from "@/lib/sidebar";
import { NO_STORE, sidebarOwner } from "@/lib/sidebar-route";
import { IndexError } from "./chunk";

// Shared by /api/v1/search/index/*: this machine's signed-in account; changes must be same-origin
// and carry the X-AZee-Request header (as for the code agent).

export async function indexRoute(request: Request, mutation: boolean, work: (owner: string) => Promise<Response>) {
  const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: NO_STORE });
  try {
    if (mutation && request.headers.get("x-azee-request") !== "1") return reply(403, { error: "CSRF_HEADER_REQUIRED" });
    return await work(await sidebarOwner(request, mutation));
  } catch (error) {
    if (error instanceof IndexError) return reply(error.status, { error: error.code, ...(error.detail !== undefined ? { detail: error.detail } : {}) });
    // Connector errors keep their meaning (NOT_CONNECTED, NOT_FOUND, BINARY_FILE, …) under a SOURCE_ prefix.
    if (error instanceof ConnectorError) return reply(error.status, { error: error.code === "NOT_FOUND" ? "SOURCE_NOT_FOUND" : error.code });
    if (error instanceof ConnectorKeyMissingError) return reply(503, { error: "CONNECTOR_KEY_MISSING" });
    if (error instanceof SidebarError) return reply(error.status, { error: error.code });
    if (error instanceof z.ZodError) return reply(422, { error: "INVALID_INPUT", issues: error.issues.slice(0, 5).map(i => `${i.path.join(".") || "body"}: ${i.message}`) });
    if (error instanceof SyntaxError) return reply(422, { error: "INVALID_JSON" });
    if (error instanceof Response) return error;
    console.warn("search index API failed:", (error as Error)?.message?.slice(0, 200));
    return reply(503, { error: "SERVICE_UNAVAILABLE" });
  }
}

export const ok = (data: unknown, status = 200) => Response.json({ data }, { status, headers: NO_STORE });
export const noContent = () => new Response(null, { status: 204, headers: NO_STORE });
