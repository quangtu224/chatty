# Chatty Implementation Specification

Updated: 2026-10-11. Status: M1 implemented; M2a REST/DB and M2b realtime delivery implemented. Live-chat UI and GIF integration remain pending.

## 1. Outcome and constraints

Build a working small-team chat application on the existing React interface. Demonstrate durable realtime messaging, server permissions, automated verification and reproducible deployment.

Target: 4–6 weeks; weekly availability is unconfirmed. Use English copy and documentation; preserve the name **Chatty**, JavaScript, Bootstrap, current components/styles and runtime avatars. Keep one backend instance; test with 20 concurrent sockets without claiming production capacity.

The earlier MongoDB direction is replaced in this proposal by Supabase-hosted PostgreSQL. Confirm the architecture when reviewing this spec before implementing it. Do not rebuild the frontend or add a second component system.

## 2. Inspected baseline

| Area | Current | Required work |
| --- | --- | --- |
| Auth | Live email/password/handle accounts and server cookie sessions | Deployment verification |
| Messages | Durable direct-chat REST sends and authorized Socket.IO push; mock UI remains separate | Live-chat UI and catch-up |
| Groups | Local creation/membership and owner buttons | Real permissions, explicit ownership transfer |
| History | Older-message fixtures and scroll preservation | Server pagination/timestamps |
| Unread | Fixture counts cleared on selection | Read cursor with visibility/scroll rules |
| Presence/typing | Static people/demo toggles | Authenticated sockets and expiry |
| Storage | Global `chatty.*.v1` localStorage | Isolate demo and real accounts |
| Tests | Local model/API/auth/direct-chat/realtime suites | Docker recheck, live-chat browser verification |

Source inspection is not browser verification. Group ownership is still mock-only. Initial load checks the server session; Try demo explicitly opens fixtures. Historical demo storage is retained separately; live logout ends the server session.

## 3. Product rules

### Identity

Retain email/password login to match the implemented UI, superseding the earlier username-only proposal. Email is private and excluded from search responses. Normalize email consistently without provider-specific alias rewriting.

Add a public unique handle at signup: lowercase ASCII letters/digits/underscore, 3–24 characters. Search handle/display name with bounded paginated results. Display name: 1–40 characters, trimmed. Profile avatar allowlist: cat, fox, raccoon, owl, frog, bear.

Signup passwords: 10–128 characters, never trimmed. Login validation requires a non-empty password, not the current signup minimum. Implemented in M1 with shared client/server validation. Use generic login errors. Email verification/account recovery are excluded; this is a portfolio demo, not an identity-assurance service.

### Conversations and permissions

One direct conversation per unordered user pair, even under concurrent creation; no self-chat.

Groups: name 1–48 characters, at least two users on creation, maximum 20 including owner. One owner adds/removes members and transfers ownership to an existing member. Owner must transfer before leaving; the last member may close the group without deleting history. Replace the prototype's automatic-transfer copy. Confirm remove/leave actions.

New members can read full history. Removed/departed members cannot read, send or receive subsequent group events. Rejoining restores access. Authorize every HTTP/socket operation, not just handshake or button visibility. Membership mutations and message writes lock the same conversation row, defining removal/send races. On revocation evict sockets and invalidate client caches.

### Messages and navigation

Plain text, multiline, emoji and safe links; maximum 4,000 Unicode code points, no whitespace-only content, no raw user HTML. Enter sends; Shift+Enter inserts newline; respect IME composition.

Keep optimistic sending/sent/failed UI. Sent means committed to the database, not received/read. Retry preserves `clientMessageId` and original body. Return 30 messages/page by default, maximum 50. Prepending history preserves scroll. Auto-scroll near the bottom or after own send; otherwise show Jump to latest. Format server UTC timestamps locally, replacing hard-coded live date labels.

Real-account drafts live in tab session storage keyed by user/conversation. Logout cancels in-flight work, disconnects sockets and clears private caches/drafts. Theme may stay global. Do not reuse global demo localStorage for real messages or auth tokens.

### GIF messages

Typing `/gif <query>` and pressing Enter opens a picker above the composer instead of sending text. It shows up to 8 Giphy results (`rating=g`) with "Powered by GIPHY" attribution; click or Enter sends the selection, Esc cancels and restores the draft. An empty query shows a hint. The Giphy key lives only on the server (`GIPHY_API_KEY`); the browser calls `GET /api/v1/gifs`, never Giphy's API. Mock mode shows "GIFs need the live server" instead of searching.

A GIF message stores `kind = 'gif'`, a Giphy ID (`^[A-Za-z0-9]+$`) and the title as `body` (alt text). Clients render `https://media.giphy.com/media/<id>/giphy.gif` built from the ID; arbitrary stored URLs are never rendered. Retry/idempotency rules match text messages. Viewers' browsers load images from Giphy, which therefore sees their IP addresses; README discloses this. Giphy outages or quota errors return `gif_unavailable` without affecting text chat.

### Read state and ephemeral events

Persist monotonic `last_read_seq` per membership. Advance only for the active visible chat when scrolled to latest; reject cursors beyond stored messages. Unread counts exclude own messages, not simply latestSeq minus lastReadSeq.

Online requires at least one authenticated socket, including multiple tabs. Disconnect detection may be delayed. Throttle typing and expire after five seconds; no typing persistence.

### Mock mode

Keep fixtures and Demo controls behind an explicit mock mode. Try demo must not create a real session or write to the database. Initial live mode checks server session and opens auth when absent, never trusts the old local session flag. Keep mock/live data separate; mock controls do not appear in live chat.

In M1 live mode the conversation list is empty and Demo controls are hidden; real conversations arrive in M2. Fixtures never appear as live data.

Excluded: video/voice, uploads, WASM, AI, push, message-content search, read receipts, message edit/delete, OAuth, verified email, recovery and end-to-end encryption.

## 4. Architecture and file map

```text
React -- REST / Socket.IO --> Express -- parameterized SQL --> PostgreSQL
                                                                |
                                                       Supabase hosting
```

Use Supabase only as managed PostgreSQL; no Supabase Auth/Realtime or parallel transports. Use Express, Socket.IO, `pg` and SQL migrations, without an initial ORM. Share services across transports. Express serves frontend build and API/socket on one origin; Vite proxies locally. Add `server/` without moving the root frontend into a monorepo.

Target file responsibilities: M1 files exist (app/index/db/auth/migrate, 001_initial.sql, api.js). Create remaining files only when needed.

| Path | Responsibility |
| --- | --- |
| `src/services/mock.js` | Fixture-backed operations |
| `src/services/api.js` | REST, session and structured errors |
| `src/services/socket.js` | Lifecycle, acknowledgements and sync |
| `server/app.js` | Routes, middleware and static frontend |
| `server/index.js` | Startup and graceful shutdown |
| `server/db.js` | Bounded pool and transactions |
| `server/auth.js` | Hashing, sessions and CSRF |
| `server/conversations.js` | Membership, creation and read state |
| `server/messages.js` | Durable send and history |
| `server/realtime.js` | Authorized subscriptions, typing/presence |
| `server/migrations/001_initial.sql` | Tables, indexes and privileges |
| `server/migrate.js` | Ordered, tracked migrations with concurrency lock |
| `server/*.test.js` | Database integration checks (local only, not published) |
| `tests/e2e/chat.spec.js` | Multi-user browser checks (local only, not published) |

Reuse `UI.jsx`, `model.js` and component boundaries. Replace direct fixture lookups in Chat, Sidebar and Dialogs with adapter data; replacing only App's send timeout is insufficient. Preserve theme/layout while integrating.

## 5. Data model

| Table | Fields / constraints |
| --- | --- |
| `users` | UUID PK, normalized email unique, handle unique, display_name, password_hash, avatar_id, created_at |
| `sessions` | token_hash PK, user_id FK, expires_at; index expiry/user |
| `conversations` | UUID PK, direct_key, next_seq (int), created_at; M3 adds type, name, owner_id, description, closed_at |
| `conversation_members` | PK (conversation_id,user_id), joined_at, last_read_seq; index (user_id,conversation_id) |
| `messages` | UUID PK, conversation_id, sender_id, client_message_id (UUID), seq (int), kind (`text`/`gif`), body, gif_id (required only for `gif`), created_at |

Unique direct_key for direct conversations is the sorted pair of user IDs. Unique message keys: `(conversation_id,sender_id,client_message_id)` and `(conversation_id,seq)`. The latter supports history/catch-up. Foreign keys preserve integrity; no account deletion in this release. Use check constraints for pinned lengths/types where practical.

Message transaction: lock conversation, authorize current membership, return canonical existing message on duplicate key, allocate per-conversation sequence, insert, commit, then respond and broadcast. `seq` is a PostgreSQL integer (about 2 billion per conversation), so JSON numbers stay exact. Sequence increment rolls back with insertion and is serialized within a conversation. Duplicate sends cannot overwrite the original body. Membership changes use the same lock.

Use parameterized queries, bounded pool, rollback/release on errors and verified TLS for hosted connections. Use Supabase session pooler if direct IPv6 is unreachable. Separate migration-owner credentials from a least-privilege runtime role.

Keep application tables in non-exposed schema `chatty`. Disable unused Data API or exclude that schema and revoke public/anon/authenticated access. No browser database password or service-role key. Express owns authorization. Introducing direct browser Data API later requires revisiting auth and implementing/testing RLS first.

## 6. API and socket contract

REST prefix `/api/v1`; errors `{ error: { code, message, fieldErrors? }, requestId }`. Validate UUID/input/page limits, omit private fields and avoid leaking unrelated conversation existence.

| Endpoint | Purpose |
| --- | --- |
| `GET /auth/csrf` | Pre-auth/authenticated mutation CSRF token |
| `POST /auth/register`, `/auth/login`, `/auth/logout` | Account/session lifecycle |
| `GET /me`, `PATCH /me` | Profile |
| `GET /users?query=&cursor=` | Public teammate search |
| `GET /conversations` | Authorized list/previews/unread |
| `POST /conversations/direct`, `/conversations/groups` | Open/create |
| `GET /conversations/:id` | Details |
| `POST /conversations/:id/members` | Add as owner |
| `DELETE /conversations/:id/members/:userId` | Remove as owner |
| `POST /conversations/:id/transfer-owner`, `/conversations/:id/leave` | Transfer/leave |
| `GET /conversations/:id/messages?beforeSeq=&limit=` | Older history |
| `GET /conversations/:id/messages?afterSeq=&limit=` | Catch-up |
| `PUT /conversations/:id/read` | Advance cursor |
| `POST /conversations/:id/messages` | Send `{ clientMessageId, body }`: 201 new, 200 canonical duplicate |
| `GET /gifs?query=` | Authenticated, rate-limited Giphy search proxy |

Message cursors are exclusive; reject both in one request. Uncursored queries return latest page in ascending display order; responses expose pagination state. Canonical message contains UUID, clientMessageId, senderId, sequence, body and UTC createdAt. Encode PostgreSQL bigint cursors as decimal strings in JSON if bigint is used; never silently coerce unsafe integers.

Messages are sent over REST (decision 2026-10-09): `POST /conversations/:id/messages` reuses session auth, CSRF and rate limiting, and its response is the acknowledgement. Socket.IO only pushes server events. Client events: `typing:set`, `conversation:subscribe`; subscription authorizes room access. Server events: `message:created`, `conversation:updated`, `conversation:access-revoked`, `read:updated`, `typing:updated`, `presence:updated`. User rooms update sidebar/multiple tabs without exposing unrelated chats. Sender identity comes from the session.

M2b currently implements only `message:created`, with WebSocket transport and session-scoped rooms chosen by the server. It joins no client-selected rooms and exposes no write event. A fresh database query selects current member sessions for every push. Session expiry disconnects idle sockets; logout/rotation revokes the matching session's tabs. Remaining events belong to later slices. Duplicate sends do not rebroadcast; a push failure does not undo an already committed message.

## 7. Recovery and ordering

One UUID per new send; preserve on retry. Merge optimistic/ack/broadcast by send key or server ID. Sort by server sequence, not client clock.

Subscribe before initial history fetch and merge concurrent events. Track the loaded-history boundary separately from contiguous live-sync cursor. Reconnect refreshes auth, memberships/read state and fetches all pages after last contiguous cursor. Buffer out-of-order events, fetch gaps, never advance over unseen messages. Refresh unloaded conversations on selection.

Committed messages survive lost ack/broadcast. A timeout with uncertain persistence retries the same key. No promise of pending-send survival across reload in the first release; never auto-send drafts. This is idempotent durable storage and eventual UI reconciliation, not exactly-once network delivery.

## 8. Security and operations

Argon2id for passwords via `node:crypto` (requires Node.js 24.7 or newer; no hashing dependency). Random opaque session token, only hash stored, maximum seven-day expiry, rotation on login. Cookie HttpOnly, Secure under HTTPS, SameSite=Lax, path `/`. Check expiry/revocation on requests and socket actions. Logout disconnects sockets sharing that session, not unrelated sessions.

CSRF tokens and approved Origin for mutations; socket origin/session validation. Rate-limit auth/search/send; cap payload. No credentials or message bodies in logs. `VITE_*` values are public, never secrets.

Compose will run PostgreSQL and app with health checks/persistent volume. Isolate test database. Production image multi-stage/non-root. Add sanitized `.env.example` when config exists: DATABASE_URL, MIGRATION_DATABASE_URL, TEST_DATABASE_URL, APP_ORIGIN, PORT, NODE_ENV, GIPHY_API_KEY. Local development and tests use PostgreSQL in Docker Compose (`chatty` and `chatty_test` databases); Supabase is connected at M5. Do not advertise executable server commands before their scripts exist.

Test source is kept out of the public repository by owner decision; model/integration/E2E suites run locally before every push and their results are recorded. CI: clean lockfile install, lint, migrations on isolated PostgreSQL, frontend/container builds. Keep migrations/lockfiles in Git. CD runs only a successful main SHA, pins that revision and serializes deployment. Disable auto-deploy bypassing CI. Run migrations once with lock; failures block deployment. Additive schema changes remain compatible with previous app revision.

Post-deploy: readiness, deployed SHA and smoke checks. Rollback redeploys a known-good app, not automatic destructive schema reversal. Document backup/restore; never delete live data/volumes to recover a release. `/health/live` checks process; `/health/ready` checks database. Structured logs include request ID/status/duration/error code, never secrets.

Render/Supabase are candidate hosts, not provisioned services. Verify quotas, connection mode, region, idle pauses and cold starts before release. No always-on/zero-cost production promise. Do not circumvent free-tier sleep with periodic traffic.

## 9. Acceptance gates

| Scenario | Evidence required |
| --- | --- |
| Identity | Register/login/logout tests; unauthenticated actions denied |
| Two-user chat | Independent browsers exchange committed messages and reload history |
| Retry/lost ack | Same key gives one row and one UI message |
| Reconnect | More than 30 missed messages recovered without gaps/duplicates |
| Fetch/event race | Initial/catch-up concurrent events do not lose messages or jump cursors |
| Groups | Non-owner denied; removed member cannot read/send/subscribe |
| Remove/send race | Transaction order tested; no send after committed removal |
| Ownership | Atomic transfer/leave, no abandoned multi-member group |
| Unread | Own messages excluded; hidden/scrolled-up chat does not mark unseen messages read |
| Multiple tabs | Presence remains with a tab; logout revokes matching session sockets |
| UI | Keyboard/IME, long text/links, 360px/mobile keyboard, preserved scroll |
| Privacy | Mock/live isolated, logout clears private state, no direct database exposure |
| Delivery | Failed CI or a failed local test run blocks deployment; SHA/health and rollback verified |

Retain Node's model test runner. Add real PostgreSQL integration tests and Playwright multi-user E2E. Model retry tests alone cannot prove server idempotency. Performance goal, not measured result: warm server, 20 sockets, send-to-receive p95 near one second on a documented stable network. Record measured environment/results before portfolio claims.

## 10. Milestones

- [x] **M1: Identity/database.** Server, migrations/config, real email auth/public handles, CSRF/session/profile; integrate App/Auth/model. Gate: auth security/migration tests.
- [ ] **M2: Durable direct chat.** Slices: M2a migration 002 + REST (direct pair, list, history, send); M2b Socket.IO push; M2c frontend live chat; M2d `/gif`. Pair uniqueness, authorized send, sockets/adapters, history/server timestamps, `/gif` messages. Gate: two-user, concurrent retry and GIF proxy/validation tests.
- [ ] **M3: Groups/read state.** Transfer/membership, unread, typing/presence; integrate Dialogs/Sidebar/Chat. Gate: permission/race/hidden-tab tests.
- [ ] **M4: Recovery/polish.** Catch-up/gaps, fetch races, mock isolation, logout cleanup, responsive/accessibility. Gate: multi-page offline tests.
- [ ] **M5: Delivery/portfolio.** Docker, lint/CI/CD, hosted connection/migrations, health/rollback, README and demo recording. Gate: exact-SHA deployment/recovery evidence.

Estimate: M1 week 1, M2 week 2, M3 week 3, M4 week 4, M5/fixes weeks 5–6. Reduce animation/demo polish or defer typing/presence if needed, not permissions/durability/recovery.

Before coding each milestone, write a bounded local execution plan with exact touched files/interfaces and failing-test assertions. This public spec is the requirements baseline, not a development transcript.

## 11. Definition of done

Required gates have fresh evidence. README separates shipped/planned features. Setup/migrations/deploy/rollback are reproducible. Provide screenshots, short demo and measured results only where measured. Publish no school material, secrets, design prompts or generated test artifacts. No Redis/Kubernetes, second realtime stack or speculative abstractions.

## 12. Primary references

Reviewed 2026-10-09; recheck provider details at implementation time.

- [Supabase PostgreSQL connections](https://supabase.com/docs/guides/database/connecting-to-postgres).
- [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api).
- [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/).
- [Supabase pricing](https://supabase.com/pricing), [Render free services](https://render.com/docs/free).
- [Render deploy hooks](https://render.com/docs/deploy-hooks): verify exact-revision triggering in the deployment integration.
