# Chatty Implementation Specification

Updated: 2026-10-15. Interaction polish was merged at main commit0214fdf; the hosted revision has not been reverified. This feature branch adds temporary GIFs, opt-in Notifications API alerts, app-wide invitations, a temporary-mode switch and realtime public profile updates. It reuses existing database columns and requires no new migration. Ship frontend/backend together.

## 1. Outcome and constraints

Build a working small-team chat application on the existing React interface. Demonstrate durable realtime messaging, server permissions, automated verification and reproducible deployment.

Target: 4–6 weeks; weekly availability is unconfirmed. Use English copy and documentation; preserve the name **Chatty**, JavaScript, Bootstrap, current components/styles and runtime avatars. Keep one backend instance; test with 20 concurrent sockets without claiming production capacity.

The earlier MongoDB direction is replaced by PostgreSQL (local development and Supabase hosting). Preserve the existing frontend and component system. Hosted rollback, proxy/client-IP behavior, cold starts and the portfolio recording remain open M5 checks.

## 2. Inspected baseline

| Area | Current | Required work |
| --- | --- | --- |
| Auth | Username/password accounts and server cookie sessions | Apply migration 004 before deployment |
| Messages | Durable direct/group REST sends, authorized Socket.IO push and recovery | Hosted verification |
| Groups | Global catalog/Join, owner permissions, transfer, add/remove/leave | Hosted race/recovery check |
| History | Server timestamps, older paging and contiguous catch-up | Hosted verification |
| Unread | Persistent read cursors with visibility/scroll rules | Real browser tab/mobile keyboard check |
| Presence/typing | Authenticated sockets and ephemeral expiry | One process; no multi-instance support |
| Storage | Normal account-scoped tab drafts; temporary DM content in RAM only | No pending-send recovery across reload |
| Anonymous DM | Explicit two-party consent, dedicated temporary REST/socket paths | Single process; no persisted history |
| Tests | Private model/API/PostgreSQL/multi-user browser suites | Public CI build/migration diagnostics |

Initial load checks the server session; missing sessions show sign-in. Try demo, fixtures and simulated chat controls are removed. Logout clears account caches/drafts and ends the session.

## 3. Product rules

### Identity

Updated requirement (2026-10-14): signup/login use username and password only, with no email field. The API retains `handle` as the username, trims/lowercases it before lookup/uniqueness checks and returns a clear conflict on a duplicate. Signup defaults the editable display name to the username. Migration 004 permits email-null new accounts while preserving legacy values/account IDs/passwords/history; email is never returned to clients.

Add a public unique handle at signup: lowercase ASCII letters/digits/underscore, 3–24 characters. Search handle/display name with bounded paginated results. Display name: 1–40 characters, trimmed. Profile avatar allowlist: cat, fox, raccoon, owl, frog, bear.

Signup passwords: 10–128 characters, never trimmed. Login validation requires a non-empty password, not the current signup minimum. Implemented in M1 with shared client/server validation. Use generic login errors. Email verification/account recovery are excluded; this is a portfolio demo, not an identity-assurance service.

### Conversations and permissions

One direct conversation per unordered user pair, even under concurrent creation; no self-chat.

Updated requirement (2026-10-14): every authenticated user sees/searches all open rooms and can self-Join. Only members read/send; direct messages and room history/previews never enter the public catalog. Rooms: name 1–48 characters, creator only or optional invitees, maximum 20 including owner. Owner manages members and transfers ownership before leaving; the last member closes the room without deleting history. Removal revokes membership, not a permanent ban. Catalog uses bounded UUID-keyset pages/search; Join serializes with membership changes. Confirm remove/leave actions.

New members can read full history. Removed/departed members cannot read, send or receive subsequent group events. Rejoining restores access. Authorize every HTTP/socket operation, not just handshake or button visibility. Membership mutations and message writes lock the same conversation row, defining removal/send races. On revocation evict sockets and invalidate client caches.

### Messages and navigation

Plain text, multiline, emoji and safe links; maximum 4,000 Unicode code points, no whitespace-only content, no raw user HTML. Enter sends; Shift+Enter inserts newline; respect IME composition.

Keep optimistic sending/sent/failed UI. Sent means committed to the database, not received/read. Retry preserves `clientMessageId` and original body. Return 30 messages/page by default, maximum 50. Prepending history preserves scroll. Auto-scroll near the bottom or after own send; otherwise show Jump to latest. Format server UTC timestamps locally, replacing hard-coded live date labels.

Normal drafts live in tab session storage keyed by user/conversation. Temporary drafts never use browser storage. Logout cancels in-flight work, disconnects sockets and clears private caches/drafts. Theme may stay global. No auth tokens or message histories in localStorage.

### GIF messages

Typing `/gif <query>` in normal or temporary chat automatically opens a picker with up to10 safe Giphy results (`rating=g`) after a 400ms debounce. Keep the composer editable and retain input focus on search completion. Clear old results/errors when the keyword changes; ignore late replies. Arrow down/Enter focuses a result; click/Enter sends it. Escape dismisses the current picker and keeps the draft; editing reopens search. An empty query shows a hint. The Giphy key lives only on the server (`GIPHY_API_KEY`); the browser calls `GET /api/v1/gifs`, never Giphy's API. Temporary picks must call the dedicated temporary send route, never the durable route.

A GIF message stores `kind = 'gif'`, a Giphy ID (`^[A-Za-z0-9]+$`) and the title as `body` (alt text). Clients render `https://media.giphy.com/media/<id>/giphy.gif` built from the ID; arbitrary stored URLs are never rendered. Retry/idempotency rules match text messages. Viewers' browsers load images from Giphy, which therefore sees their IP addresses; README discloses this. Giphy outages or quota errors return `gif_unavailable` without affecting text chat.

### Read state and ephemeral events

Persist monotonic `last_read_seq` per membership. Advance only for the active visible chat when scrolled to latest; reject cursors beyond stored messages. Unread counts exclude own messages, not simply latestSeq minus lastReadSeq.

Expose current readers (`id`, `displayName`, `avatarId`, `lastReadSeq`) only in authorized conversation list/details, never public catalogs. Publish a reader's committed cursor to current other members, preserving own-tab unread sync. Confirmed outgoing messages display Seen/Unseen; groups display Seen by N with a current-member reader dialog. Exclude the sender from that message's reader list. Seen requires the chat to be on screen, the tab visible and the history within 24px of its bottom, not merely socket delivery. Preserve higher reader cursors when stale snapshots arrive, drop departed readers from fresh snapshots and refresh on reconnect. Failed read requests never advance a cursor optimistically; later view/scroll/events can retry. Typing appears in composer/sidebar, clears on send/clear/blur and expires after five seconds.

Online requires at least one authenticated socket, including multiple tabs. Disconnect detection may be delayed. Throttle typing and expire after five seconds; no typing persistence.

Presence snapshots are authoritative and refreshed on connect, direct creation and membership changes (including revoked members). Serialize presence publication so delayed SQL cannot override newer snapshots. Include the current user in group online counts. Disconnected/uninitialized presence shows unknown; only a completed snapshot determines Offline.

### Consensual temporary anonymous DM

Direct conversations only. The requester consents by requesting; only the other participant may accept the exact current request ID. Both require an authenticated socket. Pending requests expire after 60 seconds; active sessions expire after 30 minutes. Either can decline/cancel/end. Losing either participant's last socket, auth expiry/logout or server restart ends the session. One remaining tab preserves server consent; disconnect clears that tab's memory.

Use dedicated temporary send routes and socket events, never the durable message route. Serialize consent transitions and all sends per conversation; block durable sends while active. Temporary bodies, GIF IDs/titles, consent, acknowledgements, read cursors and drafts remain in RAM; use `Cache-Control: no-store`. Clear them on end/disconnect/logout, reject stale session IDs and ignore late replies/events. No automatic fallback or offline recovery. Apply the durable route's text/Giphy-ID validation to temporary media; arbitrary URLs are rejected. Retry preserves the original body/kind/GIF ID/key within the latest 200 server acknowledgement records; UI displays at most 200 temporary messages. Giphy/browser media caches are outside this history guarantee. Normal history/drafts remain separate and return afterward. Temporary read updates are session-scoped and monotonic, never updating persistent membership cursors; typing uses the existing authenticated member-only socket hint. Sent means pushed to connected sessions; Seen reflects the same visibility/bottom rules as normal chat.

Keep real peer names, avatars and presence in the header and messages. Use a compact moss-colored strip with an accessible sliding switch (Off/Waiting/On), contextual Accept/Decline/Cancel actions and expiry time. Requesting does not turn the switch On; both must consent. Either participant can turn an active session Off. Incoming invitations appear outside the current chat with an Open action, without automatic acceptance. Privacy details live in a collapsible disclosure; the visible strip states that messages disappear. This mode does not conceal existing contact identities from the peer/server or prevent screenshots; no end-to-end encryption. One backend instance is required because consent and message locks live in its memory.

### Browser notifications and profile synchronization

Account-scoped opt-in button requests Notifications permission only on a user click. A small service worker displays generic live-message/invitation notifications, suppresses the focused conversation and deduplicates up to200 events in RAM across tabs. Its click handler focuses the matching account's app and selects the DM/group, never accepting consent. No chat bodies/GIF titles enter notification payloads or persistent browser storage. Clear temporary notifications on state transitions and account notifications on sign-out/disable. Unsupported/denied permission never blocks chat; opt-in preference is the only new localStorage value. No Web Push, subscription database or closed-app delivery.

Profile PATCH commits first, then publishes current public profiles only to unexpired sessions of the owner and users sharing a conversation. Serialize publications and read current profile/recipients together. Push failure does not fail an already committed save. Clients update own-account state and overlay profiles in peers, members and readers, preserving read cursors despite old HTTP responses. Reconnect refreshes own/list profiles. No database migration or private fields in events.

Excluded: video/voice, uploads, WASM, AI, closed-app Web Push, message-content search, message edit/delete, OAuth, verified email, recovery and end-to-end encryption.

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
| `src/useAnonymousChat.js` | Temporary state, drafts and messages in RAM only |
| `src/services/api.js` | REST, session and structured errors |
| `src/useLiveChat.js` | Socket lifecycle, durable acknowledgements and sync |
| `server/app.js` | Routes, middleware and static frontend |
| `server/index.js` | Startup and graceful shutdown |
| `server/db.js` | Bounded pool and transactions |
| `server/auth.js` | Hashing, sessions and CSRF |
| `server/conversations.js` | Membership, creation and read state |
| `server/anonymous.js` | Consent, temporary sends, expiry and per-conversation serialization |
| `server/realtime.js` | Authorized subscriptions, typing/presence |
| `server/migrations/001_initial.sql` | Tables, indexes and privileges |
| `server/migrate.js` | Ordered, tracked migrations with concurrency lock |
| `server/*.test.js` | Database integration checks (local only, not published) |
| `tests/e2e/chat.spec.js` | Multi-user browser checks (local only, not published) |

Reuse `UI.jsx`, `model.js` and existing component boundaries. Chat, Sidebar and Dialogs use real authorized API data. Preserve theme/layout while integrating.

## 5. Data model

| Table | Fields / constraints |
| --- | --- |
| `users` | UUID PK, normalized handle unique, nullable unique legacy email (never exposed), display_name, password_hash, avatar_id, created_at |
| `sessions` | token_hash PK, user_id FK, expires_at; index expiry/user |
| `conversations` | UUID PK, type (`direct`/`group`), direct_key (direct only), name (group, 1–48 trimmed), owner_id (open group), closed_at (closed group), next_seq (int), created_at; a check constraint enforces each type's shape. Group description is not stored. |
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
| `GET /groups?query=&cursor=&limit=` | Global open-room metadata only, 20 default/50 maximum |
| `POST /conversations/:id/join` | Self-service membership; idempotent, maximum 20 |
| `POST /conversations/direct`, `/conversations/groups` | Open/create |
| `GET /conversations/:id` | Details |
| `POST /conversations/:id/members` | Add as owner |
| `DELETE /conversations/:id/members/:userId` | Remove as owner |
| `POST /conversations/:id/transfer-owner`, `/conversations/:id/leave` | Transfer/leave |
| `GET /conversations/:id/messages?beforeSeq=&limit=` | Older history |
| `GET /conversations/:id/messages?afterSeq=&limit=` | Catch-up |
| `PUT /conversations/:id/read` | Advance cursor |
| `POST /conversations/:id/messages` | Send `{ clientMessageId, body }`: 201 new, 200 canonical duplicate |
| `GET /conversations/:id/anonymous` | Member-only current temporary state; groups rejected |
| `POST /conversations/:id/anonymous` | `{ action: request/accept/decline/stop, id? }`; exact current request/session ID required except request |
| `POST /conversations/:id/anonymous/messages` | `{ sessionId, clientMessageId, body, kind?: text/gif, gifId? }`; RAM-only delivery and canonical retry |
| `PUT /conversations/:id/anonymous/read` | `{ sessionId, seq }`; RAM-only monotonic cursor within the current session, returns updated state |
| `GET /gifs?query=` | Authenticated, rate-limited Giphy search proxy |

Message cursors are exclusive; reject both in one request. Uncursored queries return latest page in ascending display order; responses expose pagination state. Canonical message contains UUID, clientMessageId, senderId, sequence, body and UTC createdAt. Encode PostgreSQL bigint cursors as decimal strings in JSON if bigint is used; never silently coerce unsafe integers.

Messages use REST: `POST /conversations/:id/messages` reuses session auth, CSRF and rate limiting; its response is the acknowledgement. The only client socket event is `typing:set`; the server chooses session rooms, with no client subscription. Member/session authorization is rechecked for publication. Conversation updates/revocation, own-tab reads, peer receipts, typing and presence update sidebars and multiple tabs without exposing unrelated chats. A push failure never undoes a committed durable write. Typing is throttled to one repeated state per second per socket and expires in clients after five seconds. Presence and typing live in one process's memory; event payloads and audiences are pinned below.

Current delivery uses WebSocket transport and session-scoped rooms chosen by the server. Message, conversation, revocation, read, presence and typing events are implemented. It joins no client-selected rooms; conversation subscription is unnecessary with this session-room design. Message writes remain REST-only; typing is the authorized client socket event. A fresh database query selects eligible member sessions for pushes. Session expiry disconnects idle sockets; logout/rotation revokes matching tabs. Duplicate sends do not rebroadcast; push failures do not undo committed writes.

Public-room changes push `groups:updated` with no payload to authenticated sockets; clients refetch the metadata catalog. New direct chats also publish member-only conversation updates and contact snapshots. `presence:updated` adds `snapshot:true` for authoritative online sets, refreshed on connect/membership changes. `receipt:updated { conversationId, userId, lastReadSeq }` goes only to current other members; `read:updated` still syncs the reader's own tabs. Temporary DMs push `anonymous:state { conversationId, status, version, requestId, sessionId, requestedBy, expiresAt, readers }` (readers: userId/lastReadSeq) and `anonymous:message` (canonical text fields plus sessionId) to both participants' unexpired sessions. Client state versions/session IDs and monotonic read merges reject older replies. Temporary routes allocate no durable sequences or SQL rows. Failed temporary pushes never fall back to durable sends.

## 7. Recovery and ordering

One UUID per new send; preserve on retry. Merge optimistic/ack/broadcast by send key or server ID. Sort by server sequence, not client clock.

Subscribe before initial history fetch and merge concurrent events. Track the loaded-history boundary separately from contiguous live-sync cursor. Reconnect refreshes auth, memberships/read state and fetches all pages after last contiguous cursor. Buffer out-of-order events, fetch gaps, never advance over unseen messages. Refresh unloaded conversations on selection.

Committed messages survive lost ack/broadcast. A timeout with uncertain persistence retries the same key. No promise of pending-send survival across reload in the first release; never auto-send drafts. This is idempotent durable storage and eventual UI reconciliation, not exactly-once network delivery.

## 8. Security and operations

Argon2id for passwords via `node:crypto` (requires Node.js 24.7 or newer; no hashing dependency). Random opaque session token, only hash stored, maximum seven-day expiry, rotation on login. Cookie HttpOnly, Secure under HTTPS, SameSite=Lax, path `/`. Check expiry/revocation on requests and socket actions. Logout disconnects sockets sharing that session, not unrelated sessions.

CSRF tokens and approved Origin for mutations; socket origin/session validation. Rate-limit auth/search/send; cap payload. No credentials or message bodies in logs. `VITE_*` values are public, never secrets.

Compose runs PostgreSQL and app with health checks/persistent volume; migration and runtime-role jobs gate startup. The production image is multi-stage/non-root with a pinned Node base and explicit source allowlist. `.env.example` documents local configuration. Local tests accept only loopback `chatty_test`. Existing Supabase verified TLS and Render CI/CD were checked for the previous baseline; new feature branches need separate hosted verification after release.

Test source is kept out of the public repository by owner decision; model/integration/E2E suites run locally before every push and their results are recorded. CI: clean lockfile install, lint, migrations on isolated PostgreSQL, frontend/container builds. Keep migrations/lockfiles in Git. CD runs only a successful main SHA, pins that revision and serializes deployment. Disable auto-deploy bypassing CI. Run migrations once with lock; failures block deployment. Additive schema changes remain compatible with previous app revision.

Post-deploy: readiness, deployed SHA and smoke checks. Rollback redeploys a known-good app, not automatic destructive schema reversal. Document backup/restore; never delete live data/volumes to recover a release. `/health/live` checks process; `/health/ready` checks database. Structured logs include request ID/status/duration/error code, never secrets.

Render/Supabase host the previous baseline. Check quotas, connection mode, region, idle pauses and cold starts for releases. No always-on/zero-cost production promise. Do not circumvent free-tier sleep with periodic traffic. Before public-room rollout, review existing room names: they become discoverable to every signed-in user; history remains member-only.

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
| Privacy | Logout clears private state, temporary content never enters DB/browser storage, no direct database exposure |
| Public rooms | Global metadata discovery; outsiders cannot read/send; concurrent last-slot Join respects capacity |
| Temporary DM | Bilateral consent, no group/outsider access, stale/expired sessions rejected, multi-tab/disconnect cleanup, no persistence/fallback |
| Seen/typing | Hidden/scrolled-up chat stays Unseen; group reader lists update live and are member-only; failed reads retry; temporary typing/cursors never persist |
| Delivery | Failed CI or a failed local test run blocks deployment; SHA/health and rollback verified |

Retain Node's model test runner. Add real PostgreSQL integration tests and Playwright multi-user E2E. Model retry tests alone cannot prove server idempotency. Performance goal, not measured result: warm server, 20 sockets, send-to-receive p95 near one second on a documented stable network. Record measured environment/results before portfolio claims.

## 10. Milestones

- [x] **M1: Identity/database.** Server, migrations/config, username auth, CSRF/session/profile; integrate App/Auth/model. Gate: auth security/migration tests.
- [x] **M2: Durable direct chat.** Slices: M2a migration 002 + REST (direct pair, list, history, send); M2b Socket.IO push; M2c frontend live chat; M2d `/gif`. Pair uniqueness, authorized send, sockets/adapters, history/server timestamps, `/gif` messages. Gate passed locally on 2026-10-11: PostgreSQL integration tests (including concurrent retry and GIF proxy/validation), two browser accounts, history paging and GIF keyboard/cancel/outage flows. Provider responses/images were controlled in browser tests; live GIPHY access must be checked before release.
- [x] **M3: Groups/read state.** Slices: M3a migration 003 + group REST (create, details, add/remove, transfer, leave/close); M3b read cursor/unread; M3c group UI + realtime revocation; M3d typing/presence. Transfer/membership, unread, typing/presence; integrate Dialogs/Sidebar/Chat. Gate: permission/race/hidden-tab tests.
- [x] **M4: Recovery/polish.** Catch-up/gaps, fetch races, logout cleanup, responsive/accessibility. Gate: multi-page offline tests.
- [ ] **M5: Delivery/portfolio.** Docker/local release and rollback, non-root runtime, least-privilege SQL role, gated migrations, GitHub CI, Supabase verified TLS and Render main-only deployment are implemented. The previous hosted baseline has recorded two-user/group/recovery/GIF browser and exact-SHA HTTPS smoke evidence (2026-10-13). Remaining: hosted rollback rehearsal, actual proxy/client-IP behavior, cold starts, portfolio recording, and hosted verification of the new feature branches. Local feature checks must not target the hosted database.

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
