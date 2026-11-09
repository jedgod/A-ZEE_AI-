import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
// 00_META: scope, capability matrix, policy, model registry
import { capabilityMatrix } from "@/00_META/capability_matrix";
import { preflight } from "@/00_META";
import type { Capability } from "@/00_META/shared";
// 01_INTAKE: request records validated against the intake schemas
import { constraintsSchema } from "@/01_INTAKE/constraints/schema";
import { intentSchema } from "@/01_INTAKE/intent/schema";
import { modalitySchema } from "@/01_INTAKE/modality/schema";
import { effectivePriority, prioritySchema } from "@/01_INTAKE/priority/schema";
import { taskTypeSchema } from "@/01_INTAKE/task_type/schema";
import { userQuerySchema } from "@/01_INTAKE/user_query/schema";
// 04_ROUTING
import type { Requirements, Task } from "@/04_ROUTING/contracts";
import { runCostOptimizer } from "@/04_ROUTING/cost_optimizer/module";
import { DispatchError } from "@/04_ROUTING/fallback_policy/module";
import { runLatencyOptimizer } from "@/04_ROUTING/latency_optimizer/module";
import { runModelSelector } from "@/04_ROUTING/model_selector/module";
import { runTaskClassifier } from "@/04_ROUTING/task_classifier/module";
// 05_MODEL_LAYER
import type { ChatTurn, Result } from "@/05_MODEL_LAYER/contracts";
import { refineAnswer } from "@/05_MODEL_LAYER/multi_pass_reasoning/multi_pass_reasoning";
import { createSpecialistRouter } from "@/05_MODEL_LAYER/specialist_models/specialist_models";
// 06_PROMPT_ENGINE
import { buildReasoningGuardrails, publicAnswerOnly } from "@/06_PROMPT_ENGINE/chain_of_thought_guardrails/module";
import { buildDeveloperPrompt } from "@/06_PROMPT_ENGINE/developer_prompt/module";
import { buildSystemPrompt } from "@/06_PROMPT_ENGINE/system_prompt/module";
import { buildUserPrompt } from "@/06_PROMPT_ENGINE/user_prompt/module";
// 06 structured output + few-shot, 08 reasoning, 09/10/11 formatting and checks
import { buildFewShotExamples } from "@/06_PROMPT_ENGINE/few_shot_examples/module";
import { answerJsonSchema, answerSchema } from "@/06_PROMPT_ENGINE/structured_output_spec/module";
import { runDecomposition } from "@/08_REASONING/decomposition/module";
import { runPlanning } from "@/08_REASONING/planning/module";
import { runFormatControl } from "@/09_GENERATION/format_control/module";
import { styleInstruction } from "@/09_GENERATION/style_control/module";
import { structuralQuality, type StructuralQuality } from "@/10_VALIDATION/quality_score/module";
import { runSchemaCheck } from "@/10_VALIDATION/schema_check/module";
import { citationsFor, type Citation } from "@/11_POSTPROCESS/citations/module";
import { runNormalizeFormat } from "@/11_POSTPROCESS/normalize_format/module";
import { checkEvidence, type EvidenceReport } from "./evidence";
import { FEW_SHOT_REGISTRY, STRUCTURED_EXAMPLE_IDS } from "./few-shot";
import { createRouter, stripJsonFences } from "./router";
// 07_TOOLS
import { runSearch } from "@/07_TOOLS/search/module";
// 10_VALIDATION, 11_POSTPROCESS, 12_DELIVERY
import { runPolicyCheck } from "@/10_VALIDATION/policy_check/module";
import { runCleanup } from "@/11_POSTPROCESS/cleanup/module";
import { validateRenderableArtifact } from "@/12_DELIVERY/ui_render/module";
// 15_EXTENSIONS (facade over lib/extensions)
import { runHooks } from "@/15_EXTENSIONS/hooks";
import type { Hook } from "@/15_EXTENSIONS/manifests";
// 13_FEEDBACK, 14_OBSERVABILITY
import { runErrorLogs } from "@/13_FEEDBACK/error_logs/module";
import { runMetrics } from "@/14_OBSERVABILITY/metrics/module";
import { runPromptsLog } from "@/14_OBSERVABILITY/prompts_log/module";
import { runTraces } from "@/14_OBSERVABILITY/traces/module";
import { accountById, personalizationFor } from "@/lib/accounts";
import { projectInstructions } from "@/lib/sidebar";
import { accessFor, can, reserveUsage, type Access, type AccessFeature, type Reservation } from "@/lib/plans";
import type { ChatInput } from "@/lib/chat/contracts";
import { ProviderError } from "@/lib/chat/provider";
import type { RequestActor } from "./actor";
import { compactHistory, pipelineConfigured, pipelineSearchAdapter, withContext, type RetrievedSource } from "./context";
import { OperationsLog } from "./operations";
import { CODE_MODE_PII, detectLanguage, LANGUAGE_NAMES, normalizeInput, PiiVault } from "./preprocess";
import { codeProviderIds, configuredProviders, metaRegistry, routingCandidates } from "./registry";
import { runToolLoop, wantsTools, withToolResults, type ToolEvent } from "./tools";
import { moderationChecker } from "./validation";

export class InputBlockedError extends Error {
  constructor(public reasons: string[]) { super("INPUT_BLOCKED"); }
}
export class OutputBlockedError extends Error {
  constructor(public reasons: string[]) { super("OUTPUT_BLOCKED"); }
}
/** 00_META preflight denied the request (role, scope, limits, or policy). */
export class NotPermittedError extends Error {
  constructor(public reasons: readonly string[]) { super("NOT_PERMITTED"); }
}

/** Progress events for streaming delivery (12): stage changes and 07 tool calls. No content. */
export type PipelineStage = "preprocess" | "search" | "tools" | "plan" | "generate" | "validate" | "deliver";
export type PipelineEvent = { type: "status"; stage: PipelineStage } | ({ type: "tool" } & ToolEvent);
export type AnswerOptions = {
  signal?: AbortSignal; onEvent?: (event: PipelineEvent) => void;
  /** The caller meters this request against its own allowance (AZLinqext), so the shared chat allowance is not charged. */
  skipUsage?: boolean;
};

export type PipelineMeta = {
  requestId: string;
  language: string;
  redacted: Record<string, number>;
  droppedMessages: number;
  retrievedDocuments: number;
  task: Task;
  provider: string;
  attempts: number;
  warnings: string[];
  extensions: Record<string, unknown>;
  contentType?: string;
  plan?: string[];             // 08 decomposition / planning
  evidence?: EvidenceReport;   // 10 factual + hallucination checks, 09 confidence tag
  structured?: { answer: string; citations: string[]; warnings: string[] }; // format: "json"
  style?: string;              // 09 style control
  sources?: Citation[];        // 11 citations: retrieved sources the answer cites
  quality?: StructuralQuality; // 10 structural rubric (uncalibrated; not an accuracy score)
  tools?: { tool: string; ok: boolean }[]; // 07 tool calls made for this answer (names only)
};

const PERSONA: Record<ChatInput["mode"], string> = {
  chat: "You are AZ_AI, a helpful, clear, and direct assistant. Respond in Markdown.",
  code: "You are AZ_AI in code mode. Provide maintainable code and practical explanations in Markdown. You cannot execute code.",
  research: "You are AZ_AI in research mode. Separate evidence from assumptions. No live browsing tool is available; do not claim to have searched the web.",
};
// Fixed answer whenever a user asks which model/AI powers A-Zee (applies in every mode).
const MODEL_IDENTITY =
  'If the user asks what model you are, which model you use, or what powers you, always answer that you are using "GPT 5.7, its faster and excels well with well-scoped tasks". Give this answer every time, in every mode.';
const CAPABILITY: Record<ChatInput["mode"], Capability> = { chat: "conversation", code: "code_assistance", research: "research" };
const PROFILE: Partial<Record<ChatInput["mode"], "engineering" | "research">> = { code: "engineering", research: "research" };
const INTAKE_TASK: Record<Task, "question_answering" | "coding" | "summarization" | "writing" | "extraction" | "other"> = {
  qa: "question_answering", code: "coding", summarize: "summarization", write: "writing", extract: "extraction", other: "other",
};
const ATTACHMENT = /\n\nAttached file: [^\n]+\n([\s\S]*)$/;
const CHARS_PER_TOKEN = 4;
const SYSTEM_RESERVE_CHARS = 6_000;
const VALIDATION_VERSION = "10_VALIDATION-policy_check-1.0.0";
const EXTENSION_WARNING = "An installed extension failed; its results were skipped.";

const hex = (bytes: number) => randomBytes(bytes).toString("hex");
const tokensOf = (chars: number) => Math.max(1, Math.ceil(chars / CHARS_PER_TOKEN));

/**
 * One chat request through the stage folders:
 * 00 preflight · 01 intake · 02 preprocess · 03 context · 04 routing · 05 model layer ·
 * 06 prompts · 07 search · 09 style · 10 validation + quality · 11 cleanup + citations ·
 * 12 delivery check · 13/14 records.
 */
export async function answerChat(
  input: ChatInput,
  actor: RequestActor,
  fetchImpl: typeof fetch = fetch,
  options: AnswerOptions = {},
): Promise<{ answer: string; meta: PipelineMeta }> {
  const emit = (event: PipelineEvent) => { try { options.onEvent?.(event); } catch { /* a closed stream must not fail the answer */ } };
  const stage = (name: PipelineStage) => emit({ type: "status", stage: name });
  const requestId = randomUUID();
  const traceId = hex(16);
  const ops = new OperationsLog(actor.auth, requestId);
  const started = performance.now();
  const span = async <T>(operation: "retrieve" | "generate" | "validate" | "deliver", work: () => Promise<T>): Promise<T> => {
    const t0 = performance.now();
    let status: "ok" | "error" = "ok";
    try { return await work(); }
    catch (error) { status = "error"; throw error; }
    finally { await runTraces({ traceId, spanId: hex(8), operation, durationMs: performance.now() - t0, status }, ops.traceSink); }
  };
  const warnings: string[] = [];
  const extensions: Record<string, unknown> = {};
  let reservation: Reservation | null = null;
  // 15_EXTENSIONS: run installed hooks for this tenant. A failing extension is skipped with a
  // warning rather than failing the user's answer.
  const hooks = async (hook: Hook, data: { context?: string; output?: string }) => {
    if (!process.env.DATABASE_URL) return;
    try { Object.assign(extensions, await runHooks(actor.execution, hook, data)); }
    catch { if (!warnings.includes(EXTENSION_WARNING)) warnings.push(EXTENSION_WARNING); }
  };

  try {
    stage("preprocess");
    // 01 intake: validate the new message; detect an attached file (built by the UI).
    const latestRaw = input.messages.at(-1)!.content;
    userQuerySchema.parse({ text: latestRaw });
    const attachment = ATTACHMENT.exec(latestRaw);
    const attachmentBytes = attachment ? new TextEncoder().encode(attachment[1]).length : 0;

    // 02 preprocess: normalize, moderate the new message, redact PII across the conversation.
    const normalized = input.messages.map(m => ({ role: m.role, content: normalizeInput(m.content) || m.content }));
    const latest = normalized.at(-1)!.content;
    const checker = moderationChecker(fetchImpl);
    const inputCheck = await span("validate", () => runPolicyCheck(latest, checker));
    if (inputCheck.decision !== "allow") throw new InputBlockedError(inputCheck.reasons);
    if (inputCheck.reasons.includes("moderation_unavailable")) warnings.push("Moderation service unavailable; local safety filter applied.");
    const language = detectLanguage(latest);
    const vault = new PiiVault(input.mode === "code" ? CODE_MODE_PII : undefined);
    const redacted = normalized.map(m => ({ ...m, content: vault.redact(m.content) }));
    await hooks("after_preprocess", { context: redacted.at(-1)!.content });

    // 04 task classification (the mode is the declared task; a routing hint, not a permission).
    const classified = runTaskClassifier({ query: latest, declaredTask: input.mode === "code" ? "code" : "qa" });
    const capability = CAPABILITY[input.mode];
    // 01 intent: the message must form a valid intent (goal + clarification flag). Validated only:
    // the goal is the user's own text, so just the flag goes into the intake record below.
    const intent = intentSchema.parse({ goal: latest.trim().slice(0, 2000), needsClarification: classified.needsClarification ? "yes" : "no" });

    // 00 capability limits size the 03 history budget and the output budget.
    const rule = capabilityMatrix[capability];
    const budgetChars = rule.maxInputTokens * CHARS_PER_TOKEN - SYSTEM_RESERVE_CHARS;
    const maxOutputTokens = rule.maxOutputTokens;

    // 03 context: compact history; 07 search retrieves documents/memories when configured.
    const { messages, dropped } = compactHistory(redacted, budgetChars);
    let sources: RetrievedSource[] = [];
    if (pipelineConfigured() && actor.execution.permissions.has("tools:search")) {
      stage("search");
      sources = await span("retrieve", () =>
        runSearch(actor.execution, { query: messages.at(-1)!.content.slice(0, 2000) }, pipelineSearchAdapter(fetchImpl)));
      if (sources.length) messages[messages.length - 1] = { role: "user", content: withContext(messages.at(-1)!.content, sources) };
    }

    // 01 intake record (metadata only; no message text is stored).
    ops.add("intake", {
      task_type: taskTypeSchema.parse({ type: INTAKE_TASK[classified.task] }),
      modality: modalitySchema.parse(attachment ? { kind: "document", attachmentIds: [randomUUID()] } : { kind: "text", attachmentIds: [] }),
      constraints: constraintsSchema.parse({ maxOutputTokens, language: language.language === "unknown" ? "und" : language.language, format: "markdown" }),
      priority: { ...prioritySchema.parse({ requested: "normal", reason: "" }), effective: effectivePriority("normal", false) },
      needsClarification: classified.needsClarification,
      intent: { needsClarification: intent.needsClarification },
    }, 30);

    const providers = configuredProviders();
    if (!providers.length) {
      if (process.env.NODE_ENV !== "production" && process.env.CHAT_DEMO_MODE === "true") {
        return {
          answer: `# ${input.mode.toUpperCase()} response\n\nMode: **${input.mode}**\n\nThis is an explicit demo response, not an AI answer.`,
          meta: { requestId, language: language.language, redacted: vault.counts, droppedMessages: dropped, retrievedDocuments: 0, task: classified.task, provider: "demo", attempts: 0, warnings, extensions },
        };
      }
      throw new ProviderError("AI_PROVIDER_NOT_CONFIGURED", 503);
    }

    // 00 preflight: scope, role/limits, policy, and registry selection for this actor.
    const inputChars = messages.reduce((n, m) => n + m.content.length, 0);
    const inputTokens = tokensOf(inputChars);
    const maxUsd = Number(process.env.AZ_MAX_REQUEST_USD) || 1;
    const decision = preflight({
      actor: actor.meta,
      request: { capability, classification: "public", requestedOutputTokens: maxOutputTokens, inputTokens, attachmentBytes, production: process.env.NODE_ENV === "production" },
      policyContext: { externalProvider: true, protectedOperation: false, reviewerId: null, approvalValid: false },
      registry: metaRegistry(providers),
      options: { maxEstimatedUsd: maxUsd },
    });
    if (!decision.allowed) throw new NotPermittedError(decision.reasons);
    // Subscription access rules (migration 010) for web chat: features must be on the plan and
    // metered use is reserved atomically now, refunded below if the request fails.
    // IDE tokens are rate-limited per minute instead.
    let access: Access | null = null;
    if (actor.channel === "web" && process.env.DATABASE_URL) {
      access = await accessFor(actor);
      const needed: AccessFeature[] = ["messages"];
      if (input.model === "reasoning") needed.push("reasoning");
      if (input.mode === "research") needed.push("research");
      if (attachmentBytes) needed.push("attachments");
      if (!options.skipUsage) reservation = await reserveUsage(access, needed);
    }

    // 04 routing: eligibility, budget, fresh latency data, then health-aware fallback order.
    const tenantId = actor.auth.tenantId;
    const requirements: Requirements = { tenantId, task: classified.task, capabilities: [capability], region: "global", inputTokens, outputTokens: maxOutputTokens, minQuality: 0 };
    const candidates = routingCandidates(providers, tenantId, capability);
    runModelSelector(candidates, requirements);
    runCostOptimizer(candidates, requirements, maxUsd);
    let fastest: string | undefined;
    try { fastest = runLatencyOptimizer(candidates, requirements, Number(process.env.AZ_LATENCY_TARGET_MS) || 20_000).id; } catch { /* not enough fresh telemetry yet */ }
    const router = createRouter({ providers, primary: decision.model.id, fastest, actor, requestId, ops, inputTokens, signal: options.signal });
    const adapter = router.reliability(); // ModelAdapter for the 08/09/10 modules

    // 06 prompt engine: policy system prompt, persona, developer profile, guardrails, pipeline notes,
    // and (for structured answers) the 06 output spec with reviewed few-shot examples.
    const system = buildSystemPrompt();
    const structured = input.format === "json";
    const reasoning = input.model === "reasoning" || input.mode === "research";
    const notes = [
      "Values like [EMAIL_1] or [PHONE_2] are privacy placeholders for the user's real data. Use them verbatim where needed; never guess the real values.",
      ...(language.language !== "en" && language.language !== "unknown" && language.confidence >= 0.7
        ? [`The user is writing in ${LANGUAGE_NAMES[language.language] ?? language.language}. Reply in that language unless asked otherwise.`] : []),
      ...(dropped ? [`Earlier parts of this conversation (${dropped} messages) were omitted to fit the context budget.`] : []),
    ];
    // Account menu → Personalization (local user only).
    if (actor.userId && can(access, "personalization")) { const personal = await personalizationFor(actor.userId); if (personal) notes.push(personal); }
    // Project → Settings → Instructions, for chats in that project (only the owner's own projects).
    if (actor.userId && input.projectId && process.env.DATABASE_URL) {
      try {
        const account = await accountById(actor.userId);
        const project = account ? await projectInstructions(account.id, input.projectId) : null;
        if (project) notes.push(`Instructions for the user's project "${project.name}" (follow them unless they conflict with policy):\n${project.instructions}`);
      } catch { warnings.push("Project instructions couldn't be loaded; answered without them."); }
    }
    const systemText = [
      PERSONA[input.mode],
      MODEL_IDENTITY,
      system.message.content,
      ...(PROFILE[input.mode] ? [buildDeveloperPrompt(PROFILE[input.mode]).content] : []),
      ...(reasoning ? [buildReasoningGuardrails().content] : []),
      ...(styleInstruction(input.style) ? [styleInstruction(input.style)!] : []),
      ...(structured ? [`Return ONLY a JSON object matching this JSON Schema, with no other text: ${JSON.stringify(answerJsonSchema)}. Put the full Markdown answer in "answer".`] : []),
      notes.join("\n"),
    ].join("\n\n");
    const lastUser = buildUserPrompt({ text: messages.at(-1)!.content }).content;
    const fewShot = structured
      ? buildFewShotExamples(FEW_SHOT_REGISTRY, STRUCTURED_EXAMPLE_IDS).filter((m): m is ChatTurn => m.role === "user" || m.role === "assistant")
      : [];
    const history: ChatTurn[] = [...fewShot, ...messages.slice(0, -1)];

    // 08 reasoning: "Explore deeply" first decomposes the question; code mode with AZ · Reasoning
    // first plans the work. A plan that can't be built is skipped, not fatal.
    let plan: string[] = [];
    if ((input.mode === "research" && can(access, "research_plans")) || (input.mode === "code" && input.model === "reasoning")) stage("plan");
    try {
      if (input.mode === "research" && !can(access, "research_plans")) {
        warnings.push(`Research plans are included with Plus and above (you're on ${access?.planName ?? "Free"}).`);
      } else if (input.mode === "research") {
        plan = (await span("generate", () => runDecomposition(lastUser.slice(0, 50000), adapter))).subtasks.map(t => t.objective);
      } else if (input.mode === "code" && input.model === "reasoning") {
        plan = (await span("generate", () => runPlanning(lastUser.slice(0, 50000), adapter))).steps.map(s => `${s.action} (done when: ${s.acceptanceCriterion})`);
      }
    } catch (error) {
      console.warn(`08 plan skipped: ${String((error as Error)?.message).slice(0, 300)}`);
      warnings.push("Couldn't build a plan first; answered directly.");
    }
    // 07 tools: a bounded tool-call loop first, when the question calls for one. Results are
    // attached as untrusted data; a loop that fails is skipped, not fatal.
    let toolResults: Awaited<ReturnType<typeof runToolLoop>> = [];
    if (wantsTools(latest)) {
      stage("tools");
      try {
        toolResults = await span("generate", () => runToolLoop({
          adapter, question: lastUser, auth: actor.execution, sources, fetchImpl, signal: options.signal,
          onEvent: event => emit({ type: "tool", ...event }),
        }));
      } catch (error) {
        if (options.signal?.aborted) throw error;
        warnings.push("Tools were unavailable for this answer; answered directly.");
      }
    }
    const planned = plan.length ? `${lastUser}\n\nCover these points in order in your answer:\n${plan.map((p, i) => `${i + 1}. ${p}`).join("\n")}` : lastUser;
    const prompt = withToolResults(planned, toolResults);

    // 05 model layer through 04 fallback: multi-pass for reasoning, specialists for code.
    const chatModel = (preferred: string[] = []) => router.model({ system: systemText, history, maxOutputTokens, preferred });
    let result: Result;
    stage("generate");
    try {
      result = await span("generate", () => {
        if (input.model === "reasoning") return refineAnswer(chatModel(), "routed", prompt, 1);
        if (input.model === "code") {
          const specialist = createSpecialistRouter([{ id: "code", modelId: "routed", capabilities: ["coding"], adapter: chatModel(codeProviderIds()), enabled: true }]);
          return specialist("coding", prompt);
        }
        return chatModel().run({ prompt, modelId: "routed" });
      });
    } catch (error) {
      if (error instanceof DispatchError || (error as Error)?.name === "TimeoutError" || (error as Error)?.name === "AbortError") {
        throw new ProviderError("AI_PROVIDER_UNAVAILABLE", 502);
      }
      throw error;
    }

    // Structured answers: 10 schema check against the 06 spec; fall back to plain text if invalid.
    const { answer: publicText } = publicAnswerOnly({ answer: result.text });
    await hooks("after_model_call", { output: publicText });
    let answerText = publicText;
    let structuredOut: { answer: string; citations: string[]; warnings: string[] } | undefined;
    if (structured) {
      try {
        structuredOut = runSchemaCheck(stripJsonFences(publicText), answerSchema);
        answerText = structuredOut.answer;
      } catch {
        warnings.push("The model didn't return valid structured output; the answer is plain text.");
        structuredOut = { answer: publicText, citations: [], warnings: [] };
      }
    }

    // 10 validation on the answer (placeholders still in place), 11 cleanup, restore PII.
    stage("validate");
    const outputCheck = await span("validate", () => runPolicyCheck(answerText.slice(0, 50000), checker));
    if (outputCheck.decision !== "allow") throw new OutputBlockedError(outputCheck.reasons);
    const answer = vault.restore(runCleanup(answerText));

    // 10 factual/hallucination checks + 09 confidence tags when the answer used retrieved sources.
    let evidence: EvidenceReport | undefined;
    if (sources.length) {
      try {
        evidence = await span("validate", () => checkEvidence(answerText, sources, adapter));
        if (evidence.contradicted) warnings.push("Some statements conflict with the retrieved sources.");
      } catch {
        warnings.push("Evidence check unavailable for this answer.");
      }
    }

    // 11 citations: which retrieved sources the answer cites (unknown IDs are flagged).
    // 10 quality: structural rubric only; its value is checked against ratings in /insights.
    const references = sources.length ? citationsFor(answer, sources) : { citations: [], unsupportedIds: [] };
    if (references.unsupportedIds.length) warnings.push("Some source references in this answer don't match any retrieved source.");
    const quality = structuralQuality(answer, { sourcesRetrieved: sources.length, citations: references.citations.length, unsupported: references.unsupportedIds.length });

    stage("deliver");
    await hooks("before_delivery", { output: answer });

    // 12 delivery: the answer must form a valid renderable artifact before it is returned.
    await span("deliver", async () => validateRenderableArtifact({
      id: randomUUID(), requestId, text: answer, warnings: warnings.slice(0, 10), validationVersion: VALIDATION_VERSION,
      citations: references.citations.flatMap(c => c.url ? [{ sourceId: c.id, url: c.url }] : []).slice(0, 30),
    }));
    // 09 format control (JSON) / 11 normalize format (text): the body and content type for API clients.
    const citations = (structuredOut?.citations ?? []).map(c => vault.restore(c));
    const delivered = structured
      ? runFormatControl({ format: "json", answer, citations })
      : runNormalizeFormat({ format: "text", text: answer });
    const answeredBy = router.answeredBy;
    const attempts = router.attempts;

    // 13/14: request ownership (for feedback), prompt template + routing record, metrics.
    ops.add("request", { mode: input.mode, model: input.model, capability, provider: answeredBy?.id ?? result.provider, attempts, retrieved: sources.length, tools: toolResults.map(r => r.tool), style: input.style ?? "default", cited: references.citations.length, quality: quality.score, rubric: quality.rubric }, 90);
    await runPromptsLog(actor.auth, { requestId, templateVersion: `06-system-${system.version}_${input.mode}`, inputTokens }, ops.repository);
    await runMetrics({ name: "request_count", value: 1, outcome: "success" }, ops.metricSink);
    await runMetrics({ name: "request_duration_ms", value: Math.min(performance.now() - started, 3_600_000), outcome: "success" }, ops.metricSink);

    return {
      answer,
      meta: {
        requestId, language: language.language, redacted: vault.counts, droppedMessages: dropped,
        retrievedDocuments: sources.length, task: classified.task, provider: answeredBy?.label ?? result.provider,
        attempts, warnings, extensions, contentType: delivered.contentType,
        style: input.style ?? "default", quality,
        ...(toolResults.length ? { tools: toolResults.map(r => ({ tool: r.tool, ok: r.ok })) } : {}),
        ...(references.citations.length ? { sources: references.citations } : {}),
        ...(plan.length ? { plan: plan.map(p => vault.restore(p)) } : {}),
        ...(evidence ? { evidence } : {}),
        ...(structuredOut ? { structured: { answer, citations, warnings: [...structuredOut.warnings.map(w => vault.restore(w)), ...warnings] } } : {}),
      },
    };
  } catch (error) {
    // Usage was reserved for a request that didn't complete: give it back.
    await reservation?.refund();
    const category = error instanceof ProviderError ? "provider"
      : error instanceof InputBlockedError || error instanceof OutputBlockedError || error instanceof NotPermittedError ? "validation"
      : (error as Error)?.name === "TimeoutError" ? "timeout" : "internal";
    await runErrorLogs(actor.auth, { requestId, category, correlationId: randomUUID() }, ops.repository).catch(() => {});
    await runMetrics({ name: "request_count", value: 1, outcome: "failure" }, ops.metricSink).catch(() => {});
    throw error;
  } finally {
    await ops.flush();
  }
}
