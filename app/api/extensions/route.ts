// ============================================================
// 15_EXTENSIONS / CURATED CATALOG API
// ============================================================
// Imported through the 15_EXTENSIONS facade (the module's public entry point).
import { installations, registry, saveInstallation } from "@/15_EXTENSIONS/registry";
import { requireActor, requireAdmin, requireSameOrigin } from "@/15_EXTENSIONS/permissions";
import { permissionSchema } from "@/15_EXTENSIONS/manifests";
import { audit } from "@/15_EXTENSIONS/audit";
import { z } from "zod";

export const runtime = "nodejs";

export async function GET() {
  try {
    const actor = await requireActor();
    requireAdmin(actor);
    const installed = await installations(actor.tenantId);
    return Response.json(
      registry.list().map(manifest => ({
        ...manifest,
        installation: installed.find(i => i.id === manifest.id) ?? null,
      })),
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return Response.json({ error: "Not authorized" }, { status: 403 });
  }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const actor = await requireActor();
    requireAdmin(actor);
    const body = await request.text();
    if (new TextEncoder().encode(body).length > 10000) {
      return Response.json({ error: "Payload too large" }, { status: 413 });
    }
    const input = z.object({
      id: z.string().max(64),
      enabled: z.boolean(),
      grants: z.array(permissionSchema).max(3),
    }).strict().parse(JSON.parse(body));
    const manifest = registry.get(input.id).manifest;
    if (input.grants.some(p => !manifest.permissions.includes(p))) {
      return Response.json({ error: "Invalid grant" }, { status: 422 });
    }
    if (input.enabled &&
        manifest.permissions.some(p => !input.grants.includes(p))) {
      return Response.json({ error: "Required grants missing" }, { status: 422 });
    }
    await saveInstallation({
      tenantId: actor.tenantId, actorId: actor.userId,
      id: manifest.id, version: manifest.version,
      enabled: input.enabled, grants: input.grants,
    });
    await audit({
      tenantId: actor.tenantId, actorId: actor.userId,
      extensionId: manifest.id, event: "configuration", status: "success",
    });
    return Response.json({ saved: true });
  } catch {
    return Response.json({ error: "Configuration not saved" }, { status: 400 });
  }
}

// Production: rate-limit writes; use a transaction for installation
// changes plus audit, and map typed auth/validation failures.
// Curated catalog only; never download arbitrary executable packages.
