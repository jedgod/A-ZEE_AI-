# 15_EXTENSIONS — Integration guide

## Stack
Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui,
Zod 3, PostgreSQL or SQLite.

## Install in an existing Next.js application
npm install zod@^3 server-only pg better-sqlite3
npm install -D @types/pg @types/better-sqlite3
npx shadcn@latest add button badge

Copy exported files into their indicated paths.
Use the host application's existing layout, Tailwind setup,
TypeScript configuration, and @/* import alias.

## Environment
APP_ORIGIN=https://your-app.example
DB_DIALECT=sqlite
SQLITE_PATH=extensions.sqlite

For PostgreSQL:
DB_DIALECT=postgresql
DATABASE_URL=your-server-only-connection-string

Never commit secrets. Use your deployment secret manager.

## Apply ONE migration
sqlite3 extensions.sqlite < migrations/extensions.sqlite.sql
or:
psql "$DATABASE_URL" -f migrations/extensions.postgresql.sql

## Required host integration
Implement lib/extensions/auth.ts with your session provider.
Add CSRF/session protections, admin page protection, and rate limits.
Resolve permissions from your server authorization system.
Review residency and data-sharing implications of grants.

## Register reviewed code
Add a static Extension import to registry.ts.
Update its version for every behavior change.
Tenant installations pin the approved version; updates need reapproval.

## Pipeline hook
import { runHooks } from "@/lib/extensions/hooks";
const metadata = await runHooks(actor, "after_model_call", {
  output: validatedOutput,
}, requestSignal);

Store metadata under a separate extension namespace.
Do not use it to override authorization or validation decisions.

## Important limits
This is a built-in extension scaffold, not a marketplace installer.
No package uploads or arbitrary entrypoints are supported.
In-process code is trusted; AbortSignal is cooperative.
Use a hardened sandbox service for third-party extensions.
Add transactional configuration/audit writes before production.
Database audit tables are not tamper-proof.

## Suggested tests
- Unauthenticated catalog/write calls are denied.
- Cross-tenant installations never appear.
- Missing caller permissions block execution.
- Version changes require reapproval.
- Unknown extensions and grants are rejected.
- Hooks cannot overwrite core fields.
- Oversized outputs and metadata are rejected.
- Extension errors fail closed.
- SQL parameters remain bound.

## Existing workspace integration
Category index.ts files re-export the canonical implementations in lib/extensions. See policies/SAFETY.md for required controls and limitations. The old arbitrary registration and identity-mutating hooks have been replaced. The new audit table is extension_audit_events, avoiding collision with the earlier extension_events schema; old records are not deleted or migrated. Root SQL files mirror migrations/extensions.*.sql; apply only one copy. logExtensionEvent persists validated operational fields and does not accept arbitrary payloads.
