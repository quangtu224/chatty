# Chatty

A calm chat workspace for small teams, with a developer-friendly interface and original pixel-art avatars.

This baseline is an interactive frontend prototype. Real accounts, database persistence, server authorization and remote messaging are planned, not implemented.

## Quick start

Use Node.js 22 LTS or a newer supported release and npm. From this directory:

```sh
npm ci
npm run dev
```

Open Vite's printed URL. No database, environment variables or API key is needed.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the frontend |
| `npm test` | Run two model tests |
| `npm run build` | Build the frontend into dist/ |
| `npm run preview` | Preview the built frontend |

## Features

- Responsive direct/group chat views, conversation search and teammate picker.
- Local message composition, multiline input, sending/failed states and retry.
- Sample history pagination, scroll preservation and Jump to latest.
- Local group/member management, profile editing, pixel avatars and light/dark themes.
- Demo controls for loading, typing, network failure and retry.
- Browser persistence of demo conversations, drafts, profile and theme.

The first visit opens the sample workspace. Select **Sign out** for auth screens. Any valid email and password of eight or more characters passes local validation; an email containing `error` simulates failure. **Try demo** returns to the workspace. Credentials are not saved or sent; use sample values.

Send with Enter, Shift+Enter for a newline. **Reset demo data** restores samples and drafts after confirmation, preserving theme. State lives under `chatty.*.v1` localStorage keys; sign-out does not clear all local data. Do not enter private information.

## Source structure

- `src/App.jsx`: local state and prototype interactions.
- `src/components/`: Auth, Chat, Sidebar, dialogs and shared UI primitives.
- `src/model.js` and `src/model.test.js`: validation, storage, retry updates and tests.
- `src/data.js`: mock people/history needed for the public demo.
- `src/styles.css`: responsive layout and theme tokens.
- `public/avatars/`: runtime pixel-art SVGs.
- `docs/IMPLEMENTATION_SPEC.md`: proposed full-stack requirements.

Runtime stack: React 19, JavaScript, Bootstrap 5 and Lucide React; Vite 6 for builds. Optional Google Fonts have system-font fallbacks.

## Planned full-stack work

Express and Socket.IO with Supabase-hosted PostgreSQL, real sessions/permissions, durable chat and reconnect synchronization, followed by Docker and CI/CD. See the [implementation specification](docs/IMPLEMENTATION_SPEC.md). No server, migration, Docker or deployment commands are part of this baseline.

## Limitations

Authentication, presence, typing, unread state, delivery, pagination and group permissions are mocked. Group leave does not prove ownership transfer. Sent means local completion, not received or read. No uploads, calls, read receipts or end-to-end encryption. No production readiness or performance benchmark is claimed.

Source, tests, assets, lockfiles and public engineering docs belong in Git. Secrets, dependency/build folders, private design materials and local agent notes are excluded.
