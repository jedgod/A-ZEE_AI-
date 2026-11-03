import "server-only";
import { z } from "zod";
import { NO_STORE, sidebarOwner } from "@/lib/sidebar-route";
import { SidebarError } from "@/lib/sidebar";
import { ConnectorKeyMissingError } from "./crypto";
import { ConnectorError } from "./types";

// Shared by /api/connectors/*: this machine's signed-in account, same-origin for changes.
export async function connectorRoute(request: Request, mutation: boolean, work: (owner: string) => Promise<Response>) {
  try {
    return await work(await sidebarOwner(request, mutation));
  } catch (error) {
    const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: NO_STORE });
    if (error instanceof ConnectorError) return reply(error.status, { error: error.code, ...(error.message !== error.code ? { detail: error.message } : {}) });
    if (error instanceof ConnectorKeyMissingError) return reply(503, { error: "CONNECTOR_KEY_MISSING" });
    if (error instanceof SidebarError) return reply(error.status, { error: error.code });
    if (error instanceof z.ZodError) return reply(422, { error: "INVALID_INPUT" });
    console.warn("connector API failed:", (error as Error)?.message?.slice(0, 200));
    return reply(502, { error: "PROVIDER_UNAVAILABLE" });
  }
}
export { NO_STORE };
