# Users Admin Console – Full Feature Set

Production-ready implementation with:

- Quick Stats strip
- Saved Views
- Tags (with color)
- Bulk Actions (Make Admin, Suspend, Export)
- Prisma backend (SQLite for dev, PostgreSQL 18 for production)

## Setup

1. Install dependencies:
   ```bash
   npm install @prisma/client
   npm install -D prisma
   npx shadcn@latest add button input table checkbox badge avatar popover card
   ```

2. Create `.env`:
   ```env
   # SQLite (development)
   DATABASE_URL="file:./dev.db"

   # PostgreSQL 18 (production)
   # DATABASE_URL="postgresql://user:password@localhost:5432/azai?schema=public"
   ```

3. Initialize database:
   ```bash
   npx prisma generate
   npx prisma db push
   ```

4. Copy all files into your Next.js project.

## Features Implemented

| Feature | Location | Backend |
|---------|----------|---------|
| Quick Stats | `quick-stats.tsx` | Computed from user list |
| Saved Views | `saved-views.tsx` | Filter params on GET `/api/admin/users` |
| Tags | `tag-picker.tsx` | `POST/DELETE /api/admin/tags` |
| Bulk Actions | `bulk-actions-bar.tsx` | `POST /api/admin/users/bulk` |
| User Table | `users-table.tsx` | Full Prisma query with includes |

## Switching to PostgreSQL 18

1. Change `provider = "postgresql"` in `schema.prisma`
2. Update `DATABASE_URL` in `.env`
3. Run `npx prisma db push` (or `migrate` for production)

All features work identically on both databases.
