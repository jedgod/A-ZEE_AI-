# Admin runtime bootstrap

This adds the missing runnable pieces:
- middleware protection for /admin and /api/admin
- /api/admin/me for session verification
- /api/admin/session/bootstrap for local development only
- a minimal admin landing route

## Assumptions
- PostgreSQL supports `gen_random_uuid()` via pgcrypto or equivalent UUID generation.
- The host repo already includes the admin schema and service layer.
- The host app sets `DATABASE_URL`.
- `az_session` is the compatibility cookie used by the route factory.

## Production note
Replace the bootstrap endpoint with your real auth provider and remove
the development session issuer before shipping.

## Host app wiring

If you want the admin bundle to run inside this repository:
- ensure `app/layout.tsx` exists
- ensure `app/page.tsx` exists
- keep `app/admin/layout.tsx` in place
- keep `middleware.ts` at repo root
- keep `lib/admin/core.ts` and `lib/admin/host-session.ts` as the canonical session layer

The `app/api/admin/logout` and `app/api/admin/bootstrap` alias routes are optional convenience routes.
They simply forward to the session endpoints.
