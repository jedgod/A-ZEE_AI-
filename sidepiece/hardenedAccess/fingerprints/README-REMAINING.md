# Remaining Anti-Multi-Account Pieces

## 1. Client fingerprint

`lib/fingerprint.ts`

```ts
import { generateFingerprint, recordDeviceSignal } from "@/lib/fingerprint"

// On signup / login / first free usage in a session:
await recordDeviceSignal("signup") // or "login" / "free_usage"
```

The hash matches the simple browser-properties approach you described.

## 2. Allow override

- Migration: `migrations/028_account_overrides.sql`
- Route: `app/api/admin/linked-accounts/allow/route.ts`
- UI: updated `app/admin/linked-accounts/page.tsx` (includes “Allow” button + CSV export)

The override is audited and always wins over automatic checks (implement the “always wins” logic in your wall check by consulting `account_overrides`).

## 3. Admin filter + export

The linked-accounts page now has:
- Search box (email / name)
- Export CSV button
- Per-row “Allow” action

## 4. “Your data” notice

Copy from `docs/your-data-notice.md` into your in-app privacy / data section.

## Integration checklist

1. Run `028_account_overrides.sql` (or add the table to your migration system).
2. Adjust imports in the allow route to match your auth/CSRF helpers.
3. In your free-tier wall check, also query `account_overrides` — if `allowed = true`, skip the wall.
4. Call `recordDeviceSignal(...)` at signup and login.
5. Paste the notice text into your UI.
