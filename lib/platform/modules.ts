import "server-only";
import { configuredProviders } from "@/lib/pipeline/registry";
import { searchConfigured } from "@/lib/search/tavily";

// The A-Zee AI blueprint (25 modules, 6 pillars, release acceptance criteria) with the real state
// of each in this application. "live" means it exists and runs here; "partial" names what's
// missing; "planned" means not built. Statuses that depend on configuration are computed.

export type Status = "live" | "partial" | "needs-setup" | "planned";
export type Module = { n: number; name: string; status: Status; summary: string; inApp: string; next?: string; href?: string };

export function platformState() {
  const search = searchConfigured();
  const providers = configuredProviders().length;
  const db = Boolean(process.env.DATABASE_URL);
  const searchStatus: Status = search ? "partial" : "needs-setup";
  const researchStatus: Status = search ? "live" : "needs-setup";

  const modules: Module[] = [
    { n: 1, name: "A-Zee Search", status: searchStatus, summary: "Live web search, crawling, indexing, citations and source verification",
      inApp: "Live web retrieval (Tavily), numbered citations, source dates, freshness and relevance, quote-verified claims, provenance recorded per answer.",
      next: search ? "Own crawler and search index (OpenSearch), reranking." : "Add TAVILY_API_KEY to .env.local.", href: "/search" },
    { n: 2, name: "Deep Research", status: researchStatus, summary: "Multi-step investigation, evidence synthesis, reports and references",
      inApp: "Durable research jobs with checkpoints and resume, evidence tables, conflicting claims, research gaps, Markdown export.",
      next: search ? "PDF/Word export; connected knowledge bases." : "Add TAVILY_API_KEY to .env.local.", href: "/search" },
    { n: 3, name: "AI Code Agent", status: "partial", summary: "Autonomous coding, multi-file editing, refactoring and debugging",
      inApp: "Code mode with specialist routing, planning (08), calculator tool loop.", next: "Repository access, multi-file edits on isolated branches (needs Secure Execution)." },
    { n: 4, name: "Cloud IDE", status: "planned", summary: "Browser editor, terminal, file explorer and Git", inApp: "Development canvas previews only.", next: "Needs sandboxed workspaces." },
    { n: 5, name: "Repository Intelligence", status: "planned", summary: "Codebase indexing, dependency graphs, semantic code search", inApp: "Not built." },
    { n: 6, name: "Multi-Model Router", status: providers ? "live" : "needs-setup", summary: "Select models by task, cost, latency and capability",
      inApp: `04 routing: task classifier, cost and latency optimizers, health-aware fallback across ${providers} configured provider${providers === 1 ? "" : "s"}.`, href: "/admin/pipeline" },
    { n: 7, name: "Agent Teams", status: "planned", summary: "Planner, coder, reviewer, tester, security and documentation agents", inApp: "Single-agent planning and tool loop only." },
    { n: 8, name: "Context Engine", status: "partial", summary: "Long-context retrieval, summarization, compression",
      inApp: "History compaction, project instructions, retrieval through pipeline-api when configured.", next: "Embedded retrieval over saved chats and documents." },
    { n: 9, name: "Persistent Memory", status: "partial", summary: "User-approved project memory, preferences, continuity",
      inApp: "Personalization, project settings, chats saved to the account.", next: "Consent-managed long-term memory with deletion controls." },
    { n: 10, name: "Multimodal AI", status: "partial", summary: "Text, image, audio, video and document understanding", inApp: "Text attachments only." },
    { n: 11, name: "Voice AI", status: "planned", summary: "Speech recognition, transcription, voice conversations", inApp: "Not built." },
    { n: 12, name: "Data Analytics", status: "planned", summary: "Python, SQL, statistics and visualizations", inApp: "Calculator tool only; needs Secure Execution." },
    { n: 13, name: "Document Studio", status: "partial", summary: "PDF, Word, spreadsheets, presentations, exports", inApp: "Markdown export of research reports; chat export (JSON)." },
    { n: 14, name: "Secure Execution", status: "planned", summary: "Isolated containers, resource limits, network restrictions",
      inApp: "Code execution is out of scope in 00_META until an isolated executor exists.", next: "Container or microVM sandbox service." },
    { n: 15, name: "Automated Testing", status: "planned", summary: "Unit, integration, E2E, API and regression tests for user projects", inApp: "Not built (the app's own suite: unit, browser and runtime checks)." },
    { n: 16, name: "Security Center", status: "partial", summary: "Secret scanning, SAST, dependency scanning, authorization checks",
      inApp: "Moderation, PII redaction, policy checks, untrusted-content isolation, role checks.", next: "Secret, SAST and dependency scanning." },
    { n: 17, name: "DevOps Agent", status: "planned", summary: "Pipelines, release artifacts, deployment plans, rollback", inApp: "Not built." },
    { n: 18, name: "App Builder", status: "planned", summary: "Web, mobile, backend, API and database scaffolding", inApp: "Not built." },
    { n: 19, name: "Database Agent", status: "planned", summary: "Schema design, migration planning, SQL review", inApp: "Not built." },
    { n: 20, name: "Connector Hub", status: "partial", summary: "GitHub, Drive, email, calendars, enterprise integrations", inApp: "VS Code (AZee Connect) with scoped API tokens.", next: "GitHub, Drive, email connectors." },
    { n: 21, name: "Knowledge Graph", status: "planned", summary: "Relationships between sources, files, code, entities, decisions", inApp: "Not built." },
    { n: 22, name: "Collaboration", status: "partial", summary: "Teams, shared workspaces, comments, approvals", inApp: "Staff operations, approval workflows, project share links.", href: "/operations" },
    { n: 23, name: "Billing and Access", status: db ? "live" : "needs-setup", summary: "Plans, metering, quotas, entitlements, organization billing",
      inApp: "Plans, server-side entitlements, monthly quotas, awaiting-payment activation.", next: "Payment provider integration.", href: "/pricing" },
    { n: 24, name: "Evaluation Engine", status: "partial", summary: "Benchmarks, model comparison, hallucination and regression tracking",
      inApp: "Insights: provider performance, structure score vs ratings, citation verification rates.", href: "/insights" },
    { n: 25, name: "Governance", status: db ? "partial" : "needs-setup", summary: "Audit trails, retention, tenant isolation, human approval",
      inApp: "Audit logs, approvals (no self-approval), metadata retention, owner-scoped data, roles.", href: "/admin" },
  ];

  const pillars = [
    { name: "AI Search", detail: "Live web, citations, research", modules: [1, 2], href: "/search" },
    { name: "AI Code", detail: "Repository agents and IDE", modules: [3, 4, 5] },
    { name: "AI Reason", detail: "Multimodal and model routing", modules: [6, 10] },
    { name: "AI Agents", detail: "Task planning and execution", modules: [7, 14] },
    { name: "AI Workspace", detail: "Documents, data and projects", modules: [9, 13, 22], href: "/" },
    { name: "AI Security", detail: "Policy, audit and verification", modules: [16, 25], href: "/admin" },
  ];

  const engine = [
    { name: "Model Router", status: modules[5].status }, { name: "Context Engine", status: "partial" as Status },
    { name: "Tool Registry", status: "partial" as Status }, { name: "Agent Scheduler", status: researchStatus === "live" ? "partial" as Status : "planned" as Status },
    { name: "Memory", status: "partial" as Status },
  ];
  const infrastructure = [
    { name: "Search Index", status: search ? "partial" as Status : "needs-setup" as Status }, { name: "Vector DB", status: "partial" as Status },
    { name: "PostgreSQL", status: db ? "live" as Status : "needs-setup" as Status }, { name: "Sandboxes", status: "planned" as Status },
    { name: "Git", status: "planned" as Status }, { name: "CI/CD", status: "planned" as Status }, { name: "Object Storage", status: "planned" as Status },
  ];

  const acceptance: { system: string; requirement: string; status: Status; evidence: string }[] = [
    { system: "Search", requirement: "Verified citations, retrieval freshness, source attribution", status: searchStatus,
      evidence: "Quote-level citation checks, publication dates and freshness labels, provenance stored per answer; unit-tested." },
    { system: "Coding", requirement: "Reproducible builds, tests and approved diffs", status: "planned", evidence: "Needs Secure Execution and repository access." },
    { system: "Agent execution", requirement: "Sandboxing, permission enforcement, safe interruption", status: "partial", evidence: "Research jobs can be cancelled and resume after interruption; no sandboxed execution." },
    { system: "Memory", requirement: "Consent, deletion, isolation, retrieval accuracy", status: "partial", evidence: "Owner-scoped chats and projects with deletion; no consent-managed long-term memory." },
    { system: "Model routing", requirement: "Fallback, latency and cost measurement", status: modules[5].status, evidence: "Fallback across providers, latency and cost optimizers, per-provider metrics in Insights." },
    { system: "Security", requirement: "Threat modeling, penetration testing, no critical findings", status: "partial", evidence: "Input/output policy checks, untrusted-content isolation; no external penetration test yet." },
    { system: "Billing", requirement: "Server-side entitlements, metering, reconciliation", status: "partial", evidence: "Server-side entitlements and metering; no payment provider to reconcile." },
    { system: "Reliability", requirement: "SLOs, recovery drills, backups and restore tests", status: "planned", evidence: "Not defined yet." },
    { system: "Governance", requirement: "Audit trails, retention, tenant separation", status: "partial", evidence: "Audit trails, metadata retention windows, owner and tenant scoping." },
  ];

  const counts = modules.reduce((acc, m) => ({ ...acc, [m.status]: (acc[m.status] ?? 0) + 1 }), {} as Record<Status, number>);
  return { modules, pillars, engine, infrastructure, acceptance, counts, search };
}
