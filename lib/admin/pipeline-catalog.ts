// Production replacement for the standalone stage demos (the <stage>/<module>/page.tsx forms that
// posted JSON to routes that never existed). One entry per module: its real status in the app,
// where it is used, and what /admin/pipeline/<slug> shows for it. Kept in sync by
// tests/admin-pipeline.test.ts, which checks every demo page has an entry.

export type ModuleStatus = "connected" | "partial" | "not_connected";

/** What the detail page shows, besides the description. */
export type ModuleView =
  | { kind: "records"; module: string }   // operations_records metadata for this module
  | { kind: "config"; source: ConfigSource }
  | { kind: "none" };

export type ConfigSource =
  | "system_prompt" | "developer_prompt" | "guardrails" | "few_shot" | "structured_spec" | "user_prompt"
  | "providers" | "tools" | "styles" | "quality_rubric" | "moderation" | "translation" | "stream_events"
  | "routing" | "intake_schemas";

/** Modules with a deterministic, side-effect-free dry run (no AI call, nothing stored). */
export type DryRun =
  | "calculator" | "task_classifier" | "user_prompt" | "style_control" | "quality_score" | "citations"
  | "cleanup" | "normalize_format" | "policy_check" | "schema_check" | "streaming_output"
  | "user_query" | "intent" | "task_type" | "modality" | "priority" | "constraints";

export type CatalogEntry = {
  slug: string;            // URL segment: "<stage>-<module>"
  stage: string;           // "06"
  folder: string;          // "06_PROMPT_ENGINE"
  module: string;          // "system_prompt"
  title: string;
  status: ModuleStatus;
  summary: string;         // what it does in this app
  usedIn: string[];        // files that use it
  needs?: string;          // why it isn't (fully) connected
  view: ModuleView;
  dryRun?: { kind: DryRun; example: string; hint: string };
};

const e = (folder: string, module: string, title: string, rest: Omit<CatalogEntry, "slug" | "stage" | "folder" | "module" | "title">): CatalogEntry =>
  ({ slug: `${folder.slice(0, 2)}-${module}`, stage: folder.slice(0, 2), folder, module, title, ...rest });

const PIPE = "lib/pipeline/index.ts";
const json = (v: unknown) => JSON.stringify(v, null, 2);

export const CATALOG: CatalogEntry[] = [
  // 01 intake
  e("01_INTAKE", "user_query", "User query", { status: "connected", summary: "Validates the newest message before anything else runs.", usedIn: [PIPE], view: { kind: "records", module: "intake" },
    dryRun: { kind: "user_query", example: json({ text: "Summarise this report in five bullets." }), hint: "JSON: { text }" } }),
  e("01_INTAKE", "intent", "Intent", { status: "connected", summary: "Every message must form a valid intent (goal + needs-clarification flag). Validated only: the goal is the user's text, so just the flag is recorded.", usedIn: [PIPE], view: { kind: "records", module: "intake" },
    dryRun: { kind: "intent", example: json({ goal: "Create a decision-ready executive summary.", needsClarification: "no" }), hint: "JSON: { goal, needsClarification: yes|no }" } }),
  e("01_INTAKE", "task_type", "Task type", { status: "connected", summary: "The intake record's task category, from the 04 task classifier.", usedIn: [PIPE], view: { kind: "records", module: "intake" },
    dryRun: { kind: "task_type", example: json({ type: "question_answering" }), hint: "JSON: { type }" } }),
  e("01_INTAKE", "modality", "Modality", { status: "connected", summary: "Text or document (when a file is attached). Attachment IDs are random; contents aren't stored.", usedIn: [PIPE], view: { kind: "records", module: "intake" },
    dryRun: { kind: "modality", example: json({ kind: "text", attachmentIds: [] }), hint: "JSON: { kind, attachmentIds }" } }),
  e("01_INTAKE", "priority", "Priority", { status: "connected", summary: "Requested and effective priority on the intake record.", usedIn: [PIPE], view: { kind: "records", module: "intake" },
    dryRun: { kind: "priority", example: json({ requested: "normal", reason: "" }), hint: "JSON: { requested, reason }" } }),
  e("01_INTAKE", "constraints", "Constraints", { status: "connected", summary: "Output budget, language and format, from the 00 capability limits.", usedIn: [PIPE], view: { kind: "records", module: "intake" },
    dryRun: { kind: "constraints", example: json({ maxOutputTokens: 4000, language: "en", format: "markdown" }), hint: "JSON: { maxOutputTokens, language, format }" } }),
  // 04 routing
  e("04_ROUTING", "task_classifier", "Task classifier", { status: "connected", summary: "Classifies each message (qa, code, summarize, write, extract, other); a routing hint, not a permission.", usedIn: [PIPE], view: { kind: "records", module: "intake" },
    dryRun: { kind: "task_classifier", example: "Summarize the attached meeting notes", hint: "Message text" } }),
  e("04_ROUTING", "model_selector", "Model selector", { status: "connected", summary: "Filters providers by capability, context window and region for each request.", usedIn: [PIPE], view: { kind: "config", source: "routing" } }),
  e("04_ROUTING", "cost_optimizer", "Cost optimizer", { status: "connected", summary: "Drops providers whose estimated cost exceeds AZ_MAX_REQUEST_USD.", usedIn: [PIPE], view: { kind: "config", source: "routing" } }),
  e("04_ROUTING", "latency_optimizer", "Latency optimizer", { status: "connected", summary: "Prefers the fastest provider once there is fresh latency data.", usedIn: [PIPE, "lib/pipeline/registry.ts"], view: { kind: "records", module: "model_performance" } }),
  e("04_ROUTING", "fallback_policy", "Fallback policy", { status: "connected", summary: "Tries up to 3 providers per call; recently failing ones go last for 5 minutes.", usedIn: ["lib/pipeline/router.ts"], view: { kind: "config", source: "providers" } }),
  // 05 model layer
  e("05_MODEL_LAYER", "gpt_branch", "GPT branch", { status: "connected", summary: "OpenAI SDK adapter.", usedIn: ["lib/pipeline/registry.ts"], view: { kind: "config", source: "providers" } }),
  e("05_MODEL_LAYER", "gemini_branch", "Gemini branch", { status: "connected", summary: "Google Gemini SDK adapter.", usedIn: ["lib/pipeline/registry.ts"], view: { kind: "config", source: "providers" } }),
  e("05_MODEL_LAYER", "grok_branch", "Grok branch", { status: "connected", summary: "xAI Grok adapter.", usedIn: ["lib/pipeline/registry.ts"], view: { kind: "config", source: "providers" } }),
  e("05_MODEL_LAYER", "multi_pass_reasoning", "Multi-pass reasoning", { status: "connected", summary: "“AZ · Reasoning” drafts, critiques and refines the answer.", usedIn: [PIPE], view: { kind: "records", module: "model_performance" } }),
  e("05_MODEL_LAYER", "specialist_models", "Specialist models", { status: "connected", summary: "“AZ · Code” prefers the code providers (AZ_CODE_PROVIDERS, default groq,gemini).", usedIn: [PIPE], view: { kind: "config", source: "providers" } }),
  e("05_MODEL_LAYER", "ensemble_mode", "Ensemble mode", { status: "not_connected", summary: "Asks several models and combines their answers.", usedIn: [], needs: "Multiplies provider cost per message and needs a comparison/selection rule; no product decision yet.", view: { kind: "config", source: "providers" } }),
  // 06 prompt engine
  e("06_PROMPT_ENGINE", "system_prompt", "System prompt", { status: "connected", summary: "The policy system prompt sent with every request.", usedIn: [PIPE], view: { kind: "config", source: "system_prompt" } }),
  e("06_PROMPT_ENGINE", "developer_prompt", "Developer prompt", { status: "connected", summary: "Profile instructions for code (engineering) and Explore deeply (research).", usedIn: [PIPE], view: { kind: "config", source: "developer_prompt" } }),
  e("06_PROMPT_ENGINE", "user_prompt", "User prompt", { status: "connected", summary: "Validates and wraps the user's turn.", usedIn: [PIPE], view: { kind: "config", source: "user_prompt" },
    dryRun: { kind: "user_prompt", example: "Explain hash maps to a beginner.", hint: "Message text" } }),
  e("06_PROMPT_ENGINE", "few_shot_examples", "Few-shot examples", { status: "connected", summary: "Reviewed examples added for structured (JSON) answers.", usedIn: [PIPE], view: { kind: "config", source: "few_shot" } }),
  e("06_PROMPT_ENGINE", "chain_of_thought_guardrails", "Reasoning guardrails", { status: "connected", summary: "Added for reasoning/research; only the public answer is returned.", usedIn: [PIPE], view: { kind: "config", source: "guardrails" } }),
  e("06_PROMPT_ENGINE", "structured_output_spec", "Structured output spec", { status: "connected", summary: "JSON schema for format: \"json\" answers.", usedIn: [PIPE], view: { kind: "config", source: "structured_spec" } }),
  // 07 tools
  e("07_TOOLS", "calculator", "Calculator", { status: "connected", summary: "Tool-call loop tool for arithmetic questions; available to everyone. Runs no code.", usedIn: ["lib/pipeline/tools.ts"], view: { kind: "config", source: "tools" },
    dryRun: { kind: "calculator", example: json({ operation: "multiply", a: 1234, b: 56 }), hint: "JSON: { operation: add|subtract|multiply|divide, a, b }" } }),
  e("07_TOOLS", "search", "Search", { status: "connected", summary: "Retrieves documents/memories (and web results when enabled) from pipeline-api; also a tool in the loop.", usedIn: [PIPE, "lib/pipeline/tools.ts"], needs: "Active only when PIPELINE_API_URL and PIPELINE_API_TOKEN are set.", view: { kind: "config", source: "tools" } }),
  e("07_TOOLS", "browser", "Browser", { status: "not_connected", summary: "Fetch and read web pages.", usedIn: [], needs: "An SSRF-safe remote browser service with an allowlist.", view: { kind: "config", source: "tools" } }),
  e("07_TOOLS", "files", "Files", { status: "not_connected", summary: "Read and write user files.", usedIn: [], needs: "Tenant-scoped object storage (paths derived from the session, never user input).", view: { kind: "config", source: "tools" } }),
  e("07_TOOLS", "external_apis", "External APIs", { status: "not_connected", summary: "Call third-party APIs.", usedIn: [], needs: "Reviewed outbound origins and per-tool scoped credentials.", view: { kind: "config", source: "tools" } }),
  e("07_TOOLS", "code_execution", "Code execution", { status: "not_connected", summary: "Run code for the user.", usedIn: [], needs: "An isolated sandbox service (no network, no secrets, CPU/memory/time limits). Never eval or a Node VM.", view: { kind: "config", source: "tools" } }),
  // 08 reasoning
  e("08_REASONING", "decomposition", "Decomposition", { status: "connected", summary: "Explore deeply breaks the question into steps first (Plus and above).", usedIn: [PIPE], view: { kind: "records", module: "traces" } }),
  e("08_REASONING", "planning", "Planning", { status: "connected", summary: "Code mode + AZ · Reasoning plans the work first.", usedIn: [PIPE], view: { kind: "records", module: "traces" } }),
  e("08_REASONING", "hypothesis_testing", "Hypothesis testing", { status: "not_connected", summary: "Generates and tests competing explanations.", usedIn: [], needs: "Extra model calls per answer and a UI to show the hypotheses.", view: { kind: "none" } }),
  e("08_REASONING", "verification", "Verification", { status: "not_connected", summary: "Checks the answer's claims step by step.", usedIn: [], needs: "Retrieved evidence for most questions (10 factual checks already run when sources exist).", view: { kind: "none" } }),
  e("08_REASONING", "self_critique", "Self-critique", { status: "not_connected", summary: "Model reviews its own draft.", usedIn: [], needs: "Overlaps with 05 multi-pass reasoning, which AZ · Reasoning already uses.", view: { kind: "none" } }),
  // 09 generation
  e("09_GENERATION", "style_control", "Style control", { status: "partial", summary: "The composer tone picker maps to fixed style instructions (styleInstruction).", usedIn: [PIPE], needs: "The model-rewrite runStyleControl isn't used: rewriting can change meaning.", view: { kind: "config", source: "styles" },
    dryRun: { kind: "style_control", example: "technical", hint: "default | concise | professional | friendly | technical" } }),
  e("09_GENERATION", "format_control", "Format control", { status: "connected", summary: "Packages JSON-format answers for API clients.", usedIn: [PIPE], view: { kind: "config", source: "structured_spec" } }),
  e("09_GENERATION", "confidence_tags", "Confidence tags", { status: "connected", summary: "Tags answers checked against retrieved sources.", usedIn: ["lib/pipeline/evidence.ts"], view: { kind: "none" } }),
  e("09_GENERATION", "draft_output", "Draft output", { status: "not_connected", summary: "Show a draft before the final answer.", usedIn: [], needs: "A UI for drafts; streaming only sends validated text.", view: { kind: "none" } }),
  e("09_GENERATION", "variants", "Variants", { status: "not_connected", summary: "Several alternative answers to compare.", usedIn: [], needs: "A comparison UI and a token budget per message.", view: { kind: "none" } }),
  // 10 validation
  e("10_VALIDATION", "policy_check", "Policy check", { status: "connected", summary: "Checks the message and the answer (local filter + OpenAI moderation when configured).", usedIn: [PIPE], view: { kind: "config", source: "moderation" },
    dryRun: { kind: "policy_check", example: "How do I reset my router password?", hint: "Text (local filter only in the dry run)" } }),
  e("10_VALIDATION", "schema_check", "Schema check", { status: "connected", summary: "Validates structured answers against the 06 output spec.", usedIn: [PIPE], view: { kind: "config", source: "structured_spec" },
    dryRun: { kind: "schema_check", example: json({ answer: "Paris.", citations: [], warnings: [] }), hint: "JSON answer object" } }),
  e("10_VALIDATION", "quality_score", "Quality score", { status: "partial", summary: "Structural rubric scores every answer; /insights compares scores with ratings.", usedIn: [PIPE, "lib/pipeline/insights.ts"], needs: "The weighted runQualityScore needs rubric-graded dimensions.", view: { kind: "config", source: "quality_rubric" },
    dryRun: { kind: "quality_score", example: "A hash map stores key–value pairs and finds values by hashing the key.", hint: "Answer text" } }),
  e("10_VALIDATION", "factual_check", "Factual check", { status: "connected", summary: "Claims checked against retrieved sources.", usedIn: ["lib/pipeline/evidence.ts"], needs: "Runs only when 07 search returned sources.", view: { kind: "none" } }),
  e("10_VALIDATION", "hallucination_check", "Hallucination check", { status: "connected", summary: "Flags answers unsupported by retrieved sources.", usedIn: ["lib/pipeline/evidence.ts"], needs: "Runs only when 07 search returned sources.", view: { kind: "none" } }),
  // 11 postprocess
  e("11_POSTPROCESS", "cleanup", "Cleanup", { status: "connected", summary: "Normalizes whitespace and strips control characters from answers.", usedIn: [PIPE], view: { kind: "none" },
    dryRun: { kind: "cleanup", example: "Line one   \n\n\n\nLine two\u0007", hint: "Text" } }),
  e("11_POSTPROCESS", "normalize_format", "Normalize format", { status: "connected", summary: "Text answers' body and content type for API clients.", usedIn: [PIPE], view: { kind: "none" },
    dryRun: { kind: "normalize_format", example: "# Title\r\n\r\nBody text", hint: "Text" } }),
  e("11_POSTPROCESS", "citations", "Citations", { status: "partial", summary: "Matches the source IDs an answer cites against retrieved sources (citationsFor); shown as Sources.", usedIn: [PIPE], needs: "runCitations resolves stored source records; sources aren't stored.", view: { kind: "none" },
    dryRun: { kind: "citations", example: json({ answer: "Use the router settings page [web:1]. See also [9].", sources: [{ sourceId: "web:1", title: "Router guide", url: "https://example.org/guide" }] }), hint: "JSON: { answer, sources: [{ sourceId, title, url }] }" } }),
  e("11_POSTPROCESS", "translation", "Translation", { status: "connected", summary: "Translate any answer from the answer toolbar.", usedIn: ["lib/pipeline/translate.ts"], view: { kind: "config", source: "translation" } }),
  e("11_POSTPROCESS", "response_packaging", "Response packaging", { status: "not_connected", summary: "Packages a stored, approved answer artifact.", usedIn: [], needs: "Server-side answer storage, which the privacy rule rules out. Answers are returned directly.", view: { kind: "none" } }),
  // 12 delivery
  e("12_DELIVERY", "streaming_output", "Streaming output", { status: "connected", summary: "SSE encoder and chunking for /api/chat/stream (validated text only).", usedIn: ["app/api/chat/stream/route.ts"], view: { kind: "config", source: "stream_events" },
    dryRun: { kind: "streaming_output", example: "Streaming sends validated text in whitespace-aligned chunks so words are never split across events.", hint: "Text (chunked at 32 characters here)" } }),
  e("12_DELIVERY", "final_answer", "Final answer", { status: "not_connected", summary: "Reads a stored, approved answer.", usedIn: [], needs: "Server-side answer storage (ruled out by the privacy rule).", view: { kind: "none" } }),
  e("12_DELIVERY", "api_response", "API response", { status: "not_connected", summary: "Returns a stored answer as an API response.", usedIn: [], needs: "Server-side answer storage. /api/chat and /api/v1/chat return answers directly.", view: { kind: "none" } }),
  // 13 feedback
  e("13_FEEDBACK", "user_rating", "User rating", { status: "connected", summary: "👍/👎 on answers, one current rating per person and answer.", usedIn: ["app/api/feedback/route.ts"], view: { kind: "records", module: "user_rating" } }),
  e("13_FEEDBACK", "correction_capture", "Correction capture", { status: "connected", summary: "Corrections on answers, personal data redacted before storage.", usedIn: ["app/api/feedback/route.ts"], view: { kind: "records", module: "correction_capture" } }),
  e("13_FEEDBACK", "error_logs", "Error logs", { status: "connected", summary: "Failed requests by category (provider, validation, timeout, internal).", usedIn: [PIPE], view: { kind: "records", module: "error_logs" } }),
  e("13_FEEDBACK", "improvement_queue", "Improvement queue", { status: "connected", summary: "Admins queue unhelpful answers for review (Operations → Answer feedback).", usedIn: ["lib/support/feedback.ts"], view: { kind: "none" } }),
  // 14 observability
  e("14_OBSERVABILITY", "traces", "Traces", { status: "connected", summary: "Timing of retrieve/generate/validate/deliver per request.", usedIn: [PIPE], view: { kind: "records", module: "traces" } }),
  e("14_OBSERVABILITY", "metrics", "Metrics", { status: "connected", summary: "Request counts and durations.", usedIn: [PIPE], view: { kind: "records", module: "metrics" } }),
  e("14_OBSERVABILITY", "prompts_log", "Prompts log", { status: "connected", summary: "Which prompt template version answered (never the prompt text).", usedIn: [PIPE], view: { kind: "records", module: "prompts_log" } }),
  e("14_OBSERVABILITY", "model_performance", "Model performance", { status: "connected", summary: "Per-provider outcome, latency and token estimates.", usedIn: ["lib/pipeline/router.ts"], view: { kind: "records", module: "model_performance" } }),
  e("14_OBSERVABILITY", "audit_trail", "Audit trail", { status: "connected", summary: "Staff access changes (Operations → Activity).", usedIn: ["app/api/operations/staff/[id]/route.ts", "lib/support/feedback.ts"], view: { kind: "none" } }),
];

export const STAGE_NAMES: Record<string, string> = {
  "01": "Intake", "04": "Routing", "05": "Model layer", "06": "Prompt engine", "07": "Tools", "08": "Reasoning",
  "09": "Generation", "10": "Validation", "11": "Post-process", "12": "Delivery", "13": "Feedback", "14": "Observability",
};

export const findModule = (slug: string) => CATALOG.find(m => m.slug === slug);
