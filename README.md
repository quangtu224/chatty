# Chatty

A calm chat workspace for small teams, with a developer-friendly interface and original pixel-art avatars.

Chatty is a full-stack portfolio project in progress. Real accounts and durable direct chat are connected to the frontend through authorized REST APIs and Socket.IO delivery. All conversations require an authenticated server session; there is no demo mode.

## Live features

Every signed-in user can browse/search all open rooms and join one (up to 20 members). Only members can read history or send; the directory shows names/counts, never message previews or direct chats. Create a room with a name alone and optional invitees. Removing a member revokes current access but is not a ban: public rooms permit rejoining. The last member leaving closes the room. Existing room names become discoverable with this version; review the rollout before publishing it.

- Username/password accounts, public usernames, cookie sessions and profile/avatar editing.
- Durable direct/group text and GIF messages, server timestamps, history paging and idempotent retry.
- Global room discovery, self-service Join, owner management and realtime access revocation.
- Consensual, memory-only anonymous DMs; either participant can end the temporary session.
- Visible-chat read cursors, Seen/Unseen and group reader lists; presence across tabs and expiring typing indicators.
- Multi-page reconnect/gap recovery, account-scoped drafts and sign-out cleanup.
- Same-origin frontend/API/WebSockets in a non-root Docker image; local gated releases, SHA-aware health and GitHub CI.

M1–M4 are implemented. M5 provides Docker/local releases and GitHub CI; Render hosts `main` with Supabase PostgreSQL. The hosted baseline at af8733d includes username-only auth, demo removal, public rooms and temporary DMs; the owner confirmed signup works after making email nullable. The latest GIF autocomplete, presence, temporary-UI and typing/read-receipt improvements are locally verified feature branches pending deployment. See [operations and recovery](docs/OPERATIONS.md) for release, rollback, backup and verification limits.

## Quick start

Use Node.js 24.7 or newer and npm, matching `package.json`. Password hashing uses Node's built-in Argon2 API. Run from the directory containing this README:

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. The app asks the server for an existing session (`GET /api/v1/me`) and otherwise shows sign-in. The API and database must be running to chat.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite locally |
| `npm test` | Run model tests with Node's test runner (test files are kept private) |
| `npm run build` | Build the static frontend into `dist/` |
| `npm run lint` | ESLint correctness and Rules of Hooks checks |
| `npm run verify` | Private local suites, lint and production build |
| `npm run release:local` | Verify clean HEAD, migrate and deploy its Docker image locally |
| `npm run smoke -- <origin> <sha>` | Read-only frontend/API/health revision check |
| `npm run preview` | Preview the built frontend locally |
| `npm run server` | Start auth, direct-chat REST APIs and Socket.IO delivery |
| `npm run db:migrate` | Apply ordered SQL migrations with locking and tracking |
| `npm run test:server` | Local auth, direct-chat and realtime tests (needs PostgreSQL) |

Server startup requires DATABASE_URL, APP_ORIGIN (or Render's RENDER_EXTERNAL_URL) and a valid PORT (default 3000). Migrations require MIGRATION_DATABASE_URL. Production requires an HTTPS origin and built frontend; local HTTP Compose uses development cookies. The runtime database user has DML-only privileges, separate from the migration owner. Production requires `sslmode=verify-full` database URLs and sends security headers; set `TRUST_PROXY` behind a hosting proxy (see the operations runbook).

### Docker/local and CI

For a local build without the private test files:

```sh
docker compose --env-file .env.example build app
docker compose --env-file .env.example up -d --wait app
npm run smoke -- http://127.0.0.1:3000 development
```

Open `http://127.0.0.1:3000`. Compose preserves PostgreSQL data, runs migrations/grants before app startup and waits for health. The image excludes private tests, notes and secrets; the frontend build always uses production React even when the server's local `.env` says development. To release a committed revision with the owner's local tests, follow `npm run release:local` in the operations runbook. GitHub CI installs the lockfile, lints, migrates an isolated database twice, builds the frontend/container and checks exact-SHA readiness. Tests stay private and run locally; CI does not claim to run them.

### M1 development status

Accounts now register and sign in with username/password only. The API uses `handle` for the normalized username (3–24 ASCII letters/digits/underscores, case-insensitive); duplicates return a field error asking for another username. Signup defaults the display name to the username, editable later in Profile. Passwords and existing account/chat IDs are preserved. Migration 004 makes legacy email nullable without deleting existing values; new accounts do not store an email and user responses omit it. Apply migration 004 before deploying this version. Argon2id, seven-day cookie sessions, CSRF and auth rate limits remain in use.

After email-null accounts are created, rolling back to email-only login prevents those accounts from signing in. Use a username-compatible app revision for rollback; do not reverse migration 004 or invent email addresses for users.

### M2 development status

M2a provides direct-conversation creation, list/history APIs and durable text-message sends with retry deduplication. M2b pushes newly committed messages to authorized sessions over Socket.IO. It rechecks membership and session expiry for each push and disconnects session tabs on logout or login rotation. Send remains REST; a duplicate retry does not emit again.

M2c connects live teammate search, direct conversations, message history, sends and retries. Server sequence numbers reconcile socket pushes and REST acknowledgements into one message. Normal drafts use sessionStorage scoped by account and are cleared on sign-out. Pending sends survive conversation switches but not page reloads. Live presence and typing arrived in M3d (below).

### Temporary anonymous DMs

In a direct conversation, choose **Go temporary**. Both people must be connected; the other person must explicitly accept within 60 seconds. A compact status strip shows the invitation or session deadline; **How temporary chat works** opens the privacy details. Names, avatars and presence stay visible as usual. The session uses text only, for up to 30 minutes. Either person can end it. Normal history is hidden during the session and returns afterward.

Temporary messages, consent and drafts stay in server/browser memory, never PostgreSQL, localStorage or sessionStorage. Normal sends are blocked server-side while the session is active. Losing either person's last socket, logout, expiry or a server restart ends it; disconnecting or reloading a tab clears its temporary content. Messages have no offline recovery. With multiple tabs, closing one tab leaves the session active if another remains connected. The UI and server retain the latest 200 messages/retry acknowledgements; retries outside that window may repeat a message.

Typing and Seen/Unseen work in temporary DMs too. Temporary read cursors live only inside the active session; reading temporary text never advances normal message cursors. Names stay visible and no temporary bodies, drafts or read history are written to SQL.

This mode avoids persistent history; it does not hide your identity from your existing contact or server, prevent screenshots, or provide end-to-end encryption. Deploy only one backend instance: in-memory consent, delivery and locking are not shared across processes.

M3a/M3b add group REST endpoints (create, details, add/remove members, transfer ownership, leave/close) and per-member read cursors. Unread badges count other people's messages after your cursor. A chat is marked read only while it is on screen, the browser tab is visible and the history is scrolled to the newest message. M3c brings the live group UI: create groups, see real members and authors, and (as owner) add or remove members and transfer ownership; an owner must transfer before leaving. Changes push over Socket.IO: other members update without reloading, a removed member's tabs close the chat, and reading in one tab clears the badge in your other tabs.

M3d adds live presence and typing, kept only in server memory. You are online while at least one tab has a socket open; only people who share a conversation with you see it (green dot in the sidebar and header, "N online" in groups). Typing shows "Name is typing" to the other members, stops when you send or clear the draft, and expires after five seconds without keystrokes. Presence assumes a single server process.

Contact snapshots refresh on new direct chats, Join and membership changes, so already-connected teammates appear online without reloading. Authoritative snapshots replace stale contacts; group counts include your own connection. While disconnected or waiting for a snapshot, peer status is unknown rather than Offline. Closing the last tab may take the WebSocket heartbeat interval to be detected; sign-out explicitly closes its sockets.

Typing appears in the composer and sidebar for direct chats and joined rooms, stops on send/clear/blur, and expires after five seconds. Confirmed outgoing messages show **Seen** or **Unseen**; group messages show **Seen by N**. Click the status to see current members and their read state. Seen means the recipient's chat was on screen, its tab was visible and it was scrolled to the latest message; delivery or simply being online does not mark a message Seen. Hidden/scrolled-up chats remain Unseen. Read cursors reconcile monotonically on reconnect, and failed read requests remain retryable. This feature needs no new database migration.

Typing `/gif <query>` automatically opens up to ten G-rated results above the editable composer after a 400ms debounce. Searches never steal typing focus, and stale replies are ignored. Click a result, or press Arrow down/Enter to focus one and Enter to send; Escape dismisses the picker and keeps the draft. An empty query shows a hint. GIF messages use the same durable send/retry path as text.

Set `GIPHY_API_KEY` in the server's `.env` to enable search; never use a `VITE_` key. `GET /api/v1/gifs?query=` requires a session, limits queries to 100 Unicode characters and has a separate rate limit (20/minute per IP). Missing keys, quota exhaustion and provider errors show a GIF-only error; text chat still works. Search uses `rating=g`, returns at most ten safe results and displays attribution following the [GIPHY API documentation](https://developers.giphy.com/docs/api/). Browsers load images directly from `media.giphy.com`, so GIPHY sees each viewer's IP address. Only alphanumeric GIF IDs are stored and used to construct image URLs. Browser/provider tests use controlled search results; live provider behavior must be verified on the deployed revision.

Realtime uses WebSocket transport only; Vite proxies `/socket.io` to the backend. M4 recovers what was missed: after a reconnect, every loaded chat fetches all messages after its last gap-free position (`afterSeq` pages), a skipped sequence number triggers the same catch-up, and reopening a loaded chat continues from that position instead of jumping to the latest page. Chats are marked read only up to the gap-free position. Signing out clears drafts, search and the open chat before the next account signs in. M2 source and its local acceptance checks are complete; live-provider testing is listed above.

Once Docker Desktop is running, start local PostgreSQL with `docker compose up -d db` and copy `.env.example` to `.env`. Compose creates `chatty` and `chatty_test` on first volume initialization. Do not delete an existing volume to recreate the test database; create it separately if missing. Server tests truncate users/sessions and only accept loopback PostgreSQL URLs targeting `chatty_test`. Never target live or development data.

## Stack

| Layer | Current | Planned |
| --- | --- | --- |
| Interface | React 19, JavaScript, Bootstrap 5, custom CSS | Preserve the current interface |
| Tooling | Vite 6, ESLint 10, npm lockfile | Maintain checked builds |
| Icons/avatars | Lucide React, local SVG assets | Reuse existing assets |
| Data | Local PostgreSQL; Supabase PostgreSQL for hosted baseline | Apply migration 004 before releasing username-only auth |
| Server | Express + pg + Socket.IO: auth, groups/direct chat, recovery, read state, GIF proxy and ephemeral events | Hosted verification |
| Auth | Username/password, server-managed cookie sessions | No email recovery flow |
| Verification | Private model/API/PostgreSQL and multi-user browser suites | Hosted release checks |
| Delivery | Non-root Docker, local release/rollback, GitHub CI workflow | Cloud CD after hosted setup |

Supabase serves only as managed PostgreSQL. Express and Socket.IO own auth and realtime. Feature integration tests use isolated local PostgreSQL 17; they never target the hosted database.

## Repository structure

```text
chatty/
  public/avatars/             Runtime SVG assets
  src/
    components/
      Auth.jsx               Username/password sign-in/sign-up
      Chat.jsx               History, composer and message states
      Dialogs.jsx            Conversation, group and profile dialogs
      RoomDirectory.jsx      Discover and join all open groups
      AnonymousControls.jsx  Request, accept, decline and end temporary DMs
      Sidebar.jsx            Navigation and preferences
      UI.jsx                 Shared UI primitives
    App.jsx                  Authenticated workspace orchestration
    useLiveChat.js           Live chat, read state, events and recovery
    useAnonymousChat.js      Memory-only temporary messages/drafts
    model.js                 Validation, storage and immutable updates
    styles.css               Theme tokens and responsive layout
    main.jsx                 Entry point
  docs/IMPLEMENTATION_SPEC.md Full-stack requirements and delivery gates
  server/                    Express app, auth, migrations
  docker/init-test-db.sql     Local test database initialization
  docker-compose.yml         Local app/database/migration/runtime grants
  Dockerfile                 Pinned multi-stage non-root runtime
  scripts/                   Build, release and health diagnostics
  .github/workflows/ci.yml    Lint/migration/build/container smoke gates
  render.yaml                Render Blueprint: deploys main after CI passes
  docs/OPERATIONS.md         Release, rollback, backup and portfolio recording
  .env.example               Local configuration examples
  index.html
  package.json
  package-lock.json
  vite.config.js
```

Test source, dependencies, build outputs, secrets, test artifacts and private design materials are excluded from Git, so `npm test` and `npm run test:server` only run in the author's local checkout.

## Roadmap

1. Review the four interaction-polish branches and release frontend/backend together through `main` and CI; no additional schema migration is needed for these changes.
2. Verify the updated hosted flows, proxy/client-IP behavior and hosted rollback.
3. Record a short demo with test accounts; verify live GIPHY access before claiming it in a hosted release.
4. Consider pending-send persistence across reloads after the first hosted release.

See the [implementation specification](docs/IMPLEMENTATION_SPEC.md) for requirements and acceptance criteria.

## Limitations

Uploads, calls, account recovery and end-to-end encryption are excluded. Read indicators reflect client visibility/cursor reports, not proof that somebody read the text. Reader lists show current members; departed members are omitted. Presence, consent and temporary DMs require a single server process. Group names are visible to every signed-in user; history still requires membership. Optional Google Fonts have system-font fallbacks.

The latest feature branches have local verification only. Free hosting has quotas and may pause or sleep; no always-on production capacity is claimed.
