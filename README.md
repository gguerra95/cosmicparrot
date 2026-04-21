# Hackathon Chat App

A real-time chat application with rooms, direct messages, presence, and file attachments.

## Stack

- **Frontend** — React + Vite + Zustand, served by nginx
- **Backend** — Node 20 + Fastify + TypeScript, REST API + WebSocket
- **Database** — PostgreSQL 16 (auto-migrated on startup)
- **Cache / Presence** — Redis 7

## Quick Start (Docker)

```bash
cp .env.example .env        # edit JWT_SECRET and any other values
docker compose up --build
```

App is available at http://localhost (port 80). First build takes ~2–5 min.

## Development (without Docker)

```bash
# Terminal 1 — backend (port 3001)
cd backend && npm install && npm run dev

# Terminal 2 — frontend (port 5173)
cd frontend && npm install && npm run dev
```

The Vite dev server proxies `/api` and `/ws` to `localhost:3001`.

## Environment Variables

Copy `.env.example` to `.env` and set:

| Variable | Description |
|---|---|
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | Database credentials |
| `JWT_SECRET` | At least 32 characters, keep secret |
| `APP_URL` | Public base URL (used in password-reset emails) |
| `APP_PORT` | Host port to expose (default `80`) |
| `SMTP_*` | Optional SMTP settings for password reset |

## Features

- **Rooms** — create, join, invite, ban, role management (owner / admin / member)
- **Direct Messages** — one-to-one channels with unread counters
- **Real-time presence** — online / afk / offline derived from Redis tab tracking
- **Typing indicators** — per-room, debounced
- **File attachments** — images (with thumbnails via sharp), general files up to 20 MB
- **Auth** — JWT access tokens (15 min) + rotating httpOnly refresh tokens (7 days)
- **Multi-tab support** — each browser tab tracked independently in Redis

## Project Structure

```
backend/src/
  index.ts          # Fastify server boot
  config.ts         # Zod-validated env vars
  db/               # Migrations
  redis/            # Presence logic
  routes/           # auth, rooms, messages, attachments, friends, dm
  ws/               # WebSocket handler + broadcaster

frontend/src/
  api/              # Axios client with 401 refresh interceptor
  stores/           # Zustand: auth, presence, unread, ws
  hooks/            # useInfiniteMessages, useIdleDetector
  components/       # AppShell, ChatView, MessageList, MessageInput, modals
```

## Scripts

```bash
# Type-check
cd backend && npx tsc --noEmit
cd frontend && npx tsc --noEmit

# Build
cd backend && npm run build
cd frontend && npm run build
```
