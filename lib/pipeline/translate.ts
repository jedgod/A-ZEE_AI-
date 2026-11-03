import "server-only";
import { randomUUID } from "node:crypto";
import { preflight } from "@/00_META";
import { DispatchError } from "@/04_ROUTING/fallback_policy/module";
import { runPolicyCheck } from "@/10_VALIDATION/policy_check/module";
import { runCleanup } from "@/11_POSTPROCESS/cleanup/module";
import { runTranslation, type Translator } from "@/11_POSTPROCESS/translation/module";
import { runMetrics } from "@/14_OBSERVABILITY/metrics/module";
import { ProviderError } from "@/lib/chat/provider";
import { accessFor, reserveUsage, type Reservation } from "@/lib/plans";
import type { RequestActor } from "./actor";
import { NotPermittedError, OutputBlockedError } from "./index";
import { OperationsLog } from "./operations";
import { LANGUAGE_NAMES, PiiVault } from "./preprocess";
import { configuredProviders, metaRegistry } from "./registry";
import { createRouter } from "./router";
import { moderationChecker } from "./validation";

export const TRANSLATION_TARGETS = ["en", "es", "fr", "de", "ja"] as const; // 11_POSTPROCESS/translation's allowlist
export type TranslationTarget = (typeof TRANSLATION_TARGETS)[number];

/**
 * 11_POSTPROCESS translation of an answer, routed like chat (00 preflight, plan limits, 04/05
 * routing). Personal data is masked before it leaves the server and restored afterwards; the
 * translation is re-validated by 10 policy check, as the translation module requires.
 */
export async function translateAnswer(text: string, target: TranslationTarget, actor: RequestActor, fetchImpl: typeof fetch = fetch) {
  const requestId = randomUUID();
  const ops = new OperationsLog(actor.auth, requestId);
  let reservation: Reservation | null = null;
  try {
    const providers = configuredProviders();
    if (!providers.length) throw new ProviderError("AI_PROVIDER_NOT_CONFIGURED", 503);
    const vault = new PiiVault();
    const masked = vault.redact(text);
    const inputTokens = Math.max(1, Math.ceil(masked.length / 4));
    const decision = preflight({
      actor: actor.meta,
      request: { capability: "conversation", classification: "public", requestedOutputTokens: 2000, inputTokens, attachmentBytes: 0, production: process.env.NODE_ENV === "production" },
      policyContext: { externalProvider: true, protectedOperation: false, reviewerId: null, approvalValid: false },
      registry: metaRegistry(providers),
      options: { maxEstimatedUsd: Number(process.env.AZ_MAX_REQUEST_USD) || 1 },
    });
    if (!decision.allowed) throw new NotPermittedError(decision.reasons);
    if (actor.channel === "web" && process.env.DATABASE_URL) reservation = await reserveUsage(await accessFor(actor), ["messages", "translation"]);

    const router = createRouter({ providers, primary: decision.model.id, actor, requestId, ops, inputTokens });
    const translator: Translator = {
      async translate({ text: source, targetLanguage }) {
        const result = await router.model({
          system: `Translate the user's message into ${LANGUAGE_NAMES[targetLanguage]}. Keep the Markdown structure, code blocks, URLs, and placeholders like [EMAIL_1] exactly as they are. Return only the translation.`,
          history: [], maxOutputTokens: 4000,
        }).run({ prompt: source, modelId: "routed" });
        return result.text;
      },
    };
    let translated;
    try {
      translated = await runTranslation({ text: masked, targetLanguage: target }, translator);
    } catch (error) {
      if (error instanceof DispatchError || (error as Error)?.name === "TimeoutError") throw new ProviderError("AI_PROVIDER_UNAVAILABLE", 502);
      throw error;
    }
    // requiresRevalidation: the translation is new text, so it gets the 10 policy check again.
    const check = await runPolicyCheck(translated.text.slice(0, 50000), moderationChecker(fetchImpl));
    if (check.decision !== "allow") throw new OutputBlockedError(check.reasons);

    ops.add("request", { mode: "translate", model: "auto", capability: "conversation", provider: router.answeredBy?.id, attempts: router.attempts, target }, 90);
    await runMetrics({ name: "request_count", value: 1, outcome: "success" }, ops.metricSink);
    return { text: vault.restore(runCleanup(translated.text)), language: translated.language, provider: router.answeredBy?.label ?? null };
  } catch (error) {
    await reservation?.refund();
    await runMetrics({ name: "request_count", value: 1, outcome: "failure" }, ops.metricSink).catch(() => {});
    throw error;
  } finally {
    await ops.flush();
  }
}
