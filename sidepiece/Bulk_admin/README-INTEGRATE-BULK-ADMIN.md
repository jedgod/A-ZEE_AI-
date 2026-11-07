# Bulk Admin Integrated into Main UI

The bulk Promote to Admin button is now part of the floating bulk actions bar.

## What changed

`components/admin/bulk-actions-bar.tsx` now includes:

- Suspend
- Unsuspend
- Export
- **Promote to Admin** (opens the typed-confirmation dialog)
- Clear selection

When one or more rows are selected, the bar appears at the bottom of the screen with all actions.

## Usage in your Users page

```tsx
<BulkActionsBar
  selected={selected}
  onClear={() => setSelected([])}
  onActionComplete={() => {
    setSelected([])
    refetch()
  }}
/>
```

No other changes are required. The promote dialog still requires typing `PROMOTE` before it will execute.

## Files to copy

- `components/admin/bulk-actions-bar.tsx` (updated)
- `components/admin/bulk-promote-to-admin.tsx` (already created)
- `app/api/admin/users/bulk-promote/route.ts` (already created)

The bar is self-contained and uses the same auth/CSRF pattern as the other bulk actions.
