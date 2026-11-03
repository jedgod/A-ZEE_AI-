import { GET as tenantList, POST as tenantCreate } from "@/app/api/admin/tenants/route";
import { GET as tenantGet, PATCH as tenantUpdate, DELETE as tenantDelete } from "@/app/api/admin/tenants/[id]/route";
import "server-only";
import { z } from "zod";
import { endpoint, json, body, sameOrigin, rateLimit } from "./core";
import { requireHostActor, requirePlatformAdmin } from "./host-auth";
import { moduleSchema, idSchema, revision, type Module } from "./schemas";
import { Service, decide } from "./service";

type Context = { params: Promise<{ module: string; id?: string }> };

export function createCollectionRoute(module: Module) {
  const service = new Service(module);

  return {
    GET: (request: Request) =>
      endpoint(async () => {
        const actor = await requireHostActor();
        await rateLimit({ userId: actor.userId, tenantId: actor.tenantId, role: actor.role, platformAdmin: actor.platform }, false);
        const search = new URL(request.url).searchParams;
        const limit = z.coerce.number().int().min(1).max(100).parse(search.get("limit") ?? 25);
        const offset = z.coerce.number().int().min(0).max(10000).parse(search.get("offset") ?? 0);
        const items = await service.list(
          { userId: actor.userId, tenantId: actor.tenantId, role: actor.role, platformAdmin: actor.platform },
          limit,
          offset
        );
        return json({ items, limit, offset });
      }),

    POST: (request: Request) =>
      endpoint(async () => {
        sameOrigin(request);
        const actor = await requireHostActor();
        const payload = await body(request);
        await rateLimit({ userId: actor.userId, tenantId: actor.tenantId, role: actor.role, platformAdmin: actor.platform }, true);
        const created = await service.create(
          { userId: actor.userId, tenantId: actor.tenantId, role: actor.role, platformAdmin: actor.platform },
          payload
        );
        return json(created, 201);
      }),
  };
}

export function createItemRoute(module: Module) {
  const service = new Service(module);

  return {
    GET: (_request: Request, context: Context) =>
      endpoint(async () => {
        const actor = await requireHostActor();
        await rateLimit({ userId: actor.userId, tenantId: actor.tenantId, role: actor.role, platformAdmin: actor.platform }, false);
        const id = idSchema.parse((await context.params).id);
        return json(await service.get(
          { userId: actor.userId, tenantId: actor.tenantId, role: actor.role, platformAdmin: actor.platform },
          id
        ));
      }),

    PATCH: (request: Request, context: Context) =>
      endpoint(async () => {
        sameOrigin(request);
        const actor = await requireHostActor();
        await rateLimit({ userId: actor.userId, tenantId: actor.tenantId, role: actor.role, platformAdmin: actor.platform }, true);
        const id = idSchema.parse((await context.params).id);
        const input = z.object({ revision, payload: z.unknown() }).strict().parse(await body(request));
        return json(await service.mutate(
          { userId: actor.userId, tenantId: actor.tenantId, role: actor.role, platformAdmin: actor.platform },
          id,
          input.revision,
          input.payload,
          false
        ));
      }),

    DELETE: (request: Request, context: Context) =>
      endpoint(async () => {
        sameOrigin(request);
        const actor = await requireHostActor();
        await rateLimit({ userId: actor.userId, tenantId: actor.tenantId, role: actor.role, platformAdmin: actor.platform }, true);
        const id = idSchema.parse((await context.params).id);
        const expected = z.coerce.number().int().positive().parse(
          new URL(request.url).searchParams.get("revision")
        );
        await service.mutate(
          { userId: actor.userId, tenantId: actor.tenantId, role: actor.role, platformAdmin: actor.platform },
          id,
          expected,
          null,
          true
        );
        return new Response(null, { status: 204 });
      }),
  };
}

export function createApprovalDecisionRoute() {
  return {
    POST: (request: Request, context: { params: Promise<{ id: string }> }) =>
      endpoint(async () => {
        sameOrigin(request);
        const actor = await requireHostActor();
        await rateLimit({ userId: actor.userId, tenantId: actor.tenantId, role: actor.role, platformAdmin: actor.platform }, true);
        const id = idSchema.parse((await context.params).id);
        const input = z.object({
          revision,
          decision: z.enum(["approved", "rejected"]),
        }).strict().parse(await body(request));
        return json(await decide(
          { userId: actor.userId, tenantId: actor.tenantId, role: actor.role, platformAdmin: actor.platform },
          id,
          input.revision,
          input.decision
        ));
      }),
  };
}

export function createDashboardRoute() {
  return {
    GET: (_request: Request) =>
      endpoint(async () => {
        const actor = await requireHostActor();
        await rateLimit({ userId: actor.userId, tenantId: actor.tenantId, role: actor.role, platformAdmin: actor.platform }, false);
        return json({
          tenantId: actor.tenantId,
          role: actor.role,
          platform: actor.platform,
        });
      }),
  };
}

export function createPlatformTenantsRoute() {
  return { GET: tenantList, POST: tenantCreate };
}
export function createPlatformTenantItemRoute() {
  return { GET: tenantGet, PATCH: tenantUpdate, DELETE: tenantDelete };
}
