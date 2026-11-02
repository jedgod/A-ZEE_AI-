import { endpoint, json } from "@/lib/admin/core";

export const runtime = "nodejs";

export const GET = () =>
  endpoint(async () => {
    return json({
      ok: true,
      service: "15_ADMIN",
      mode: process.env.NODE_ENV ?? "development",
    });
  });
