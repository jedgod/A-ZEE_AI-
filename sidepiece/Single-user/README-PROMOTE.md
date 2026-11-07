# Single-user Promote to Admin

Secure promotion flow with explicit confirmation and audit logging.

## Files

| File | Purpose |
|------|---------|
| `app/api/admin/users/promote/route.ts` | POST endpoint (auth + CSRF + admin check) |
| `components/admin/promote-to-admin.tsx` | Confirmation dialog button |

## Security

- Requires sign-in, CSRF, and admin permission.
- Explicit `confirm: true` flag required in the body.
- Cannot promote yourself.
- Rejects if the target is already an admin.
- Writes to `admin_audit_log` with target name, email, and previous role.
- Single-user only (no bulk).

## Integration

1. Adjust the imports in the route to match your existing helpers.
2. In the user row actions (or detail drawer), render:

```tsx
<PromoteToAdmin
  userId={user.id}
  userName={user.name}
  userEmail={user.email}
  currentRole={user.role}
  onSuccess={refetch}
/>
```

3. Requires the Shadcn `alert-dialog` component:

```bash
npx shadcn@latest add alert-dialog
```

The dialog shows the user’s name and email and requires a second click to confirm.
