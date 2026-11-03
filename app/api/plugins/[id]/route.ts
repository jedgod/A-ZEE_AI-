import { z } from "zod";
import { isFeaturePlugin, isSkill, updateConnector, updateFeature, updateSkill } from "@/lib/plugins/service";
import { connectorRoute, NO_STORE } from "@/lib/connectors/route";
import { requireSameOrigin } from "@/15_EXTENSIONS/permissions";
import { ConnectorError } from "@/lib/connectors/types";
import { body } from "@/lib/sidebar-route";

export const runtime = "nodejs";

const patch = z.object({
  enabled: z.boolean().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
}).strict().refine(v => v.enabled !== undefined || v.settings !== undefined, "Nothing to change");

/** PATCH /api/plugins/:id { enabled?, settings? }: toggle a plugin or change its settings. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const input = patch.safeParse(await body(request, 8_000).catch(() => null));
  if (!input.success) return Response.json({ error: "INVALID_INPUT" }, { status: 422, headers: NO_STORE });
  return connectorRoute(request, true, async owner => {
    if (isSkill(id)) {
      // Staff-governed: the staff session decides, not the local account.
      try { requireSameOrigin(request); } catch { throw new ConnectorError(403, "INVALID_ORIGIN"); }
      if (input.data.settings) throw new ConnectorError(422, "NO_SETTINGS");
      await updateSkill(id, input.data.enabled ?? true);
    } else if (isFeaturePlugin(id)) {
      if (input.data.settings) throw new ConnectorError(422, "NO_SETTINGS");
      await updateFeature(owner, id, input.data.enabled ?? true);
    } else {
      await updateConnector(owner, id, input.data);
    }
    return Response.json({ data: { saved: true } }, { headers: NO_STORE });
  });
}
