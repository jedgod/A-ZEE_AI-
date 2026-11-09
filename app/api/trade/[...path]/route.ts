import { forward } from "@/lib/aztrade/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

/** GET/POST /api/trade/<allow-listed path>: see lib/aztrade/proxy.ts. */
export async function GET(request: Request, { params }: Ctx) { return forward(request, (await params).path); }
export async function POST(request: Request, { params }: Ctx) { return forward(request, (await params).path); }
