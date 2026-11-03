import { z } from "zod";
import { readJson } from "@/lib/http";
import { ProviderError } from "@/lib/chat/provider";
import { InputBlockedError, NotPermittedError, OutputBlockedError } from "@/lib/pipeline";
import { webActor } from "@/lib/pipeline/actor";
import { TRANSLATION_TARGETS, translateAnswer } from "@/lib/pipeline/translate";
import { PlanLimitError, UpgradeRequiredError } from "@/lib/plans";
import { errorResponse, NO_STORE, requireSameOrigin } from "@/lib/staff/route";

export const runtime = "nodejs";

const body = z.object({ text: z.string().min(1).max(20000), targetLanguage: z.enum(TRANSLATION_TARGETS) }).strict();

/** Translate an answer (11_POSTPROCESS/translation). */
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const input = body.parse(await readJson(request, 100_000));
    const { actor } = webActor(request);
    return Response.json({ data: await translateAnswer(input.text, input.targetLanguage, actor) }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof UpgradeRequiredError) return Response.json({ error: "UPGRADE_REQUIRED", feature: error.feature, plan: error.planName }, { status: 403, headers: NO_STORE });
    if (error instanceof PlanLimitError) return Response.json({ error: "PLAN_LIMIT_REACHED", feature: error.feature, limit: error.limit, plan: error.planName }, { status: 429, headers: NO_STORE });
    if (error instanceof InputBlockedError || error instanceof OutputBlockedError) return Response.json({ error: "OUTPUT_BLOCKED" }, { status: 422, headers: NO_STORE });
    if (error instanceof NotPermittedError) return Response.json({ error: "NOT_PERMITTED", reasons: error.reasons }, { status: 403, headers: NO_STORE });
    if (error instanceof ProviderError) return Response.json({ error: error.code }, { status: error.status, headers: NO_STORE });
    return errorResponse(error);
  }
}
