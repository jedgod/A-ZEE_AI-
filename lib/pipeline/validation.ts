import "server-only";
import type { PolicyChecker } from "@/10_VALIDATION/policy_check/module";
import { safetyCheck } from "./preprocess";

/**
 * The PolicyChecker for 10_VALIDATION/policy_check, also used on input (02).
 * Always applies the local phrase filter (02 safety_filter). When OPENAI_API_KEY is set it also
 * asks OpenAI's moderation endpoint (free; works without paid credits). If moderation is
 * unreachable the local decision stands, so an outage degrades to the local filter instead of
 * blocking every request; the result records that in `reasons`.
 */
export function moderationChecker(fetchImpl: typeof fetch = fetch): PolicyChecker {
  return {
    async check(text) {
      const local = safetyCheck(text);
      if (!local.passed) return { decision: "block", reasons: local.reasons };
      const key = process.env.OPENAI_API_KEY;
      if (!key || process.env.AZ_MODERATION === "off") return { decision: "allow", reasons: [] };
      try {
        const response = await fetchImpl("https://api.openai.com/v1/moderations", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "omni-moderation-latest", input: text.slice(0, 32000) }),
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) return { decision: "allow", reasons: ["moderation_unavailable"] };
        const result = (await response.json())?.results?.[0];
        if (typeof result?.flagged !== "boolean") return { decision: "allow", reasons: ["moderation_unavailable"] };
        if (!result.flagged) return { decision: "allow", reasons: [] };
        const categories = Object.entries(result.categories ?? {}).filter(([, v]) => v === true).map(([k]) => k);
        return { decision: "block", reasons: categories.length ? categories.map(c => `moderation:${c}`) : ["moderation:flagged"] };
      } catch {
        return { decision: "allow", reasons: ["moderation_unavailable"] };
      }
    },
  };
}
