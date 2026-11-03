import { endpoint, json, pool } from "@/lib/admin/core";
import { requireHostActor } from "@/lib/admin/host-auth";

export const runtime = "nodejs";

export const GET = () =>
  endpoint(async () => {
    await requireHostActor();
    await pool.query("SELECT 1");
    return json({
      ok: true,
      service: "15_ADMIN",
      database: "postgresql",
      mode: process.env.NODE_ENV ?? "development",
    });
  });
