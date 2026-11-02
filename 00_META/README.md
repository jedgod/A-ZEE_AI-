# 00_META ? executable metadata foundations

## Installation
Copy the exported file contents into AZ_AI/ using their exact paths.
npm install zod@^3
npm install -D vitest
npx vitest run 00_META/tests/meta.test.ts
Run your existing TypeScript typecheck.

The source viewer exports actual file bodies, not empty folders.
No build or test execution is claimed by this delivery.

## Folder structure
00_META/
  shared.ts
  index.ts
  config.example.ts
  mission/index.ts
  scope/index.ts
  policies/index.ts
  capability_matrix/index.ts
  model_registry/index.ts
  tests/meta.test.ts
  README.md

## Responsibilities
mission: validated product identity and honesty commitments.
scope: supported operations and deployment environment boundaries.
policies: data-classification and independent-review decisions.
capability_matrix: role and resource-limit checks.
model_registry: validated provider declarations and deterministic selection.
index: a combined server-side preflight.

## Server integration
Import preflight from "@/00_META".
Resolve actor from VERIFIED user auth; do not reuse admin auth for guest chat.
Estimate tokens using the configured model tokenizer and reject oversized bodies.
Resolve classification and policy context from trusted application state.
Load approved model configuration on the server.
Call preflight before invoking provider adapters.
If allowed is false, return a scoped API denial.
If allowed is true, reserve budget and use the returned model server-side.

Invalid configuration throws Zod validation errors: fail startup/config loading
rather than silently relaxing policy.

## Authorization caveats
This layer is pure and does not prove a user was authenticated.
A browser cannot be trusted to supply actor roles, tenant IDs,
classification, reviewer IDs, or approvalValid.
Existing admin services remain authoritative for membership and tenant status.
Admin operations deliberately return USE_ADMIN_SERVICE_AUTHORIZATION rather
than selecting a model.

## Models
config.example.ts is disabled by default.
Replace provider model, limits, prices and readiness with verified values.
Do not enable capabilities that lack actual provider/tool adapters.
No credential values, API keys or executable plugin paths belong in metadata.
Research means reasoning, not live browsing.

## Storage
PostgreSQL/SQLite store canonical identities, sessions, conversations,
approvals, audit and budget reservations elsewhere.
This layer performs no DB queries and supports neither database implicitly.
Version and audit policy changes through the existing control plane.
Estimated provider cost does not enforce a hard spend cap.

## UI
These modules DO NOT render your homepage.
The plain AZ_AI screen in the screenshot is app/page.tsx output.
Replace that page with an actual user UI, keep /admin isolated,
and invoke these modules from user/backend services.

## Deployment follow-up
Freeze/version runtime configuration, run integration tests, use immutable
audit logs, implement data cleanup, edge abuse protection and atomic budgets.
Add further policies for your jurisdiction and actual data processing.
