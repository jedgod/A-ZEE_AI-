# Bulk Promote to Admin

Stronger safeguards than the single-user flow.

## Files

| File | Purpose |
|------|---------|
| `app/api/admin/users/bulk-promote/route.ts` | POST endpoint |
| `components/admin/bulk-promote-to-admin.tsx` | Confirmation dialog with typed phrase |

## Safeguards

- Sign-in + CSRF + admin permission required
- Must type the exact phrase `PROMOTE` (both client and server check)
- Maximum 20 users per request
- Excludes the current admin (cannot promote yourself)
- Only promotes users who are not already admins
- Full audit log with count and list of targets (name, email, previous role)
- No silent bulk path

## Integration

1. Adjust route imports to match your existing helpers.
2. In the bulk actions bar (or next to it), render:

```tsx
<BulkPromoteToAdmin
  selected={selected}
  onSuccess={() => {
    setSelected([])
    refetch()
  }}
/>
```

3. Requires the Shadcn `alert-dialog` component (same as the single-user version).

The dialog forces the admin to type `PROMOTE` before the button becomes active.
