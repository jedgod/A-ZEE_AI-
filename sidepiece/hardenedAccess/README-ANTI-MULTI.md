# Anti Multi-Account (Free Tier) – Production Pieces

## Files

| File | Purpose |
|------|---------|
| `migrations/003_device_signals.sql` | Postgres tables (device_signals + free_quota_events) |
| `lib/device-signals.ts` | Helpers: getClientInfo, recordSignal, markQuotaExhausted |
| `app/api/signals/record/route.ts` | Endpoint to record a signal (call on signup / free usage) |
| `app/api/free-tier/check-linked/route.ts` | Check if current free account is linked to exhausted ones |
| `app/admin/linked-accounts/page.tsx` | Simple admin table of linked accounts |
| `app/api/admin/linked-accounts/route.ts` | Admin API for the view |

## Setup

1. Run the migration:
   ```bash
   psql $DATABASE_URL -f migrations/003_device_signals.sql
   ```

2. Adjust imports in the route files to match your existing helpers:
   - `@/lib/auth` → your getServerSession
   - `@/lib/db` → your Postgres client
   - `@/lib/admin-guards` → your requireAdmin

3. On signup and key free-tier actions, call:
   ```ts
   await fetch("/api/signals/record", {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({
       fingerprint: await generateFingerprint(), // client-side
       cookieId: getOrSetCookieId(),
       action: "signup", // or "free_usage"
     }),
     credentials: "include",
   })
   ```

4. Before allowing free usage, call:
   ```ts
   const res = await fetch("/api/free-tier/check-linked?fingerprint=...&cookieId=...")
   const { linked, count } = await res.json()
   if (linked && count >= 2) {
     // show upgrade wall or require verification
   }
   ```

5. When a user exhausts free quota:
   ```ts
   import { markQuotaExhausted } from "@/lib/device-signals"
   await markQuotaExhausted(userId, signalId)
   ```

## SQLite note

The migration is written for PostgreSQL (`INET`, `gen_random_uuid`). For local SQLite:
- Change `INET` to `TEXT`
- Remove `::inet` casts in queries
- Use a different UUID default if needed

## Admin view

Visit `/admin/linked-accounts` (protect with your existing admin auth). It lists accounts that have exhausted free quota and share device signals.
