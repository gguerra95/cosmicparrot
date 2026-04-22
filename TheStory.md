# The Story of the Hackathon Chat App

*A tale of requirements, architecture, and the craft of building something real — fast.*

---

## Prologue: The Brief Arrives

It started, as so many software stories do, with a document.

Not a vague email. Not a one-line Slack message. A proper, thirteen-page requirements document — **"Online Chat Server — Requirements"** — landed in the repository like a gauntlet thrown on a table. Read it, understand it, build it. The clock was running.

The document painted a familiar picture: a **classic web-based chat application**, reminiscent of the IRC rooms and early web messengers that defined a generation of internet culture. Nothing revolutionary. Nothing exotic. Just a well-specified, unambiguous set of rules:

- User registration and authentication, with password hashing and recovery
- Public and private chat rooms, with a full permission hierarchy
- One-to-one personal messaging between friends
- File and image sharing with access control
- Presence indicators: online, AFK, offline — across multiple browser tabs
- Unread message counters, typing indicators, infinite scroll through history
- Up to **300 simultaneous users**, rooms with up to **1,000 participants**, response time under **3 seconds**

At the bottom, almost as an afterthought, a stretch goal: *Jabber protocol support*. Federation between servers. Load tests with 50+ clients on each side, messaging back and forth.

The requirements were complete, well-structured, and accompanied by wireframe ASCII art that sketched exactly what the UI should look like — a left sidebar with rooms and contacts in accordion style, a central message area, a right panel showing room members and their presence dots.

The brief was clear. The scope was not small. It was time to think.

---

## Chapter One: Choosing the Battlefield

Before a single line of code is written, there is always that moment of stillness — the moment where you choose your weapons.

The requirements called for real-time communication, persistent storage, presence tracking across multiple browser tabs, file uploads with thumbnail generation, and a proper deployment story. The tech stack needed to be capable but also fast to work with. Speed of development mattered as much as performance under load.

The decisions came quickly, each one justified by the constraints:

**Backend: Node.js 20 with Fastify and TypeScript.**

Fastify was the right call here. It is not Express — it is faster, plugin-based, and has first-class TypeScript support. The plugin ecosystem for exactly what was needed — cookies, CORS, multipart uploads, WebSockets, rate limiting, Helmet security headers — is mature and works out of the box. TypeScript would prevent entire categories of bugs before they could happen: no `undefined is not a function`, no silent type coercions, no missing property errors in production.

**Database: PostgreSQL 16.**

There was never serious debate about this. The data model was relational through and through: users have sessions, sessions belong to users, rooms have members who have roles, messages belong to rooms, friendships are bidirectional relationships, DM channels enforce uniqueness constraints. PostgreSQL handles all of this elegantly, and its partial indexes — a feature that not every team remembers to use — would be valuable for filtering soft-deleted records without sacrificing query performance.

**Cache and Presence: Redis 7.**

Presence is a fundamentally ephemeral problem. Whether a user has any open browser tabs, whether those tabs are idle — this state is volatile, sub-second in significance, and would be expensive to poll from a relational database hundreds of times per second. Redis, with its sets and TTL keys, was purpose-built for exactly this kind of ephemeral, high-frequency state.

**Frontend: React with Vite, Zustand for state, TanStack Query for server state.**

React for the UI. Vite because its development experience is genuinely better than Webpack-era alternatives. Zustand because it is the pragmatic choice for global client state: no boilerplate, no reducers, no ceremonies — just stores. TanStack Query for the infinite scroll pagination of messages, because cursor-based infinite queries are where it truly shines.

**Deployment: Docker Compose.**

The requirements were explicit: the project must be buildable and runnable with `docker compose up` in the root folder. Four services, orchestrated cleanly: PostgreSQL, Redis, the Node backend, and an nginx server to serve the pre-built React frontend and proxy API and WebSocket traffic.

The stack was set. The war council was over. Time to build.

---

## Chapter Two: The Foundation — Database and Migrations

Every building starts below ground, and this one was no different.

The database schema — a single SQL migration file, `001_init.sql` — became one of the most carefully considered pieces of the entire project. A schema written hastily becomes a prison you live in for the rest of the project's life.

The design choices were deliberate:

**UUIDs as primary keys, generated by `pgcrypto`.** No sequential integers that leak record counts. No collision risk in distributed inserts. Every table got `gen_random_uuid()` as its default.

**Soft deletes on users and rooms.** A `deleted_at` timestamp column on both tables. Deleting a user or room does not actually remove the row — it tombstones it. This means foreign key constraints remain intact, history is preserved for auditing, and the hard delete of files and messages can happen in a controlled, explicit way.

**Messages use a special soft-delete pattern.** When a message is deleted, its `content` is set to `NULL` and `deleted_at` is stamped. The row survives. This preserves message threading — if someone replied to a message that was later deleted, the reply chain is not broken.

**The DM channel table enforces `user_a < user_b`.** A small but important invariant: the two participants in a direct message channel are always stored with the lexicographically smaller UUID in the `user_a` column. This makes it impossible to create duplicate channels for the same pair of users, enforced at the database level with a unique constraint.

**Cursor-based pagination, indexed properly.** The messages table got `idx_messages_room(room_id, created_at DESC)` — a composite index that makes the core query pattern — `WHERE room_id = $1 AND created_at < $cursor ORDER BY created_at DESC LIMIT 50` — execute as a fast index scan rather than a table scan, even against tables with tens of millions of rows.

**Unread counters as a table, not a column.** Room unread counts live in `room_unread(user_id, room_id, count)`. DM unread counts live in `dm_unread(user_id, channel_id, count)`. Incrementing on insert, resetting on `mark_read`. Clean, queryable, joinable — and critically, not tangled into the messages table itself.

The migration runner, `db/migrate.ts`, was written to be idempotent. On every server startup, it scans the `migrations/` directory, compares against a `schema_migrations` table to see what has already been applied, and runs only the new ones. Zero-downtime deployments would be possible. Restarting the container would never re-run a migration that had already succeeded.

---

## Chapter Three: The Auth Tower

Authentication is the front door of any application. Get it wrong and nothing else matters.

The design chosen here was dual-token: a short-lived **access token** and a long-lived **refresh token**, implemented to the letter of modern security best practice.

**Access tokens** are JWTs signed with HS256. They carry the user ID, session ID, and username as claims. They expire in 15 minutes. They are never stored in `localStorage` — the decision was to keep them in memory only, in Zustand's `authStore`. A tab refresh loses the access token, but the refresh token brings it back silently.

**Refresh tokens** are 32-byte cryptographically random hex strings, generated with Node's `crypto.randomBytes`. They are *never stored in plain text in the database*. What the database stores is `argon2id(token)` — the same password hashing algorithm used for user passwords. Even if the sessions table were fully compromised, no valid refresh tokens would be exposed. The token is delivered to the browser as an `httpOnly` cookie, meaning JavaScript cannot read it — XSS attacks cannot steal it.

A second, non-`httpOnly` cookie — `sid` — carries just the session ID. This is a pragmatic optimization: the refresh endpoint needs to find the correct session row quickly, without doing a full table scan against the `refresh_token_hash` column for every refresh call. With `sid` available to the client, the lookup becomes a primary key point query — fast and cheap.

**Token rotation** happens on every refresh. When a client exchanges a refresh token for a new access token, the old refresh token is invalidated and a new one is issued. A stolen refresh token can only be used once before it is rotated away. The window of exploitation is minimal.

The axios client in the frontend had an interceptor that transparently handled the 401 → refresh → retry cycle. From the perspective of any component or API function, tokens simply worked. The machinery was invisible.

Password hashing used `argon2id` — the winner of the Password Hashing Competition, resistant to both GPU-based brute force and side-channel attacks. Password resets generated a 32-byte random token, hashed it for storage, and sent the raw token to the user's email via a configurable SMTP service.

---

## Chapter Four: Presence — The Elegant Problem

Of all the technical challenges in the requirements, the **presence system** was the one that required the most careful thought. Not because it is complicated in theory, but because it has subtle edge cases that can make a naive implementation embarrassingly wrong in production.

The requirement was specific:

> A user is considered AFK if they have not interacted with any of their open browser tabs for more than 1 minute. If the user is active in at least one tab, they are considered online. A user becomes offline only when all browser tabs are closed.

*All browser tabs.* Not just one. This meant the presence system needed to track tabs individually.

The solution lived in Redis and was beautifully simple once you saw it:

For each user, three Redis data structures:

1. **`tabs:{userId}`** — a Redis Set containing the IDs of all currently open browser tabs for that user.
2. **`tab_idle:{userId}`** — a Redis Set containing the IDs of tabs that have gone idle (no interaction for 60 seconds).
3. **`tab_ttl:{userId}:{tabId}`** — a key with a 90-second TTL, reset by a 30-second ping from the client. When this key expires, Redis TTL expiry triggers the tab to be removed from the active set.

Deriving presence from these three structures is a single function, elegant in its logic:

```
if tabs:{userId} is empty         → offline
if tab_idle:{userId} ≥ tabs:{userId} → afk  (all tabs idle)
otherwise                          → online
```

On the frontend, `useIdleDetector.ts` listened to `mousemove`, `keydown`, `scroll`, and `visibilitychange` events. After 60 seconds of silence on all those channels, it sent a `tab_idle` WebSocket message. On any interaction, it sent `tab_active`. Every 30 seconds, regardless of activity, it sent a `ping` to reset the TTL key.

A background process, `presenceWatcher.ts`, used Redis keyspace notifications to listen for TTL expirations. When a tab's TTL key expired — meaning the tab had not sent a ping in over 90 seconds — the watcher removed it from the tabs set and recomputed presence. If presence changed, it broadcast a `presence_update` event through WebSocket to all users who cared.

The result was a presence system that was correct, low-latency, and nearly self-healing — if a browser crashed, tabs would naturally expire and the user would go offline within 90 seconds.

---

## Chapter Five: The Real-Time Heart — WebSockets

The WebSocket layer was the nervous system of the application.

The entry point was simple: `GET /ws?token=<accessToken>`. The server verified the JWT, extracted the user ID and username, and handed the socket to `handleConnection()`. From that point, the socket lived in an in-memory map.

The **broadcaster** (`ws/broadcaster.ts`) maintained two maps:

- `userConnections: Map<userId, Set<WebSocket>>` — one user can have multiple tabs, each with its own WebSocket connection.
- `roomSubscriptions: Map<roomId, Set<userId>>` — which users are currently subscribed to which rooms.

The broadcast functions were precise: `sendToUser()` delivers to all tabs of a specific user. `broadcastToRoom()` delivers to all members currently subscribed to a room, with an optional `excludeUserId` for the sender. `broadcastToUsers()` takes an arbitrary list — used for presence updates and friend notifications.

The WebSocket handler processed incoming messages in a dispatch table:

- `ping` — reset the tab's TTL in Redis
- `tab_active` / `tab_idle` — update the idle set in Redis, potentially broadcast presence change
- `join_room` / `leave_room` — add or remove the user from a room's subscription set
- `typing_start` / `typing_stop` — fanout a `typing` event to other room members
- `mark_read` — reset the unread counter for the user in that room, send an `unread_update` back

On disconnect, the handler cleaned up everything: removed the connection from `userConnections`, unsubscribed from all rooms, unregistered the tab from Redis. A clean teardown meant no ghost connections leaking memory.

The client-side `wsStore` managed a singleton WebSocket connection across the entire application. It automatically reconnected after 3 seconds if the connection dropped. It dispatched incoming messages to two tiers: global handlers for `presence_update` and `unread_update` that wrote directly into Zustand stores, and component-level handlers registered via `addHandler()` that components could subscribe to and unsubscribe from in their effect cleanup.

---

## Chapter Six: Rooms — The Social Graph

Rooms were the social heart of the application. They came with a permission model that had to be precise.

Every room had an **owner**, zero or more **admins**, and zero or more **members**. The owner was always an admin and could not be demoted. Admins could ban members, remove members, manage other admins (but not the owner), view the ban list, and delete messages. The owner could do everything an admin could, plus delete the room itself.

Bans were permanent until explicitly revoked. A banned user could not rejoin the room and immediately lost access to all messages and attachments in that room — not just future messages, but the entire history. This was enforced at the API level: every message and attachment endpoint checked membership before responding.

Room invitations were the mechanism for private rooms. A member could invite any registered user by username. The invited user would receive a `room_member_joined` event via WebSocket when they accepted.

The **public room catalog** was paginated and searchable. It showed only rooms where `is_private = FALSE AND deleted_at IS NULL`, sorted by creation date descending. A simple search on room name used PostgreSQL's `lower(name) LIKE lower($1) || '%'` pattern, hitting the `idx_rooms_name` index.

Room deletion was the nuclear option. When an owner deleted a room, the backend did not merely set `deleted_at`. It issued real DELETEs — cascading through messages, attachments, and files on disk. The `sharp`-generated thumbnails were cleaned up too. Nothing survived a room deletion except the memory of having been there.

---

## Chapter Seven: Messages, Infinite Scroll, and History

The messaging system was built around two principles: **cursor-based pagination** and **optimistic UI patching via WebSocket events**.

The cursor for pagination was `created_at` — a timestamp. Each page request asked for the 50 messages with a `created_at` before the last message of the previous page. This is the correct approach for chat history: stable ordering, no page drift when new messages arrive, compatible with database indexes.

On the frontend, TanStack Query's `useInfiniteQuery` managed the paginated message history. The hook held all pages in memory, and when the user scrolled to the top, an `IntersectionObserver` sentinel element triggered `fetchNextPage()`. A careful implementation preserved scroll position when older messages loaded — without the correct math, the viewport would jump as the DOM expanded upward, which is disorienting.

WebSocket events patched the query cache in real-time:
- `message_new` prepended a new message to the first page if the user was in that room
- `message_edited` found the message by ID across all cached pages and updated it in-place
- `message_deleted` replaced the message's content with a `[deleted]` placeholder

This meant messages felt instant. The sender saw their own message appear immediately through the WebSocket echo. Other room members saw it within the guaranteed-under-3-second delivery window required by the non-functional requirements.

Message editing was available to authors only. Deleted messages were soft-deleted — content set to NULL, row preserved. The UI showed `[message deleted]` in muted text. Room admins could delete any message. Authors could only delete their own.

The `MessageInput` component handled multiline text (Shift+Enter for newlines, Enter to send), an emoji picker, file upload via button click, clipboard paste interception for images, and reply-to context. Typing events were debounced: `typing_start` fired on first keypress, `typing_stop` fired when the user stopped typing for 2 seconds or sent the message.

---

## Chapter Eight: Files — Security First

File handling is where many chat applications make their worst mistakes. Serving files without access control, storing files with user-controlled paths, accepting arbitrary MIME types — each is a category of vulnerability.

This implementation was careful.

**Upload**: Files were received as multipart form data via `@fastify/multipart`. The backend generated a new UUID for each file and computed a storage path as `YYYY/MM/{uuid}.ext` — derived entirely from server-side values, never from the user's filename. The original filename was stored in the database for display and download purposes, but it had no relationship to the file's location on disk. Path traversal was structurally impossible.

**Images**: Image attachments were processed through `sharp`, a native Node.js library wrapping libvips. Sharp generated a thumbnail at 400×400 max, stored alongside the original. Generating thumbnails server-side meant the frontend could show previews without downloading the full original.

**Access control**: No attachment was served directly by the filesystem. Every download went through an API endpoint (`GET /api/v1/rooms/:roomId/attachments/:id/download`) that first verified the requesting user was a current member of the room. If they had been banned or had left, the endpoint returned 403. The file content was streamed via `fs.createReadStream`, with the correct `Content-Disposition` header set to the original filename for proper browser download behavior.

**Size limits**: Images were capped at 3 MB. All other files were capped at 20 MB. These limits were enforced at the multipart parser level in Fastify, before any file data reached application code.

---

## Chapter Nine: Friends, DMs, and the Sociology of the System

The friends and direct messaging systems were where the social graph of the application lived.

Friend requests could be sent by username from any room's member list or from the contacts page. A request could include optional text — "Hey, we both seem to be in the engineering room often, want to connect?" Requests required acceptance by the recipient. No auto-friending.

The user-to-user ban was implemented with care for its edge cases. When User A bans User B:
- Their friendship is terminated
- The DM channel between them is "frozen" — existing messages remain visible as read-only history, but no new messages can be sent
- Pending friend requests between them are cancelled

The DM channel table enforced `user_a < user_b` at the database level. Every time a DM channel was opened, the backend computed `min(userId1, userId2)` and `max(userId1, userId2)` before querying — guaranteeing the same channel was returned regardless of which user initiated the lookup.

DM messages mirrored room messages in structure and behavior, stored in separate `dm_messages` and `dm_attachments` tables. Unread counters, infinite scroll, WebSocket patching — all the same machinery applied.

---

## Chapter Ten: The Frontend Shell

The frontend was a React single-page application that followed a clean architectural model:

At the top, `AppShell.tsx` — mounted when the user was authenticated. It established the WebSocket connection on mount, disconnected it on unmount, and rendered the top bar, sidebar, and the route outlet for the current view.

The `Sidebar.tsx` showed rooms in two accordion sections (Public Rooms, Private Rooms) and a contacts section, each with unread badges pulled from `useUnreadStore`. Rooms were click-to-navigate. Contacts showed presence dots — filled green for online, half-filled for AFK, empty for offline — rendered by `PresenceDot.tsx`, driven by `usePresenceStore`.

The `ChatView.tsx` component for rooms orchestrated everything: it sent `join_room` on mount, `leave_room` on unmount, fetched messages via `useInfiniteMessages`, subscribed to WebSocket events to patch the cache, and rendered `MessageList`, `MessageInput`, and `MembersPanel` side by side.

The `RoomSettingsModal.tsx` was a five-tab modal: Members, Admins, Banned Users, Invitations, and Settings. Each tab had its own state and API calls. The Members tab showed all members with their roles and available actions — the actions differed based on whether the viewer was the owner, an admin, or a plain member. The Banned Users tab showed who was banned by whom and when, with an Unban button for admins.

The full authentication flow — register, login, forgot password, reset password — lived in standalone pages that did not require the `AppShell` wrapper. The `ResetPasswordPage` extracted the token from the URL query string and submitted it alongside the new password.

---

## Chapter Eleven: Testing the Contract

The test suite was not an afterthought. It was a contract — a machine-readable specification of what the system promised to do.

Seven test files, organized by requirement section:

- `req.2.1.auth.test.ts` — registration, login, refresh, logout, password reset, account deletion
- `req.2.2.presence.test.ts` — tab registration, idle detection, presence derivation
- `req.2.3.friends.test.ts` — friend requests, acceptance, removal, user bans, DM freezing
- `req.2.4.rooms.test.ts` — room CRUD, joining, banning, role management, invitations
- `req.2.5.messages.test.ts` — send, edit, delete, pagination, unread counters
- `req.2.6.attachments.test.ts` — upload, download, access control, size limits
- `req.nonfunc.test.ts` — performance characteristics, rate limiting, capacity checks

Tests ran against real Fastify instances and a real test database — no mocks, no stubs for the database layer. A helper in `buildApp.ts` spun up a fresh Fastify server with test configuration. Another helper in `tokens.ts` generated valid JWTs for test users without going through the registration flow.

The test database was seeded and torn down per test suite, ensuring isolation. Running all tests in parallel was safe because each suite managed its own data.

---

## Chapter Twelve: The Deployment — Docker Compose

The final piece was the container orchestration that tied everything together.

`docker-compose.yml` defined four services:

**postgres**: PostgreSQL 16 Alpine. A named volume for data persistence across restarts. Health check using `pg_isready`. Environment variables for database name, user, and password, all loaded from the `.env` file.

**redis**: Redis 7 Alpine. Configured with `appendonly yes` — Redis Append-Only File mode, which means every write operation is logged to disk. If Redis restarted, it would replay the log and recover its state. For a presence system, this is important: tab registrations would survive a Redis restart during an active user session.

**backend**: A multi-stage Dockerfile. First stage: `node:20-alpine`, installs all dependencies, compiles TypeScript to `dist/`. Second stage: `node:20-alpine`, copies only the compiled output and `node_modules` — no TypeScript source, no devDependencies. A smaller, production-ready image. The backend service `depends_on` Postgres and Redis with health conditions, so it only starts after the database is ready to accept connections.

**frontend**: A two-stage Dockerfile. Build stage: runs `npm run build` to produce the Vite static output. Production stage: `nginx:alpine`, copies the built files and a custom `nginx.conf`. The nginx configuration served the React app on port 80, with location blocks that proxied `/api/*` and `/ws` to the backend service. The SPA routing was handled by a `try_files $uri $uri/ /index.html` directive — any path that did not match a static file fell back to `index.html`, letting React Router take over.

The `.env.example` file documented every environment variable with descriptions, making the setup self-documenting for any new developer picking up the project.

---

## Epilogue: What Was Built

In the end, what came together was a complete, production-grade real-time chat application — not a toy, not a tutorial, but something that could genuinely be deployed and used.

It had:

- **Secure authentication** with argon2id password hashing, rotating httpOnly refresh tokens, and JWT access tokens kept out of localStorage
- **Multi-tab presence** that correctly reported online, AFK, and offline states across any number of simultaneous browser tabs
- **Real-time messaging** via WebSocket with sub-second delivery, typing indicators, and automatic cache patching
- **A complete social graph** with friend requests, user-to-user bans, and DM channels
- **Room management** with a full owner/admin/member permission hierarchy, bans, invitations, and role delegation
- **File attachments** with access control, thumbnail generation, and path traversal prevention built in structurally
- **Infinite scroll message history** using cursor-based pagination that stays performant at 10,000+ messages per room
- **A clean deployment** via Docker Compose, buildable and runnable with a single command

The `requirements_definitions.txt` sat in the repository like a scorecard. Every line of the functional requirements had an answer somewhere in the code. Every non-functional requirement — 300 simultaneous users, 3-second delivery, 10,000-message scrollable history — had been designed for from the start.

The Jabber stretch goal? It waited, patient, at the bottom of the requirements document. There is always another sprint.

---

*The first commit, `fb90963`, was pushed on April 21, 2026. 86 files, 7,835 lines of additions. A complete system, built in a single session, because the requirements were clear, the stack was chosen well, and the engineering decisions were made deliberately rather than accidentally.*

*Some stories end. This one ships.*
