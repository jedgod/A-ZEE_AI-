# User Icon Rail – Production Ready

Full implementation for the logged-in user rail (no Settings).

## Rail items

| Icon | Label | Route | API |
|------|-------|-------|-----|
| Sparkles | New Chat | `/chat/new` | `POST /api/chats` |
| Clock | Recent | `/chat/recent` | `GET /api/chats` |
| Star | Favorites | `/chat/favorites` | `GET/POST/DELETE /api/favorites` |
| Folder | Projects | `/projects` | `GET/POST /api/projects` |
| Search | Search | `/search` | `GET /api/search?q=` |
| Bell | Notifications | `/notifications` | `GET/PATCH /api/notifications` + unread count |
| Library | Prompt Library | `/library` | `GET/POST /api/prompts` |

## Setup

1. Install:
   ```bash
   npm install @prisma/client
   npm install -D prisma
   npx shadcn@latest add button tooltip badge
   ```

2. `.env`:
   ```env
   # SQLite (dev)
   DATABASE_URL="file:./dev.db"

   # PostgreSQL (production)
   # DATABASE_URL="postgresql://user:password@localhost:5432/azai"
   ```

3. Initialize:
   ```bash
   npx prisma generate
   npx prisma db push
   ```

4. Drop `<UserIconRail />` into your main logged-in layout. It is fixed at `left-0` with width `68px`. Add `ml-[68px]` to the main content.

5. Adjust the `getServerSession` import in all API routes to match your auth helper.

## Files

- `components/user-icon-rail.tsx` — Rail component with unread badge
- `prisma/schema.prisma` — Models for Chat, Project, Favorite, Notification, Prompt
- `app/api/*` — Authenticated routes for every rail item
- `lib/prisma.ts` — Prisma client

All routes require a valid session. Switch the Prisma provider to `postgresql` for production.
