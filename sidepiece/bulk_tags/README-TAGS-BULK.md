# Tags + Bulk Actions (adapted to your system)

These files are written to plug into your existing admin auth, CSRF, and Postgres setup.

## Files

| File | Purpose |
|------|---------|
| `migrations/001_tags_and_bulk.sql` | Postgres tables for tags + audit log |
| `app/api/admin/tags/route.ts` | Add/remove tags (auth + CSRF + admin check) |
| `app/api/admin/users/bulk/route.ts` | Bulk suspend / unsuspend / export (auth + CSRF) |
| `components/admin/tag-picker.tsx` | Inline tag UI for the user table |
| `components/admin/bulk-actions-bar.tsx` | Floating bar when rows are selected |

## Security notes

- Both routes call your existing `getServerSession`, `verifyCsrf`, and `requireAdmin`.
- **Bulk “make admin” is intentionally excluded.** Promoting users to admin should stay a single-user action with confirmation, not a bulk operation.
- Self-action is blocked (you cannot suspend yourself via bulk).
- Max 100 users per bulk request.
- Audit log writes to `admin_audit_log` on every bulk action.

## Integration steps

1. Run the migration:
   ```bash
   psql $DATABASE_URL -f migrations/001_tags_and_bulk.sql
   ```

2. Adjust the imports in the two route files to match your actual helpers:
   - `@/lib/auth` → your session helper
   - `@/lib/db` → your Postgres client
   - `@/lib/admin-guards` → your permission + CSRF helpers

3. In your Users page/table:
   - Add a checkbox column and track `selected: string[]`.
   - Render `<TagPicker userId={user.id} tags={user.tags} onChange={refetch} />` in the Tags column.
   - Render `<BulkActionsBar selected={selected} onClear={() => setSelected([])} onActionComplete={refetch} />`.

4. When fetching users, join tags:
   ```sql
   SELECT u.*, COALESCE(json_agg(t.*) FILTER (WHERE t.id IS NOT NULL), '[]') AS tags
   FROM users u
   LEFT JOIN user_tags ut ON ut.user_id = u.id
   LEFT JOIN tags t ON t.id = ut.tag_id
   GROUP BY u.id
   ```

## What was deliberately left out

- Bulk “make admin” (needs explicit single-user confirmation + stronger audit).
- User-saved custom views (you already have URL-based views; persistent saved views can come later).
- Notes (can be added the same way if you want them next).
