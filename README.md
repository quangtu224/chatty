# Chatty

A calm chat workspace for small teams, with a developer-friendly interface and original pixel-art avatars.

Chatty is a full-stack portfolio project in progress. Real account authentication, authorized direct-chat REST APIs and Socket.IO delivery are implemented. The frontend supports live accounts; its chat workspace still uses demo conversations until the next integration slice.

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

There is no lint, app-container or deployment script yet. Server startup requires DATABASE_URL, APP_ORIGIN and a valid PORT (default 3000). Migrations require MIGRATION_DATABASE_URL. Group, unread, presence and GIF APIs remain planned.

### M1 development status

M1 is implemented: email/password accounts with public handles, Argon2id hashing, seven-day cookie sessions, CSRF protection, rate-limited auth, profile updates, teammate search and health checks. On 2026-10-09 the PostgreSQL integration tests and real-server browser auth flow were checked. Run `npm run db:migrate`, then `npm run server` alongside `npm run dev`.

### M2 development status

M2a provides direct-conversation creation, list/history APIs and durable text-message sends with retry deduplication. M2b pushes newly committed messages to authorized sessions over Socket.IO. It rechecks membership and session expiry for each push and disconnects session tabs on logout or login rotation. Send remains REST; a duplicate retry does not emit again.

Realtime currently uses WebSocket transport only; future browser clients must connect with `transports: ["websocket"]`. Vite proxies `/socket.io` to the backend. Missing messages during disconnection still require REST catch-up in M4. UI live-chat integration and the `/gif` picker remain M2c/M2d work; the whole M2 milestone is not complete.

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
3. Add durable messages, retry deduplication and reconnect synchronization.
   Add the planned `/gif` picker through a server-side Giphy proxy; no key in the browser.
4. Complete group ownership, unread state, typing and presence.
5. Add integration/browser tests, Docker and gated deployment.

See the [implementation specification](docs/IMPLEMENTATION_SPEC.md) for requirements and acceptance criteria.

## Limitations

Live-chat UI, uploads, read receipts, calls, group APIs and end-to-end encryption are not complete. Demo group leave only removes local data; it does not prove server ownership transfer. Demo history/dates are fixtures. Optional Google Fonts have system-font fallbacks.

No hosted release, production readiness or performance benchmark is claimed. Free hosting has quotas and may pause or sleep; verify current conditions before publishing a live demo.
