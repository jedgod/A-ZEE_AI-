# Missing Pieces Added

Notes and persistent Saved Views are now included, following the same auth/CSRF pattern as Tags and Bulk Actions.

## New files

| File | Purpose |
|------|---------|
| `migrations/002_notes_and_views.sql` | `user_notes` and `saved_views` tables |
| `app/api/admin/notes/route.ts` | GET / POST / DELETE notes (admin + CSRF) |
| `app/api/admin/views/route.ts` | GET / POST / DELETE saved views (per-admin) |
| `components/admin/user-notes.tsx` | Inline notes panel for a user |
| `components/admin/saved-views-manager.tsx` | Save / apply / delete custom views |

## Integration

1. Run the new migration:
   ```bash
   psql $DATABASE_URL -f migrations/002_notes_and_views.sql
   ```

2. Adjust the three route imports to match your existing helpers (`getServerSession`, `db`, `requireAdmin`, `verifyCsrf`).

3. In your Users page:
   - Place `<SavedViewsManager currentFilters={...} onApply={...} />` next to your existing view tabs.
   - In the user row (or a detail drawer), render `<UserNotes userId={user.id} />`.

## Current feature status

| Feature | Status |
|---------|--------|
| Quick Stats | Done (your side) |
| URL-based views | Done (your side) |
| Tags | Done |
| Bulk Actions (suspend / unsuspend / export) | Done |
| Notes | Done |
| Persistent Saved Views | Done |
| Bulk “make admin” | Intentionally excluded (use single-user flow) |

All new routes require sign-in + admin permission + CSRF, matching your existing `/api/admin` pattern.
