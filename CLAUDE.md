# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Run the entire application
```bash
docker compose up --build
```
The app is available at http://localhost (port 80 by default). First run downloads images and builds both services (~2–5 min).

### Development (without Docker)
```bash
# Terminal 1 — backend
cd backend && npm install && npm run dev

# Terminal 2 — frontend
cd frontend && npm install && npm run dev
```
Frontend dev server runs on :5173 and proxies `/api` and `/ws` to `localhost:3001`.

### Build
```bash
cd backend && npm run build    # TypeScript → dist/
cd frontend && npm run build   # Vite → dist/
```

### Lint / type-check
```bash
cd backend && npx tsc --noEmit
cd frontend && npx tsc --noEmit
```

## Architecture

### Services (docker-compose.yml)
- **postgres** (16-alpine) — persistent relational store; auto-migrated on backend startup
- **redis** (7-alpine, append-only) — presence state, tab tracking
- **backend** (Node 20, Fastify, port 3001) — REST API + WebSocket
- **frontend** (Vite build → nginx, port 80) — React SPA; nginx proxies `/api/*` and `/ws` to backend

### Backend (`backend/src/`)
- `index.ts` — Fastify server boot; registers all plugins and routes; WebSocket endpoint at `/ws?token=<accessToken>`
- `config.ts` — Zod-validated env vars
- `db/migrate.ts` — runs `migrations/*.sql` on startup; idempotent
- `db/migrations/001_init.sql` — complete schema: users, sessions, rooms, room_members, room_bans, messages, attachments, friendships, user_bans, dm_channels, dm_messages, unread tables
- `redis/presence.ts` — multi-tab presence: `tabs:{userId}` set, `tab_idle:{userId}` set, 90s TTL key per tab
- `ws/broadcaster.ts` — in-memory maps: `userConnections (userId→Set<WebSocket>)` and `roomSubscriptions (roomId→Set<userId>)`
- `ws/handler.ts` — dispatches WS messages; calls broadcaster to fanout events; handles connect/disconnect lifecycle
- `plugins/auth.ts` — `fastify.authenticate` preHandler decorator that validates Bearer JWT
- `routes/auth.ts` — register, login, refresh (rotating refresh token), logout, sessions CRUD, password reset, account deletion
- `routes/rooms.ts` — room CRUD, join/leave, invite, ban/unban, role management
- `routes/messages.ts` — cursor-based pagination (`WHERE created_at < cursor ORDER BY created_at DESC LIMIT 50`), send/edit/delete, unread counter management
- `routes/attachments.ts` — multipart upload with sharp thumbnail generation; access-controlled streaming via `fs.createReadStream`
- `routes/friends.ts` — friend requests, accept/decline/remove, user-to-user ban (freezes DM channel)
- `routes/dm.ts` — DM channel open/create, messages, mark-read

### Auth Flow
- Access token: 15-min JWT (HS256), stored in memory (Zustand `authStore`). Never in localStorage.
- Refresh token: 32-byte opaque hex in httpOnly cookie `refresh_token`. DB stores `argon2id(token)`.
- Session ID stored in a non-httpOnly `sid` cookie to allow the refresh endpoint to look up the session without a full table scan.
- Axios interceptor in `frontend/src/api/client.ts` transparently retries 401s after refreshing.

### WebSocket Protocol
Client connects to `/ws?token=<accessToken>`. On connect the server registers a tab in Redis.

**Client→Server:** `ping`, `tab_active`, `tab_idle`, `join_room {roomId}`, `leave_room {roomId}`, `typing_start {roomId}`, `typing_stop {roomId}`, `mark_read {roomId}`

**Server→Client:** `message_new`, `message_edited`, `message_deleted`, `presence_update {userId, status}`, `typing {roomId, userId, active}`, `room_member_joined/left/banned`, `friend_request`, `dm_new`, `unread_update`

### Presence
Derived from Redis: `offline` if `tabs:{userId}` is empty; `afk` if all tabs are in `tab_idle:{userId}`; else `online`. Frontend `useIdleDetector` hook sends `tab_idle` after 60s of no interaction (mousemove/keydown/scroll/visibilitychange), and `tab_active` on any interaction. Each tab has a 90s TTL key reset by 30s pings.

### Frontend (`frontend/src/`)
- `stores/` — Zustand stores: `authStore` (user+token), `presenceStore` (userId→status), `unreadStore` (roomId/channelId→count), `wsStore` (WebSocket singleton + handler pub/sub)
- `api/client.ts` — axios instance with token injection + 401 refresh interceptor
- `hooks/useInfiniteMessages.ts` — TanStack Query infinite query with WS event patching; `useInfiniteDmMessages` for DMs
- `hooks/useIdleDetector.ts` — 60s idle detection → `tab_idle`/`tab_active` WS events
- `components/layout/AppShell.tsx` — connects WS on mount, renders TopBar + Sidebar + `<Outlet />`
- `components/chat/ChatView.tsx` — room chat: subscribes to room on WS, renders MessageList + MessageInput + MembersPanel + RoomSettingsModal
- `components/chat/MessageList.tsx` — `IntersectionObserver` top sentinel triggers `fetchNextPage`; preserves scroll position when older pages load
- `components/chat/MessageInput.tsx` — multiline textarea, emoji picker, file upload, clipboard paste, typing events
- `components/modals/RoomSettingsModal.tsx` — 5 tabs: Members/Admins/Banned/Invitations/Settings

### Key Database Patterns
- Messages paginated with `WHERE created_at < $cursor ORDER BY created_at DESC LIMIT 50` using index `idx_messages_room(room_id, created_at DESC)`
- DMs use separate `dm_messages`/`dm_attachments` tables; `dm_channels` enforces `user_a < user_b` to prevent duplicate pairs
- Unread counts in `room_unread`/`dm_unread` tables; incremented on new message, reset to 0 on `mark_read`
- Soft deletes on users and rooms (`deleted_at`); messages use `content = NULL + deleted_at` to preserve threading
- File paths stored as `YYYY/MM/{uuid}.ext` relative to `UPLOAD_DIR`; original filename only in DB (prevents path traversal)
