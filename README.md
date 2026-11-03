# AZ_AI local application

The running Next.js application lives in `app/`, with backend services in `lib/`
and shared React components in `components/`. `00_META` supplies runtime policy
contracts. The numbered `01_INTAKE` through `15_ADMIN` folders hold the stage modules the
pipeline imports (see below); they are not Next.js routes themselves. Each module's `page.tsx`
renders its production view, mounted in the admin console: `/admin/pipeline/<stage>-<module>`
for stage modules and `/admin/<section>` for `15_ADMIN`. The VS Code extension
under `azee-connect/integrations/vscode` is a separate package with its own config.

## Run

```sh
npm install
npm run db:migrate
npm run dev
```

Open http://localhost:3000. For a production build, run `npm run build` and
`npm start`. The local server binds to localhost.
The build wrapper normalizes an observed Windows filesystem `readlink` error
on ordinary files so Next.js can trace dependencies; real symlink errors are
preserved.

## PostgreSQL

Set `DATABASE_URL` in `.env.local`. This machine uses PostgreSQL 18 with the
`az_ai` database and a dedicated `az_ai_app` role. Do not commit credentials.
`scripts/setup-local-db.cjs` provisions a fresh local database using operator
credentials from `PGPASSWORD`; it does not replace an existing database.
`npm run db:migrate` applies the canonical migrations in order, transactionally,
and records completed migrations. The duplicate legacy session migration is not
applied twice.

Admin sessions, tenant membership, records, audit events, extension settings,
API tokens, and request limits use PostgreSQL. Guest conversation history remains
in browser localStorage. Messages are sent to configured AI providers for answers.

## Request pipeline (stage folders 00–15)

Every chat request (`/api/chat` and the IDE API `/api/v1/chat`) runs through the stage
folders, wired together in `lib/pipeline/index.ts` (`answerChat`):

| Stage | Used for |
|---|---|
| 00_META | Preflight: scope, capability limits per role, policy, model registry. Limits also size the history and output budgets. |
| 01_INTAKE | Schemas validate the query and an intake record (task type, modality, constraints, priority). |
| 02/03 | TypeScript port: normalize, detect language, redact PII reversibly (`[EMAIL_1]`), compact history. |
| 04_ROUTING | Task classifier, model selector, cost budget, latency optimizer, fallback across up to 3 providers. Providers that just failed are tried last for 5 minutes. |
| 05_MODEL_LAYER | GPT, Gemini and Grok SDK branches plus `compatible_branch` (Anthropic, Groq, Mistral, OpenRouter, Together). "AZ · Reasoning" uses multi-pass refinement; "AZ · Code" uses the specialist router (`AZ_CODE_PROVIDERS`, default `groq,gemini`). |
| 06_PROMPT_ENGINE | System policy prompt, developer profile per mode, reasoning guardrails, user-prompt validation. |
| 07_TOOLS | `search` retrieves documents/memories from `pipeline-api` when `PIPELINE_API_URL` is set. Tool-call loop (`lib/pipeline/tools.ts`): for questions with arithmetic (`AZ_TOOL_LOOP=always`/`off` to change), the model picks tools step by step as schema-checked JSON (works with every provider), up to 4 steps; results go into the prompt as untrusted data. Registered: `calculator` (everyone), `search` (signed-in, when configured). |
| 08_REASONING | Explore deeply decomposes the question first; code mode + AZ · Reasoning plans the work first. The plan is shown with the answer. |
| 09/10 evidence | With retrieved documents: claims are checked against cited sources (factual + hallucination checks, confidence tag). |
| 06/09/10/11 JSON | `format: "json"` returns a schema-checked `{answer, citations, warnings}` (few-shot + structured output spec). |
| 09 style control | Composer tone picker (Default, Concise, Professional, Friendly, Technical). `style` is a fixed enum mapped to a fixed instruction, so it can't inject prompt text. |
| 11 citations | Source IDs the answer cites (`[doc:…]`, `[web:1]`, `[1]`) are matched to what 07 search retrieved and listed under the answer; unknown IDs add a warning. Only http(s) URLs without credentials become links. Web results (with URLs) need `PIPELINE_WEB_SEARCH=true` plus a Brave key in pipeline-api; stored documents have no URL field yet. |
| 10 quality score | `structure-v1` rubric: non-empty, bounded length, no placeholders, plus source checks when sources were retrieved. It measures structure only, is marked uncalibrated, and is stored with the request metadata; `/insights` shows the helpful rate per score band so it can be compared against 👍/👎. |
| 11 translation | Translate any answer (`POST /api/translate`; en, es, fr, de, ja). |
| 10_VALIDATION | Policy check on input and answer: local phrase filter + OpenAI moderation when `OPENAI_API_KEY` is set (free). Blocked: `422 INPUT_BLOCKED` / `OUTPUT_BLOCKED`. |
| 11/12 | Answer cleanup; the answer must validate as a renderable artifact before delivery. The workspace uses `POST /api/chat/stream` (SSE): `status`/`tool` events while the pipeline runs, then `delta` text only after validation passes, then `final` metadata. Stop cancels provider calls. `/api/chat` still returns the whole answer as JSON. |
| 13_FEEDBACK | 👍/👎 and corrections on answers (`POST /api/feedback`), error logs; admins queue unhelpful answers for review in Operations → Answer feedback. |
| 14_OBSERVABILITY | Traces, metrics, prompt-template log, model performance (`/insights`); audit trail of staff access changes (Operations → Activity). |
| 15_EXTENSIONS | Installed extensions run at `after_preprocess`, `after_model_call`, `before_delivery`. |

**Who may do what.** Requests from this machine (loopback host, loopback forwarded address,
loopback or unset `APP_ORIGIN`) count as the signed-in local user. On a deployed server
(public `APP_ORIGIN`) browsers are guests, and 00_META's rules apply: research mode and
attachments return `403 NOT_PERMITTED` until sign-in exists. Set `LOCAL_SINGLE_USER=false` to
turn the local rule off. IDE tokens are signed-in tenant members.

**What is stored.** `operations_records` (migration 006) holds metadata only (task type,
provider, timings, ratings, redacted corrections), never prompts or answers, and rows expire
after 30–90 days. A browser cookie (`az_uid`) links ratings to the answers that browser got.
For this machine's signed-in account, **chats are saved with their messages** (`chats`, see
below); guests' chats stay in their browser.

**Sidebar (migration 012).** For this machine's signed-in account, the sidebar comes from
`GET /api/sidebar`: groups and items from `sidebar_groups` / `sidebar_items` (edit them in SQL; an
item with `enabled = false` is hidden; Imagine, Automations and Create a bot are seeded disabled
until those features exist), plus the account's `projects` and `chats`. **Chats are saved with
their messages (migration 015)**, owner-scoped; deleting a chat deletes them. Open any saved chat
from the sidebar (Chats → See all, or a project → Show all) or via `GET /api/chats[?projectId=]` and
`GET /api/chats/:id`. Endpoints: `POST /api/projects`, `PATCH|DELETE /api/projects/:id` (deleting
moves its chats to General), `GET|PUT|PATCH|DELETE /api/chats/:id`, and `POST /api/sidebar/import`
(a browser's projects and chats with their messages, uploaded once; it fills gaps and never
overwrites). Chats whose messages were never in this browser fill in when the app is opened in the
browser that has them. Mutations need the app origin. Anyone else (deployed-server
guests) gets 401 and keeps the browser-only sidebar. `npm run check:sidebar` tests the API end to end.

**Projects (migration 013).** Projects are folders in the sidebar: expanding one lists its chats; `+` starts a
chat in it. Project menu: Rename, Share, Edit, Settings, Delete. **Edit** sets name and description
(`PATCH /api/projects/:id`). **Settings** sets *instructions* (sent to the AI with every message in that project:
the chat request carries `projectId`, and the pipeline adds the owner's project instructions like Personalization)
and the *default mode* for new chats. **Share** creates a `#share-project=` link holding the project, its settings
and up to 20 chats; like chat links the content travels in the URL fragment and never reaches the server, and the
recipient chooses whether to add a copy.

**Not wired (need services or decisions):** 07 code execution, browser, files and external APIs
are not registered as tools: they need real services (an isolated sandbox service, never eval or a
Node VM; an SSRF-safe browser service; tenant-scoped storage; allowlisted APIs). 08 hypothesis
testing, verification and self-critique; 09 drafts/variants (need a comparison UI and a token budget)
and the model-rewrite `runStyleControl` (the tone picker uses fixed instructions instead); the 10
weighted `runQualityScore` (needs rubric-graded dimensions). 11 response packaging and 12 final
answer/API response read approved *stored* answers, which the privacy rule rules out. Streaming
sends text after validation, not provider tokens as they are generated.

`AZ_DISABLED_PROVIDERS=openai,xai` removes providers from chat routing while keeping their keys
(OpenAI moderation still works). Optional settings: `AZ_PRICE_<PROVIDER>="in,out"` (USD per million tokens), `AZ_MAX_REQUEST_USD`
(default 1), `AZ_LATENCY_TARGET_MS` (20000), `AZ_DISPATCH_DEADLINE_MS` (60000),
`AZ_MODERATION=off`.

## Plans, accounts, and operations

- **Plans** live in the `plans`, `subscriptions`, and `usage_limits` tables (migrations 008–009);
  `/pricing` and the account menu read them via `/api/plans`, with a 10% discount for the regions in
  `lib/pricing.ts` (from the account's country code, or a trusted proxy's country header).
  Monthly allowances (messages, AZ · Reasoning, Explore deeply) are enforced before any AI call
  (`429 PLAN_LIMIT_REACHED`). Annual prices are seeded at 10 × monthly, and the limits are placeholders;
  adjust both. No payment provider is connected: paid plans become *pending* (awaiting payment).
  Once paid, an admin activates them in Operations → **Awaiting payment**
  (`GET /api/admin/subscriptions/pending`, `POST /api/admin/subscriptions/:id/activate`), or with
  `npm run plan:set -- --plan plus`. Enterprise opens a sales request in the
  support queue.
- **Access rules** (from `subscription-access-rule/`, migration 010): the plan comes from the
  active/trialing subscription (period not ended), features from `plan_entitlements`
  (`enabled` + `monthly_limit`; `usage_limits` is a view over it). Each chat or translation
  reserves its metered features atomically in `usage_counters` before any AI call and is refunded
  if the request fails. A feature off for the plan returns `403 UPGRADE_REQUIRED`; denials are
  logged in `access_audit`. Plus and above include research plans, personalization, and
  attachments. `GET /api/me/access` + `components/use-access.tsx` shape the UI.
- **Billing webhook:** `POST /api/webhooks/billing`, disabled until `BILLING_WEBHOOK_SECRET`
  (32+ chars) is set. Header `X-Billing-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "t.body")>`;
  5-minute replay window; each event `id` applies once. Events `subscription.activated|updated|
  past_due|canceled` with `{ email|accountId, planId, providerSubscriptionId, ... }`. Adapt
  `lib/billing.ts` to your provider. `npm run check:billing` tests it end to end.
- **Accounts:** `npm run account:seed -- --name "..." --email ...` sets this machine's account.
- **Staff:** `npm run staff:create -- --email ... --name "..." --role admin` creates a sign-in
  (one-time password). Staff sign in at `/login`; `/operations` is the complaints workspace and
  links to `/admin`.
- **Admin console (`/admin`):** dashboard, tenants, users (members and live sessions), roles (the
  enforced permission matrix), approvals (no self-approval; stale requests rejected), policies
  (built-in policies plus tenant policies), registry (live providers plus a review list), billing
  (subscriptions, provider usage, budgets) and incidents. Changes go through `/api/admin`, which
  checks role, origin, revision and rate limit and writes the audit log. **Pipeline stages** lists
  every stage module with its real status, configuration and recent metadata; deterministic modules
  have a dry run (`POST /api/admin/pipeline/run`, owners/admins, no AI call, nothing stored). `npm run check:operations` exercises every role boundary end to end.

## A-Zee Search and Deep Research (migration 016)

`/search` (sidebar → A-Zee Search) and `/platform` (the A-Zee architecture with the live status of all 25
blueprint modules). Live web retrieval uses **Tavily**: set `TAVILY_API_KEY` in `.env.local` and restart;
until then the endpoints return `503 SEARCH_NOT_CONFIGURED` and 00_META keeps `live_search` out of scope.

- `POST /api/v1/search/query` `{ query, recency? }`: answer with numbered citations, source dates,
  freshness and relevance. Each claim must quote its source; it is **verified** only when the quote is
  in the retrieved text. Sources, retrieval time, model and verification are recorded (`search_answers`).
- `POST /api/v1/search/verify-claims` `{ claims }`, `POST /api/v1/search/compare` `{ a, b, focus? }`,
  `GET /api/v1/search/sources/:id`, `GET /api/v1/search/status`.
- `POST /api/v1/search/deep-research` `{ question }` → 202; `GET /api/v1/research/jobs[/:id]`,
  `DELETE /api/v1/research/jobs/:id` (cancel), `GET /api/v1/research/jobs/:id/report[?format=md]`.
  Jobs plan sub-questions, search each, extract quoted findings, then report evidence, conflicting
  claims and gaps. Every step is checkpointed: a job interrupted by a restart resumes. One active job
  per account.
- Web content is passed to models as untrusted data. Plan limits, policy checks and routing are the
  same as chat. `npm run check:search` tests it end to end with a local fake Tavily and real models.

## A-Zee Search Index (migration 020, experimental)

`/search` → **My index**: full-text search over documents you add yourself, in collections
(separate workspaces). Readiness: PostgreSQL full-text search is locally tested (unit tests, a browser
test, and `npm run check:search-index` end to end). **Vector search is infrastructure blocked**: the
pgvector extension isn't installed (the status endpoint checks `pg_available_extensions`). Turn the
index off with `AZ_FEATURE_SEARCH_INDEX=off`. It works without `TAVILY_API_KEY`.

- Sources: pasted text, one GitHub file, or one Google Drive document at a time, chosen explicitly.
  Connected accounts are never indexed automatically; connectors stay read-only. **Sync** re-fetches
  one document on request; **Delete** removes it (and its chunks) from the index.
- Indexing: content is normalized (LF, no NULs) and split into chunks that are exact slices of the
  document; each chunk has a generated `tsvector` (English) with a GIN index. Limits: 1 MB per
  document, 1,000 documents and 50 collections per account.
- Updates and duplicates: the same source (or a text edit) with new content replaces all chunks and
  increments `version`; identical content is a no-op; identical text in a collection is not stored
  twice (concurrent ingests are serialized per collection).
- Queries: `websearch_to_tsquery` (quotes, `or`, `-term`; never a syntax error), ranked with
  `ts_rank_cd`, excerpts from `ts_headline`. Each result carries provenance: document, collection,
  source type and URL, version, content hash, indexed time, chunk and character offsets.
- Access: this machine's signed-in account only; every query is filtered by owner (and collection when
  given). Another account's documents and collections return 404. POSTs/PUTs/DELETEs need
  `X-AZee-Request: 1` and the same origin.
- Routes: `GET /api/v1/search/index`, `GET|POST /api/v1/search/index/collections`,
  `DELETE …/collections/:id`, `GET|POST …/documents` (`{ source: "text", title, content }`,
  `{ source: "github", repo, path, ref? }`, `{ source: "google_drive", fileId }` plus `collectionId`),
  `GET|PUT|DELETE …/documents/:id`, `POST …/documents/:id/sync`,
  `GET …/query?q=&collectionId=&limit=`.

## Connectors: GitHub and Google Drive (migration 017, experimental)

`/connectors` (Settings → Connectors) gives the local account **read-only** access to GitHub
repositories and Google Drive documents. Readiness: locally tested against fake providers; not yet
tested against the real GitHub and Google services. Turn it off with `AZ_FEATURE_CONNECTORS=off`.

- Setup (in `.env.local`, then restart): `CONNECTOR_TOKEN_KEY` (32 random bytes, base64:
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`),
  `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
  OAuth callback URL: `${APP_ORIGIN}/api/connectors/<github|google_drive>/callback`.
  For GitHub, a GitHub App with *Contents: Read-only* limits access more tightly than an OAuth App's
  `repo` scope (`GITHUB_SCOPES` overrides the requested scopes).
- OAuth: single-use state stored hashed with a 10-minute lifetime; PKCE (S256) for Google; Drive
  scope `drive.readonly`. Tokens are encrypted with AES-256-GCM, refreshed when expiring, never sent
  to the browser, and revoked at the provider on disconnect.
- Provider calls are GET-only. Every access is logged in `connector_audit` (no tokens recorded).
- Routes: `GET /api/connectors`, `POST /api/connectors/:provider/connect`,
  `GET /api/connectors/:provider/callback`, `DELETE /api/connectors/:provider`,
  `GET /api/connectors/audit`, `GET /api/connectors/github/repos`,
  `GET /api/connectors/github/repos/:owner/:repo/tree|file`, `GET /api/connectors/google_drive/files[/:id]`.
- `npm run check:connectors` runs the full flow against local fake GitHub and Google servers on a
  second app server (port 3003); it refuses to run while real connections exist.

## AI Code Agent (migration 018, experimental)

`/code-agent` (Settings → AI Code Agent): inspect a repository, plan a change, review a proposed
multi-file patch, approve it, apply it, and roll it back. Readiness: locally tested (unit tests, a
browser test, and `npm run check:code-agent` end to end with real models on a throwaway git
repository). **Code execution is infrastructure blocked**: the agent never runs commands or tests;
its plan lists the tests to run by hand. Turn it off with `AZ_FEATURE_CODE_AGENT=off`.

- Setup (server, `.env.local`): `CODE_AGENT_WORKSPACE_ROOT` (absolute folder holding repositories) and
  `CODE_AGENT_REPOS` (comma-separated folder names the agent may use). Nothing else is reachable.
- Path safety: relative paths only; traversal, absolute/UNC paths, NTFS streams, device names and
  trailing dots are refused; a symlink or junction anywhere on the path is refused (checked again
  right before each write). `.git`, `.env*` (except `.env.example`), keys and credential files are
  never read or written, nor listed in the tree or git status; `node_modules`/`.next` aren't written.
- Patches: the model returns exact search/replace edits for planned files only; generating stores
  the patch and writes nothing. The review shows unified diffs, totals and warnings: added secrets
  **block** approval; dependency, CI/deploy, migration and deletion changes are **high** risk and need
  acknowledging. Approval is bound to the patch hash; regenerating drops it.
- Apply: every file must still hash to what the patch was generated against (otherwise
  `409 STALE_PATCH` and the task needs regenerating); files are written via temp file + rename, and a
  failure restores the files already written. Rollback restores only the agent's files from their
  snapshots, and refuses (`409 ROLLBACK_CONFLICT`, nothing changed) if any was edited since. No
  `git reset`/`git clean` is ever used. Git status comes from a fixed read-only `git status` with
  hooks and fsmonitor disabled.
- Routes (`X-AZee-Request: 1` and same origin required for POSTs; tasks are owner-scoped):
  `GET /api/code-agent`, `GET /api/code-agent/repos/:repo/tree|file?path=|git`,
  `GET|POST /api/code-agent/tasks`, `GET /api/code-agent/tasks/:id`, `POST …/:id/plan`,
  `POST …/:id/generate`, `GET …/:id/diff`, `POST …/:id/approve` `{ patchHash, acknowledgeRisks }`,
  `POST …/:id/apply` `{ patchHash }`, `POST …/:id/rollback`, `GET …/:id/audit`.
- Audit (`code_agent_audit`): task, actor, action, outcome, patch hash and paths, never file contents.

## AI providers

Configure one or more of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`,
`GEMINI_API_KEY`, `GROQ_API_KEY`, `MISTRALAI_API_KEY`, `OPENROUTERAI_API_KEY`,
`TOGETHERAI_API_KEY` (Gemini also accepts `GOOGLE_API_KEY`). That order is the default
priority; 04_ROUTING tries up to three per call and moves recently failing providers to the
end (see the pipeline section). Optional model settings are `OPENAI_MODEL`,
`ANTHROPIC_MODEL`, `XAI_MODEL`, `GEMINI_MODEL`, `GROQ_MODEL`, `MISTRAL_MODEL`,
`OPENROUTER_MODEL`, and `TOGETHER_MODEL`.
Provider failures return HTTP 502; no credentials configured returns 503.
`CHAT_DEMO_MODE=true` enables a clearly labeled demo only outside production and
only when no provider keys are configured. It is not enabled by default.

Set `APP_ORIGIN=http://localhost:3000` for browser mutation checks.
Public chat has a shared 20-request/minute budget by default. Only enable
`TRUST_PROXY=true` behind a proxy that replaces incoming forwarding headers.

## Authentication and integrations

The guest workspace does not grant admin access. Admin APIs and extensions use
the same server-validated `az_session` cookie and current database membership.
HTTP development bootstrap remains disabled. An existing authenticated host or
trusted local provisioning code must issue admin sessions.

`POST /api/v1/chat` is mounted in the root app and uses hashed bearer tokens with
the `chat:write` scope. Token provisioning remains an operator-only CLI in
`azee-connect/scripts`. It uses the same provider configuration as browser chat.

## Verification

```sh
npm run typecheck
npm test
npm run build
node scripts/check-runtime.cjs
npm run check:sidebar
npm run test:e2e
```

The last two checks need the local server running. Runtime checks create and
remove isolated database fixtures. Browser tests use installed Microsoft Edge
and mocked provider responses to verify rendering, history, theme, and retries
without consuming AI credits. They do not prove provider billing/access works.
