# Host auth/session compatibility

This compatibility layer keeps the route layer runnable in a repo without a full Auth.js adapter.

## How it works
- `az_session` cookie stores an opaque token
- `lib/admin/host-session.ts` hashes that token and resolves the session in Postgres
- `lib/admin/host-auth.ts` converts it into a route-safe actor object
- existing host apps can replace `getHostSession()` with their own verified session lookup

## Required production replacement
In a real host app, replace `getHostSession()` with the application’s canonical user and tenant resolver, and keep the route boundary strict about tenant ownership and platform admin checks.
