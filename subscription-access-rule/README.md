> **Integrated into AZ_AI.** This design now runs inside the main Next.js app, so this standalone
> Express server doesn't need to run. Don't apply `sql/schema.sql` to the AZ_AI database: its
> `users`/`plans`/`subscriptions` definitions differ from the app's. Equivalents: schema →
> `migrations/010_access_rules.sql`; `resolvePlan`/`entitlement`/`requireFeature`/`consumeQuota` →
> `lib/plans.ts`; `/api/me/access` → `app/api/me/access/route.ts`; `useAccess` →
> `components/use-access.tsx`; billing webhook → `lib/billing.ts` + `app/api/webhooks/billing/route.ts`.

# Subscription-Based Access Control System

Server-side entitlement authorization for Free / Go / Plus / Pro / Business / Enterprise (names, prices, and allowances are fully configurable).

## Architecture

```
React Client → Express API (JWT + entitlement middleware) → PostgreSQL
                     ↑
              Billing webhook (signature-verified)
```

- Plans, features, and monthly limits live in the database — change them without redeploying code.
- Every protected route runs `authenticate` + `requireFeature` (or `consumeQuota`) on the server.
- Admin role is separate from paid plans.

## Quick start

```bash
cp .env.example .env
# edit DATABASE_URL and JWT_SECRET (min 32 chars)

npm install
psql "$DATABASE_URL" -f sql/schema.sql
npm run build
npm start
```

## Endpoints

| Method | Path                      | Auth          | Purpose                              |
|--------|---------------------------|---------------|--------------------------------------|
| GET    | /health                   | none          | Liveness                             |
| GET    | /api/plans                | none          | Public plan catalog                  |
| GET    | /api/me/access            | JWT           | Current plan + entitlements          |
| GET    | /api/articles/basic       | JWT + feature | Basic content                        |
| GET    | /api/articles/premium     | JWT + feature | Premium content                      |
| POST   | /api/reports              | JWT + quota   | Consume monthly AI-report allowance  |
| GET    | /api/admin/users          | JWT + admin   | User list (admin only)               |
| POST   | /api/webhooks/billing     | signature     | Payment provider events (stub)       |

## Responses

- `200` — authorized
- `401` — missing/invalid JWT
- `403` — `UPGRADE_REQUIRED` (feature not entitled)
- `429` — `QUOTA_EXCEEDED` (monthly limit reached)

## JWT requirements

Issued by your trusted identity system:

- Algorithm: HS256
- Issuer: value of `JWT_ISSUER` (default `subscription-access`)
- Audience: value of `JWT_AUDIENCE` (default `subscription-api`)
- `sub`: existing `users.id`

## Next steps

1. Implement billing webhook signature verification and idempotent subscription updates.
2. Build an admin dashboard to edit plans / entitlements / limits without code changes.
3. Add frontend React components that call `/api/me/access` and gate UI accordingly (never trust the client alone).
