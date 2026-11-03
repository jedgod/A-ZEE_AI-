import "server-only";
import { z } from "zod";
import { constraintsSchema } from "@/01_INTAKE/constraints/schema";
import { intentSchema } from "@/01_INTAKE/intent/schema";
import { modalitySchema } from "@/01_INTAKE/modality/schema";
import { prioritySchema } from "@/01_INTAKE/priority/schema";
import { taskTypeSchema } from "@/01_INTAKE/task_type/schema";
import { userQuerySchema } from "@/01_INTAKE/user_query/schema";
import { runTaskClassifier } from "@/04_ROUTING/task_classifier/module";
import { buildReasoningGuardrails } from "@/06_PROMPT_ENGINE/chain_of_thought_guardrails/module";
import { buildDeveloperPrompt } from "@/06_PROMPT_ENGINE/developer_prompt/module";
import { answerJsonSchema, answerSchema } from "@/06_PROMPT_ENGINE/structured_output_spec/module";
import { buildSystemPrompt } from "@/06_PROMPT_ENGINE/system_prompt/module";
import { buildUserPrompt } from "@/06_PROMPT_ENGINE/user_prompt/module";
import { runCalculator } from "@/07_TOOLS/calculator/module";
import { styleInstruction } from "@/09_GENERATION/style_control/module";
import { runPolicyCheck } from "@/10_VALIDATION/policy_check/module";
import { STRUCTURE_RUBRIC, structuralQuality } from "@/10_VALIDATION/quality_score/module";
import { runSchemaCheck } from "@/10_VALIDATION/schema_check/module";
import { citationsFor } from "@/11_POSTPROCESS/citations/module";
import { runCleanup } from "@/11_POSTPROCESS/cleanup/module";
import { runNormalizeFormat } from "@/11_POSTPROCESS/normalize_format/module";
import { sseTextChunks } from "@/12_DELIVERY/streaming_output/module";
import { ANSWER_STYLES, type AnswerStyle } from "@/lib/chat/contracts";
import { FEW_SHOT_REGISTRY, FEW_SHOT_VERSION } from "@/lib/pipeline/few-shot";
import { safetyCheck } from "@/lib/pipeline/preprocess";
import { configuredProviders, health, routingCandidates } from "@/lib/pipeline/registry";
import { enabledTools, MAX_STEPS } from "@/lib/pipeline/tools";
import { TRANSLATION_TARGETS } from "@/lib/pipeline/translate";
import { pool } from "./db";
import type { ConfigSource, DryRun } from "./pipeline-catalog";

// Server side of /admin/pipeline: real configuration, recent metadata, and dry runs for the
// deterministic modules. Dry runs call the same module functions the pipeline uses, make no AI
// or network call, and store nothing.

export type ViewBlock =
  | { heading: string; text: string }
  | { heading: string; json: unknown }
  | { heading: string; table: { head: string[]; rows: (string | number)[][] } };

export function configView(source: ConfigSource): ViewBlock[] {
  switch (source) {
    case "system_prompt": {
      const p = buildSystemPrompt();
      return [{ heading: `Policy system prompt · version ${p.version}`, text: p.message.content }];
    }
    case "developer_prompt":
      return (["engineering", "research"] as const).map(profile => ({ heading: `Profile: ${profile}`, text: buildDeveloperPrompt(profile).content }));
    case "guardrails":
      return [{ heading: "Added for AZ · Reasoning and Explore deeply", text: buildReasoningGuardrails().content }];
    case "few_shot":
      return [{ heading: `Reviewed examples · version ${FEW_SHOT_VERSION}`, json: FEW_SHOT_REGISTRY }];
    case "structured_spec":
      return [{ heading: "JSON schema for format: \"json\" answers", json: answerJsonSchema }];
    case "user_prompt":
      return [{ heading: "How a user turn is wrapped", text: buildUserPrompt({ text: "<the user's message>" }).content }];
    case "providers":
    case "routing": {
      const providers = configuredProviders();
      const candidates = routingCandidates(providers, "admin-view", "conversation");
      return [{
        heading: "Providers the router can use now (AZ_DISABLED_PROVIDERS excluded)",
        table: {
          head: ["Provider", "Model", "Status", "USD / M in·out", "p95 latency", "Samples"],
          rows: providers.map(p => {
            const c = candidates.find(x => x.id === p.id)!;
            return [p.label, p.providerModel, health.coolingDown(p.id) ? "cooling down" : "active",
              `${p.inputUsdPerMillion} · ${p.outputUsdPerMillion}`, c.p95LatencyMs ? `${Math.round(c.p95LatencyMs)} ms` : "—", c.latencySamples ?? 0];
          }),
        },
      }, { heading: "Limits", text: `Up to 3 providers per call · max request cost $${Number(process.env.AZ_MAX_REQUEST_USD) || 1} · latency target ${Number(process.env.AZ_LATENCY_TARGET_MS) || 20000} ms · dispatch deadline ${Number(process.env.AZ_DISPATCH_DEADLINE_MS) || 60000} ms` }];
    }
    case "tools": {
      const signedIn = { userId: "admin-view", tenantId: "admin-view", permissions: new Set(["tools:search", "tools:calculator"]) };
      const guest = { userId: "admin-view", tenantId: "admin-view", permissions: new Set(["tools:calculator"]) };
      return [{
        heading: `Tool-call loop · up to ${MAX_STEPS} steps · AZ_TOOL_LOOP=${process.env.AZ_TOOL_LOOP ?? "auto (arithmetic only)"}`,
        table: { head: ["Tool", "Signed-in users", "Guests"], rows: ["calculator", "search", "browser", "files", "external_apis", "code_execution"].map(name => [
          name,
          enabledTools(signedIn).some(t => t.name === name) ? "available" : "not registered / not configured",
          enabledTools(guest).some(t => t.name === name) ? "available" : "—",
        ]) },
      }];
    }
    case "styles":
      return [{ heading: "Composer tones → fixed instructions", table: { head: ["Tone", "Instruction"], rows: ANSWER_STYLES.map(s => [s, styleInstruction(s) ?? "(none: model default)"]) } }];
    case "quality_rubric": {
      const sample = structuralQuality("example answer text", { sourcesRetrieved: 1, citations: 1, unsupported: 0 });
      return [{ heading: `Rubric ${STRUCTURE_RUBRIC} (uncalibrated; visible structure, not accuracy)`, table: { head: ["Check", "Weight"], rows: sample.checks.map(c => [c.name, c.weight]) } },
        { heading: "Note", text: "Source checks apply only when 07 search retrieved sources; the score is scaled to 100 over the checks that apply." }];
    }
    case "moderation": {
      const remote = Boolean(process.env.OPENAI_API_KEY) && process.env.AZ_MODERATION !== "off";
      return [{ heading: "Checks on every message and answer", text: `Local phrase filter: on\nOpenAI moderation: ${remote ? "on" : "off (no OPENAI_API_KEY or AZ_MODERATION=off)"}\nOn a moderation outage the local filter still applies.` }];
    }
    case "translation":
      return [{ heading: "Allowed target languages", text: TRANSLATION_TARGETS.join(", ") }];
    case "stream_events":
      return [{ heading: "POST /api/chat/stream events", table: { head: ["Event", "Data", "When"], rows: [
        ["status", "{ stage }", "each pipeline stage"], ["tool", "{ name, status }", "07 tool calls"],
        ["delta", "{ text }", "after 10 validation passes"], ["final", "{ pipeline }", "last, with metadata"], ["error", "{ error, ... }", "instead of final"],
      ] } }];
    case "intake_schemas":
      return [];
  }
}

/** Recent metadata rows for one operations_records module (no prompt or answer text is stored there). */
export async function recordsView(module: string): Promise<ViewBlock[]> {
  const [count, rows] = await Promise.all([
    pool.query(`SELECT count(*)::int AS n FROM operations_records WHERE module = $1 AND created_at > now() - interval '7 days' AND expires_at > now()`, [module]),
    pool.query(`SELECT created_at, payload FROM operations_records WHERE module = $1 AND expires_at > now() ORDER BY created_at DESC LIMIT 10`, [module]),
  ]);
  return [
    { heading: `operations_records · ${module}`, text: `${count.rows[0].n} records in the last 7 days.` },
    { heading: "Latest 10 (metadata only)", table: { head: ["When", "Payload"], rows: rows.rows.map(r => [new Date(r.created_at).toISOString().replace("T", " ").slice(0, 19), JSON.stringify(r.payload).slice(0, 400)]) } },
  ];
}

const MAX_INPUT = 20_000;
const parseJson = (input: string) => JSON.parse(input) as unknown;
const localChecker = { check: async (text: string) => { const r = safetyCheck(text); return { decision: r.passed ? "allow" as const : "block" as const, reasons: r.reasons }; } };

/** Runs one deterministic module on admin-supplied input. Throws on invalid input. */
export async function dryRun(kind: DryRun, input: string): Promise<unknown> {
  z.string().min(1).max(MAX_INPUT).parse(input);
  switch (kind) {
    case "calculator": return runCalculator({ userId: "admin", tenantId: "admin", permissions: new Set(["tools:calculator"]) }, parseJson(input));
    case "task_classifier": return runTaskClassifier({ query: input, declaredTask: "qa" });
    case "user_prompt": return buildUserPrompt({ text: input });
    case "style_control": return { instruction: styleInstruction(z.enum(ANSWER_STYLES).parse(input.trim()) as AnswerStyle) };
    case "quality_score": return structuralQuality(input, { sourcesRetrieved: 0, citations: 0, unsupported: 0 });
    case "citations": {
      const { answer, sources } = z.object({
        answer: z.string().min(1).max(MAX_INPUT),
        sources: z.array(z.object({ sourceId: z.string().max(200), title: z.string().max(200).optional(), url: z.string().max(2048).optional() })).max(20),
      }).parse(parseJson(input));
      return citationsFor(answer, sources);
    }
    case "cleanup": return { text: runCleanup(input) };
    case "normalize_format": return runNormalizeFormat({ format: "text", text: input });
    case "policy_check": return runPolicyCheck(input, localChecker);
    case "schema_check": return runSchemaCheck(input, answerSchema);
    case "streaming_output": return { chunks: sseTextChunks(input, 32) };
    case "user_query": return userQuerySchema.parse(parseJson(input));
    case "intent": return intentSchema.parse(parseJson(input));
    case "task_type": return taskTypeSchema.parse(parseJson(input));
    case "modality": return modalitySchema.parse(parseJson(input));
    case "priority": return prioritySchema.parse(parseJson(input));
    case "constraints": return constraintsSchema.parse(parseJson(input));
  }
}
