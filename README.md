# Chatty

A calm chat workspace for small teams, with a developer-friendly interface and original pixel-art avatars.

Chatty is a full-stack portfolio project in progress. Real accounts and durable direct chat are connected to the frontend through authorized REST APIs and Socket.IO delivery. An explicit demo mode provides sample conversations separately.

## Frontend demo features

- Responsive direct and group conversation views.
- Conversation and teammate search over sample data.
- Local message composition, multiline input, sending/failed states and retry.
- Earlier-message fixtures, scroll preservation and Jump to latest.
- Local group creation and member management with confirmation dialogs.
- Profile editing, pixel avatars and light/dark themes.
- Demo controls for loading, typing, offline/reconnecting and message failure.
- Browser persistence for demo conversations, drafts, profile and theme.

In **Try demo**, conversations, unread counts, presence, typing, delivery, pagination and group permissions are simulated. Live sign-in uses server accounts and cookie sessions. The local demo is not a secure messaging service.

## Quick start

Use Node.js 24.7 or newer and npm, matching `package.json`. Planned password hashing uses Node's built-in Argon2 API. Run from the directory containing this README:

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. The app asks the server for an existing session (`GET /api/v1/me`) and otherwise shows sign-in; **Try demo** opens the sample workspace without a server, database or API keys.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite locally |
| `npm test` | Run model tests with Node's test runner (test files are kept private) |
| `npm run build` | Build the static frontend into `dist/` |
| `npm run preview` | Preview the built frontend locally |
| `npm run server` | Start auth, direct-chat REST APIs and Socket.IO delivery |
| `npm run db:migrate` | Apply ordered SQL migrations with locking and tracking |
| `npm run test:server` | Local auth, direct-chat and realtime tests (needs PostgreSQL) |

There is no lint, app-container or deployment script yet. Server startup requires DATABASE_URL, APP_ORIGIN and a valid PORT (default 3000). Migrations require MIGRATION_DATABASE_URL. Group (M3a), read-state (M3b) and group realtime (M3c), presence and typing (M3d) exist.

### M1 development status

M1 is implemented: email/password accounts with public handles, Argon2id hashing, seven-day cookie sessions, CSRF protection, rate-limited auth, profile updates, teammate search and health checks. On 2026-10-09 the PostgreSQL integration tests and real-server browser auth flow were checked. Run `npm run db:migrate`, then `npm run server` alongside `npm run dev`.

### M2 development status

M2a provides direct-conversation creation, list/history APIs and durable text-message sends with retry deduplication. M2b pushes newly committed messages to authorized sessions over Socket.IO. It rechecks membership and session expiry for each push and disconnects session tabs on logout or login rotation. Send remains REST; a duplicate retry does not emit again.

M2c connects live teammate search, direct conversations, message history, sends and retries. Server sequence numbers reconcile socket pushes and REST acknowledgements into one message. Drafts use sessionStorage scoped by account and are cleared on sign-out; live messages never use demo storage. Pending sends survive conversation switches but not page reloads. Live presence and typing arrived in M3d (below).

M3a/M3b add group REST endpoints (create, details, add/remove members, transfer ownership, leave/close) and per-member read cursors. Unread badges count other people's messages after your cursor. A chat is marked read only while it is on screen, the browser tab is visible and the history is scrolled to the newest message. M3c brings the live group UI: create groups, see real members and authors, and (as owner) add or remove members and transfer ownership; an owner must transfer before leaving. Changes push over Socket.IO: other members update without reloading, a removed member's tabs close the chat, and reading in one tab clears the badge in your other tabs.

M3d adds live presence and typing, kept only in server memory. You are online while at least one tab has a socket open; only people who share a conversation with you see it (green dot in the sidebar and header, "N online" in groups). Typing shows "Name is typing" to the other members, stops when you send or clear the draft, and expires after five seconds without keystrokes. Presence assumes a single server process.

M2d adds `/gif <query>`: Enter opens up to eight G-rated results above the composer. Click a result or use arrow keys and Enter to send; Escape cancels and keeps the command draft. An empty query shows a hint. GIF messages use the same durable send/retry path as text.

Set `GIPHY_API_KEY` in the server's `.env` to enable search; never use a `VITE_` key. `GET /api/v1/gifs?query=` requires a session, limits queries to 100 Unicode characters and has a separate rate limit (20/minute per IP). Missing keys, quota exhaustion and provider errors show a GIF-only error; text chat still works. Search uses `rating=g`, limits results to eight and displays attribution following the [GIPHY API documentation](https://developers.giphy.com/docs/api/). Browsers load images directly from `media.giphy.com`, so GIPHY sees each viewer's IP address. Only alphanumeric GIF IDs are stored and used to construct image URLs. Browser/provider tests use controlled search results; a production key and live provider verification are still needed before release.

Realtime uses WebSocket transport only; Vite proxies `/socket.io` to the backend. M4 recovers what was missed: after a reconnect, every loaded chat fetches all messages after its last gap-free position (`afterSeq` pages), a skipped sequence number triggers the same catch-up, and reopening a loaded chat continues from that position instead of jumping to the latest page. Chats are marked read only up to the gap-free position. Signing out clears drafts, search and the open chat before the next account signs in. M2 source and its local acceptance checks are complete; live-provider testing is listed above.

Once Docker Desktop is running, start local PostgreSQL with `docker compose up -d db` and copy `.env.example` to `.env`. Compose creates `chatty` and `chatty_test` on first volume initialization. Do not delete an existing volume to recreate the test database; create it separately if missing. Server tests truncate users/sessions and only accept loopback PostgreSQL URLs targeting `chatty_test`. Never target live or development data.

## Exploring the demo

1. Select a conversation or use **New conversation** to start a local chat.
2. Send with Enter; use Shift+Enter for a newline. Input composition is supported.
3. In **Demo controls**, enable **Fail the next message**, send, then retry.
4. Load earlier messages and use **Jump to latest** after scrolling upward.
5. Open **Group details** to compare owner and regular-member controls.
6. Edit your profile or switch themes from the sidebar.

Sign-in and sign-up call the Chatty server; without a running server they show a "couldn’t reach the server" message. Sign-up requires a display name of 1–40 characters, a 3–24 character lowercase handle (letters, digits or underscore), and a password of 10–128 characters. Email validation trims spaces and ignores case; passwords are never trimmed. A signed-in account sees an empty conversation list and no Demo controls; real conversations arrive in M2. **Try demo** never contacts the server.

Demo data uses `chatty.*.v1` localStorage keys. **Reset demo data** restores samples and clears drafts after confirmation, preserving the theme. Demo sign-out returns to sign-in but keeps demo conversations; live sign-out ends the server session. Avoid entering sensitive information.

## Stack

| Layer | Current | Planned |
| --- | --- | --- |
| Interface | React 19, JavaScript, Bootstrap 5, custom CSS | Preserve the current interface |
| Tooling | Vite 6, npm lockfile | Add linting and CI |
| Icons/avatars | Lucide React, local SVG assets | Reuse existing assets |
| Data | Local PostgreSQL; mock fixtures only in demo | Supabase-hosted PostgreSQL |
| Server | Express + pg + Socket.IO: auth, direct-chat APIs and push | Groups, read state and GIF proxy |
| Auth | Server-managed cookie sessions; separate mock mode | Deployment hardening |
| Verification | Local model tests and PostgreSQL integration tests (not published) | Multi-user browser tests |
| Delivery | Local build | Docker, GitHub Actions CI/CD |

The proposed backend uses Supabase as managed PostgreSQL. Supabase Auth and Realtime are not part of this architecture; Express and Socket.IO own those responsibilities. This is a proposal, not a shipped feature.

## Repository structure

```text
chatty/
  public/avatars/             Runtime SVG assets
  src/
    components/
      Auth.jsx               Authentication prototype
      Chat.jsx               History, composer and message states
      Dialogs.jsx            Conversation, group, profile and demo dialogs
      Sidebar.jsx            Navigation and preferences
      UI.jsx                 Shared UI primitives
    App.jsx                  Local state and interactions
    data.js                  Sample people/messages
    model.js                 Validation, storage and immutable updates
    styles.css               Theme tokens and responsive layout
    main.jsx                 Entry point
  docs/IMPLEMENTATION_SPEC.md Full-stack requirements and delivery gates
  server/                    Express app, auth, migrations
  docker/init-test-db.sql     Local test database initialization
  docker-compose.yml         Local PostgreSQL service
  .env.example               Local configuration examples
  index.html
  package.json
  package-lock.json
  vite.config.js
```

Fixtures are necessary source for the public demo. Test source, dependencies, build outputs, secrets, test artifacts and private design materials are excluded from Git, so `npm test` and `npm run test:server` only run in the author's local checkout.

## Roadmap

1. Separate mock interactions from the server adapter without redesigning the UI.
2. Add PostgreSQL migrations, authentication and conversation permissions.
3. Pending-send persistence across reloads (durable messages, retry deduplication, reconnect catch-up and `/gif` are implemented).
4. Add integration/browser tests, Docker and gated deployment.

See the [implementation specification](docs/IMPLEMENTATION_SPEC.md) for requirements and acceptance criteria.

## Limitations

Uploads, read receipts for others, calls and end-to-end encryption are not complete. Demo group leave only removes local data; it does not prove server ownership transfer. Demo history/dates are fixtures. Optional Google Fonts have system-font fallbacks.

No hosted release, production readiness or performance benchmark is claimed. Free hosting has quotas and may pause or sleep; verify current conditions before publishing a live demo.
