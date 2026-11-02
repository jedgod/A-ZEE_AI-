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
        await rateLimit({ ...actor, id: actor.userId, tenantId: actor.tenantId } as any, false);
        const search = new URL(request.url).searchParams;
        const limit = z.coerce.number().int().min(1).max(100).parse(search.get("limit") ?? 25);
        const offset = z.coerce.number().int().min(0).max(10000).parse(search.get("offset") ?? 0);
        const items = await service.list(
          { id: actor.userId, tenantId: actor.tenantId, role: actor.role, platformAdmin: actor.platform },
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
        await rateLimit({ ...actor, id: actor.userId, tenantId: actor.tenantId } as any, true);
        const created = await service.create(
          { id: actor.userId, tenantId: actor.tenantId, role: actor.role, platformAdmin: actor.platform },
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
        await rateLimit({ ...actor, id: actor.userId, tenantId: actor.tenantId } as any, false);
        const id = idSchema.parse((await context.params).id);
        return json(await service.get(
          { id: actor.userId, tenantId: actor.tenantId, role: actor.role, platformAdmin: actor.platform },
          id
        ));
      }),

    PATCH: (request: Request, context: Context) =>
      endpoint(async () => {
        sameOrigin(request);
        const actor = await requireHostActor();
        await rateLimit({ ...actor, id: actor.userId, tenantId: actor.tenantId } as any, true);
        const id = idSchema.parse((await context.params).id);
        const input = z.object({ revision, payload: z.unknown() }).strict().parse(await body(request));
        return json(await service.mutate(
          { id: actor.userId, tenantId: actor.tenantId, role: actor.role, platformAdmin: actor.platform },
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
        await rateLimit({ ...actor, id: actor.userId, tenantId: actor.tenantId } as any, true);
        const id = idSchema.parse((await context.params).id);
        const expected = z.coerce.number().int().positive().parse(
          new URL(request.url).searchParams.get("revision")
        );
        await service.mutate(
          { id: actor.userId, tenantId: actor.tenantId, role: actor.role, platformAdmin: actor.platform },
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
        await rateLimit({ ...actor, id: actor.userId, tenantId: actor.tenantId } as any, true);
        const id = idSchema.parse((await context.params).id);
        const input = z.object({
          revision,
          decision: z.enum(["approved", "rejected"]),
        }).strict().parse(await body(request));
        return json(await decide(
          { id: actor.userId, tenantId: actor.tenantId, role: actor.role, platformAdmin: actor.platform },
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
        await rateLimit({ ...actor, id: actor.userId, tenantId: actor.tenantId } as any, false);
        return json({
          tenantId: actor.tenantId,
          role: actor.role,
          platform: actor.platform,
        });
      }),
  };
}

export function createPlatformTenantsRoute() {
  return {
    GET: (_request: Request) =>
      endpoint(async () => {
        const actor = await requireHostActor();
        requirePlatformAdmin(actor);
        await rateLimit({ ...actor, id: actor.userId, tenantId: actor.tenantId } as any, false);
        return json({ ok: true, module: "platform-tenants" });
      }),

    POST: (request: Request) =>
      endpoint(async () => {
        sameOrigin(request);
        const actor = await requireHostActor();
        requirePlatformAdmin(actor);
        await rateLimit({ ...actor, id: actor.userId, tenantId: actor.tenantId } as any, true);
        const input = z.object({
          name: z.string().min(1).max(150),
          ownerUserId: z.string().uuid(),
        }).strict().parse(await body(request));
        return json({ ok: true, created: input.name }, 201);
      }),
  };
}

export function createPlatformTenantItemRoute() {
  return {
    GET: (_request: Request, context: Context) =>
      endpoint(async () => {
        const actor = await requireHostActor();
        requirePlatformAdmin(actor);
        await rateLimit({ ...actor, id: actor.userId, tenantId: actor.tenantId } as any, false);
        return json({ ok: true, id: (await context.params).id });
      }),

    PATCH: (request: Request, context: Context) =>
      endpoint(async () => {
        sameOrigin(request);
        const actor = await requireHostActor();
        requirePlatformAdmin(actor);
        await rateLimit({ ...actor, id: actor.userId, tenantId: actor.tenantId } as any, true);
        const id = idSchema.parse((await context.params).id);
        const bodyJson = z.object({
          revision,
          name: z.string().min(1).max(150),
          active: z.boolean(),
        }).strict().parse(await body(request));
        return json({ id, ...bodyJson });
      }),

    DELETE: (request: Request, context: Context) =>
      endpoint(async () => {
        sameOrigin(request);
        const actor = await requireHostActor();
        requirePlatformAdmin(actor);
        await rateLimit({ ...actor, id: actor.userId, tenantId: actor.tenantId } as any, true);
        return new Response(null, { status: 204 });
      }),
  };
}
