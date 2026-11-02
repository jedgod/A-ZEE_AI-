// ============================================================
// 01_INTAKE / MODALITY / SERVER ROUTE
// File: app/api/intake/modality/route.ts
// Host application must implement auth and repository helpers.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { modalitySchema } from "@/lib/intake/modality";
import { requireUser, requireSameOrigin, rateLimit } from "@/lib/security";
import { saveIntakeModule } from "@/lib/db/intake";

export async function POST(request: NextRequest) {
  try {
    // These helpers must reject unauthorized requests.
    await requireSameOrigin(request);
    const user = await requireUser(request);
    await rateLimit(user.id, "intake-write");

    // Also enforce byte limits at the reverse proxy.
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 250000) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }

    let body: unknown;
    try { body = JSON.parse(raw); }
    catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = modalitySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid intake input", issues: parsed.error.issues },
        { status: 422 }
      );
    }

    // REQUIRED: verify each attachment belongs to this user,
    // is scanned, has an allowed MIME type, and fits byte limits.
    // Reject unverified files before saving or invoking models.

    const record = await saveIntakeModule({
      userId: user.id,
      module: "modality",
      payload: parsed.data,
    });

    return NextResponse.json({ id: record.id }, { status: 201 });
  } catch {
    // Map typed authentication/rate-limit failures to 401/403/429
    // in your security helpers or application error middleware.
    return NextResponse.json(
      { error: "Request could not be completed" }, { status: 500 }
    );
  }
}

// Repository contract:
// saveIntakeModule({ userId, module, payload }) -> { id: string }
// Generate IDs server-side; use bound SQL parameters.
// Link records to an authorized intake request when assembling
// all six modules into a single pipeline request.
