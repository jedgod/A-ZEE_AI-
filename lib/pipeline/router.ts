import "server-only";
import { DispatchError, runFallbackPolicy } from "@/04_ROUTING/fallback_policy/module";
import type { ChatTurn, Model } from "@/05_MODEL_LAYER/contracts";
import { runModelPerformance } from "@/14_OBSERVABILITY/model_performance/module";
import type { ModelAdapter } from "@/lib/reliability/contracts";
import type { RequestActor } from "./actor";
import type { OperationsLog } from "./operations";
import { health, type Provider } from "./registry";

const tokensOf = (chars: number) => Math.max(1, Math.ceil(chars / 4));

/** Models often wrap JSON in ``` fences; the reliability contract expects bare JSON. */
export function stripJsonFences(text: string): string {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/i.exec(text);
  return (fenced ? fenced[1] : text).trim();
}

/**
 * 04_ROUTING + 05_MODEL_LAYER for one request: a health-aware provider order and Models that
 * dispatch through the 04 fallback policy across the 05 branches, recording 14 model performance.
 * `reliability()` exposes the same routing as the ModelAdapter that 08/09/10 modules expect.
 */
const combine = (...signals: (AbortSignal | undefined)[]) => {
  const present = signals.filter((s): s is AbortSignal => !!s);
  return present.length > 1 ? AbortSignal.any(present) : present[0];
};

export function createRouter(ctx: {
  providers: Provider[];
  primary: string;          // 00_META preflight's selected model
  fastest?: string;         // 04 latency optimizer's pick, when telemetry allows
  actor: RequestActor;
  requestId: string;
  ops: OperationsLog;
  inputTokens: number;
  signal?: AbortSignal;     // client disconnect / Stop: cancels in-flight provider calls
}) {
  const allowedModels = new Set(ctx.providers.map(p => p.id));
  let attempts = 0;
  let answeredBy: Provider | undefined;

  const order = (preferred: string[]) => {
    const ids = [...new Set([...preferred, ctx.primary, ...(ctx.fastest ? [ctx.fastest] : []), ...ctx.providers.map(p => p.id)])]
      .filter(id => ctx.providers.some(p => p.id === id));
    return [...ids.filter(id => !health.coolingDown(id)), ...ids.filter(id => health.coolingDown(id))].map(id => ({ id }));
  };

  const model = (opts: { system: string; history?: ChatTurn[]; maxOutputTokens: number; preferred?: string[] }): Model => ({
    async run(request) {
      const outcome = await runFallbackPolicy(order(opts.preferred ?? []), async (target, signal) => {
        const provider = ctx.providers.find(p => p.id === target.id)!;
        const t0 = performance.now();
        attempts++;
        try {
          const result = await provider.adapter.run({
            prompt: request.prompt, modelId: provider.providerModel, signal, system: opts.system,
            messages: [...(opts.history ?? []), { role: "user", content: request.prompt }], maxOutputTokens: opts.maxOutputTokens,
          });
          const ms = performance.now() - t0;
          health.success(provider.id, ms);
          await runModelPerformance(ctx.actor.auth, { requestId: ctx.requestId, modelId: provider.id, durationMs: ms, inputTokens: ctx.inputTokens, outputTokens: tokensOf(result.text.length), outcome: "success" }, allowedModels, ctx.ops.repository);
          answeredBy = provider;
          return result;
        } catch (error) {
          const ms = performance.now() - t0;
          health.failure(provider.id);
          await runModelPerformance(ctx.actor.auth, { requestId: ctx.requestId, modelId: provider.id, durationMs: ms, inputTokens: ctx.inputTokens, outputTokens: 0, outcome: "failure" }, allowedModels, ctx.ops.repository);
          console.warn(`AI provider ${provider.label} failed: ${(error as Error).message?.slice(0, 200)}`);
          if (signal.aborted) throw error;
          // A failing provider (quota, bad key, outage) is treated as unavailable; try the next one.
          throw new DispatchError("transient", `${provider.id} unavailable`);
        }
      }, combine(request.signal, ctx.signal), Number(process.env.AZ_DISPATCH_DEADLINE_MS) || 60_000);
      return outcome.value;
    },
  });

  /** lib/reliability ModelAdapter: instructions become the system prompt, data the user turn. */
  const reliability = (): ModelAdapter => ({
    async generate({ instructions, data, maxOutputTokens, signal }) {
      const result = await model({ system: instructions, history: [], maxOutputTokens: Math.min(maxOutputTokens, 2048) })
        .run({ prompt: JSON.stringify(data), modelId: "routed", signal });
      return stripJsonFences(result.text);
    },
  });

  return {
    model,
    reliability,
    get attempts() { return attempts; },
    get answeredBy() { return answeredBy; },
  };
}
