# Local delivery and recovery

This runbook covers Docker/local and GitHub CI. Hosted PostgreSQL, HTTPS hosting and cloud CD are deferred by the owner. Public Compose credentials are local examples; both exposed ports bind to loopback. Do not expose this configuration to a public network.

## Prerequisites and release

Use Node.js 24.7+, npm, Git and Docker Compose v2. Copy `.env.example` to `.env` without replacing an existing configuration. Start `docker compose up -d db` and install with `npm ci`. The owner's private test files must be present for a gated release; a fresh public clone can build/run a demo but cannot claim those tests passed.

Commit the source first, then run:

```sh
npm run release:local
```

The script requires clean Git HEAD, runs lint/private unit/API/PostgreSQL tests/build, rechecks the source, builds `chatty:<full HEAD SHA>` and starts Compose. A failed local check stops before build/deployment. Compose waits for PostgreSQL, runs locked migrations, provisions the restricted app role and only then starts the app. Failed migrations/grants block the new app. Grants are listed per table in `docker/runtime-role.sql`; provisioning fails if a migration adds a table or sequence without a matching grant, so add one with every new table. A read-only smoke check verifies frontend/assets, API and the exact SHA from readiness. The non-root app uses a read-only filesystem, dropped capabilities and bounded shutdown. Build context excludes tests, `.env`, private notes and coursework.

Default URL: `http://127.0.0.1:3000`. If occupied, set `APP_PORT=3105` in `.env` or your shell before releasing. Local Compose deliberately uses `NODE_ENV=development` for HTTP cookies; the image defaults to production and requires an HTTPS `APP_ORIGIN`. This is one app process, which is required by in-memory presence/rate limits.

For a public clone without private tests, use an explicitly ungated development run:

```sh
docker compose --env-file .env.example build app
docker compose --env-file .env.example up -d --wait app
npm run smoke -- http://127.0.0.1:3000 development
```

This development image is labeled `development`, not a verified release. Never invent a SHA label for uncommitted source. `docker compose ps -a` shows the migration/provision jobs exiting successfully and app/db health; `docker compose logs app` contains request IDs, route patterns, status and duration, excluding bodies/cookies/query strings. `/health/live` checks the process; `/health/ready` checks database connectivity. Both include the image SHA. Health does not prove every feature works.

Local Compose updates can interrupt availability while replacing the app; zero-downtime deployment is not promised. A failed migration prevents the new app starting. Restore service with a retained compatible image after diagnosing the failure.

## Rollback

Keep the last verified image locally. Record its SHA, image ID and a passing smoke result. Stop/start only the app with that retained image; do not rebuild old source under the old tag or reverse migrations automatically. Additive migrations must stay compatible with the previous app.

PowerShell:

```powershell
$env:RELEASE_SHA = '<previous verified full SHA>'
docker image inspect "chatty:$env:RELEASE_SHA" --format '{{.Id}}'
docker compose up -d --no-deps --no-build --wait --wait-timeout 60 app
npm run smoke -- "http://127.0.0.1:$env:APP_PORT" "$env:RELEASE_SHA"
```

Set `APP_PORT` to the port of the running stack first (default 3000). POSIX shells use `export RELEASE_SHA=<sha>` and `export APP_PORT=3000` with equivalent commands. This reuses the current database and skips migration/provision jobs. If the old app cannot read the additive schema, stop and fix compatibility; do not delete the volume. Undo a faulty data change through a reviewed forward migration or a separately rehearsed restore.

## Backup and restore rehearsal

Preserve the named `pgdata` volume across app updates. Never use `docker compose down -v` on a stack whose data matters. Back up before schema/data changes. Example local backup (passwords/hashes/message data are private):

```sh
docker compose exec -T db pg_dump -U chatty -d chatty -Fc -f /tmp/chatty-backup.dump
docker compose cp db:/tmp/chatty-backup.dump .local-backups/chatty-backup.dump
```

Create `.local-backups` if needed; it is ignored. Rehearse restore into a **new database**, never overwrite the live one:

```sh
docker compose exec -T db createdb -U chatty chatty_restore_check
docker compose exec -T db pg_restore -U chatty -d chatty_restore_check --no-owner /tmp/chatty-backup.dump
docker compose exec -T db psql -U chatty -d chatty_restore_check -c 'SELECT count(*) FROM chatty.schema_migrations;'
```

Restore creates owner/schema objects; provision runtime grants separately before running an app against a restored database. Verify users, message counts, sequence ordering and authentication on the restored copy. Document when the backup was taken and data that would be lost since then. Do not commit dump files or personal chat data.

## Hosted settings

Prepared and tested locally; not yet exercised against a real host.

- `NODE_ENV=production` (image default): HTTPS `APP_ORIGIN`, Secure cookies and HSTS.
- `DATABASE_URL` and `MIGRATION_DATABASE_URL` must use `sslmode=verify-full`, or the process refuses to start. Supabase signs with its own CA: download it from the project's database settings and add `&sslrootcert=<path>` or set `NODE_EXTRA_CA_CERTS=<path>`. Use separate migration (owner) and runtime (DML-only) credentials.
- `TRUST_PROXY=1` behind one hosting proxy, so per-IP rate limits see real clients. Leave it unset without a proxy: a spoofed `X-Forwarded-For` would bypass the limits.
- Every response sends a Content-Security-Policy (same-origin scripts/sockets, GIPHY images, Google Fonts), `nosniff`, `no-referrer` and `frame-ancestors 'none'`. A new external image, font or script host needs a CSP update in `server/app.js`.

## Render + Supabase (hosted release)

Only `main` is deployed. `render.yaml` (Render Blueprint) pins the service to `main` with `autoDeployTrigger: checksPass`, so Render deploys a `main` commit only after its GitHub CI check passes. Milestone branches run CI but never deploy. Merge milestone PRs into `main` in order and require `lint-migrate-build-smoke` in branch protection.

Render builds the `Dockerfile` from GitHub and sets `RENDER_GIT_COMMIT`, which health reports as the SHA.

1. Supabase: download the CA from Database Settings → SSL Configuration. Use the **Session pooler** connection (IPv4, port 5432): the migration advisory lock needs a session, and the direct host is IPv6-only by default. URL-encode passwords.
2. Before merging code that needs a new migration, run it once from a trusted machine as the owner (`postgres.<project-ref>`): `NODE_ENV=production`, `MIGRATION_DATABASE_URL=...?sslmode=verify-full&sslrootcert=<local CA path>`, `npm run db:migrate`. Migrations must stay additive so the running app keeps working.
3. Runtime role, once: create `chatty_app` with a strong password, then run `docker/runtime-role.sql` (it skips creation, applies grants and fails on any ungranted table). The app connects as `chatty_app.<project-ref>`.
4. Render, once: **New → Blueprint** from `main`. Enter `DATABASE_URL=...?sslmode=verify-full&sslrootcert=/app/certs/supabase-ca.crt` (the image ships Supabase's public root CA in `certs/`) and optional `GIPHY_API_KEY`. If `/health/ready` returns 503, the log line `db_unavailable` names the error code. Do not set `NODE_ENV`, `PORT` or `APP_ORIGIN`: the server uses Render's `RENDER_EXTERNAL_URL` unless `APP_ORIGIN` is set for a custom domain.
5. After each deploy: `npm run smoke -- https://<service>.onrender.com <full main SHA>`.
6. Rollback: in Render, redeploy the last good deploy (its SHA from the previous smoke); never roll back the schema.

Free limits: the service sleeps after 15 minutes idle (about a minute to wake), runs one instance and may restart at any time; a free Supabase project pauses after inactivity. Pre-deploy commands are not used, so step 2 stays manual.

## GitHub CI

`.github/workflows/ci.yml` runs on main/milestone branch pushes, pull requests and manual dispatch. It uses read-only permissions and pinned Actions, installs the lockfile, lints, applies/re-runs migrations on an isolated PostgreSQL 17 database, builds frontend/image and runs SHA-aware container smoke as a restricted database user. Failed steps fail the job. The check is `lint-migrate-build-smoke`; require it for `main` in repository branch protection before merging. Private suites are intentionally absent from public CI; run `npm run verify` locally before every push.

Status 2026-10-13: CI passed on GitHub for `m5-delivery`. The Supabase schema is migrated over verified TLS; `chatty` is not visible to Supabase's API roles, and `chatty_app` was checked to have DML-only access. Branch protection, the Render deployment and an HTTPS smoke run are not done yet.

## Portfolio evidence and recording

Record a short demo using test accounts only: two-account direct chat; create group/add/transfer/remove; unread while scrolled away; reconnect after more than 30 missed messages; `/gif` with a configured key or clearly labeled unavailable state; Docker health showing SHA. Use desktop and a 360–390px mobile viewport. Avoid showing `.env`, cookies, email/password entry, terminal credentials or private school material. Capture actual behavior before describing it on a CV. A local 20-socket timing check is not evidence of hosted capacity or latency.
