# Chatty

A calm chat workspace for small teams, with a developer-friendly interface and original pixel-art avatars.

Chatty is a full-stack portfolio project in progress. **The current release is an interactive frontend prototype.** Real accounts, server authorization, database persistence and cross-device messaging are not implemented yet.

## Current features

- Responsive direct and group conversation views.
- Conversation and teammate search over sample data.
- Local message composition, multiline input, sending/failed states and retry.
- Earlier-message fixtures, scroll preservation and Jump to latest.
- Local group creation and member management with confirmation dialogs.
- Profile editing, pixel avatars and light/dark themes.
- Demo controls for loading, typing, offline/reconnecting and message failure.
- Browser persistence for demo conversations, drafts, profile and theme.

Authentication, unread counts, presence, typing, delivery, pagination and group permissions are simulated. The demo is not a secure messaging service.

## Quick start

Use Node.js 24.7 or newer and npm, matching `package.json`. Planned password hashing uses Node's built-in Argon2 API. Run from the directory containing this README:

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. The first visit opens the sample workspace. No environment variables, database or API keys are required for this release.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite locally |
| `npm test` | Run model tests with Node's test runner (test files are kept private) |
| `npm run build` | Build the static frontend into `dist/` |
| `npm run preview` | Preview the built frontend locally |
| `npm run server` | Start the server shell; auth/profile routes are still pending |
| `npm run db:migrate` | Apply ordered SQL migrations with locking and tracking |
| `npm run test:server` | M1 PostgreSQL integration tests (currently red on stubs) |

There is no lint, app-container or deployment script yet. Server startup requires DATABASE_URL, APP_ORIGIN and a valid PORT (default 3000). Migrations require MIGRATION_DATABASE_URL. HTTP error handling and shutdown are implemented, but application routes are not yet complete.

### M1 development status

Identity/session tables and tracked migrations are implemented. Schema constraints, migration repeatability and rollback have been checked with an isolated embedded PostgreSQL engine; a Docker/PostgreSQL network integration run is still pending. Shared validation, HTTP error handling and server shutdown are checked locally. The browser REST client implements JSON requests, cached CSRF tokens with one refresh, structured errors and empty responses. Live auth routes and connecting the client to the UI remain incomplete. This is not a tested full-stack release.

Once Docker Desktop is running, start local PostgreSQL with `docker compose up -d db` and copy `.env.example` to `.env`. Compose creates `chatty` and `chatty_test` on first volume initialization. Do not delete an existing volume to recreate the test database; create it separately if missing. Server tests truncate users/sessions and only accept loopback PostgreSQL URLs targeting `chatty_test`. Never target live or development data.

## Exploring the demo

1. Select a conversation or use **New conversation** to start a local chat.
2. Send with Enter; use Shift+Enter for a newline. Input composition is supported.
3. In **Demo controls**, enable **Fail the next message**, send, then retry.
4. Load earlier messages and use **Jump to latest** after scrolling upward.
5. Open **Group details** to compare owner and regular-member controls.
6. Edit your profile or switch themes from the sidebar.

Select **Sign out** to view authentication. Sign-in accepts a valid email and a non-empty password. Sign-up requires a display name of 1–40 characters, a 3–24 character lowercase handle (letters, digits or underscore), and a password of 10–128 characters. Email validation trims spaces and ignores case; passwords are never trimmed. An email containing `error` simulates failure. **Try demo** returns to the workspace. Credentials are not saved or sent; use sample values rather than real credentials.

Demo data uses `chatty.*.v1` localStorage keys. **Reset demo data** restores samples and clears drafts after confirmation, preserving the theme. Current sign-out changes the local session but does not clear all conversations. Avoid entering sensitive information.

## Stack

| Layer | Current | Planned |
| --- | --- | --- |
| Interface | React 19, JavaScript, Bootstrap 5, custom CSS | Preserve the current interface |
| Tooling | Vite 6, npm lockfile | Add linting and CI |
| Icons/avatars | Lucide React, local SVG assets | Reuse existing assets |
| Data | Mock fixtures and localStorage | Supabase-hosted PostgreSQL |
| Server | Express/pg installed; TODO scaffold | Node.js, Express, Socket.IO |
| Auth | Local simulation | Server-managed cookie sessions |
| Verification | Nine model tests and M1 integration test scaffold, currently red | Passing database/browser tests |
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
  server/                    M1 server/migration TODOs and integration tests
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

No remote messages, real identities, verified permissions, uploads, read receipts, calls or end-to-end encryption. Group leave only removes local data; it does not prove server ownership transfer. Older messages/dates are fixtures. Optional Google Fonts have system-font fallbacks.

No hosted release, production readiness or performance benchmark is claimed. Free hosting has quotas and may pause or sleep; verify current conditions before publishing a live demo.
