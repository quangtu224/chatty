// Read-only release check, used by CI and the local release/rollback runbook:
//   npm run smoke -- http://127.0.0.1:3000 <full-sha|development>
// Proves the running server is the expected revision and that the frontend, its
// assets, the API and the database answer. It creates no accounts or data.
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

const [origin, sha] = process.argv.slice(2);
if (!origin || !/^(?:[a-f0-9]{40}|development)$/.test(sha ?? ""))
  throw new Error("Usage: npm run smoke -- http://127.0.0.1:3000 <full-sha>");
// Only a bare origin: no path, query or embedded credentials.
const target = new URL(origin);
if (!["http:", "https:"].includes(target.protocol) || target.origin !== origin)
  throw new Error("Supply an HTTP(S) origin without a path, query or credentials.");
const request = (path) => fetch(`${origin}${path}`, { signal: AbortSignal.timeout(5000) });

// Wait up to ~30 s for the new container to become ready with the requested SHA.
let ready = false;
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    const response = await request("/health/ready");
    const health = await response.json();
    if (response.ok && health.status === "ok" && health.sha === sha) {
      ready = true;
      break;
    }
  } catch {
    // Startup can briefly refuse the connection; try again.
  }
  await delay(1000);
}
assert.ok(ready, "Readiness did not report the requested SHA.");

const live = await request("/health/live");
assert.equal(live.status, 200);
assert.equal((await live.json()).sha, sha);

// The built frontend is served same-origin, and its JavaScript entry loads.
const home = await request("/");
assert.equal(home.status, 200);
const html = await home.text();
assert.match(html, /<title>Chatty/);
const asset = html.match(/src="([^"\s]*\/assets\/[^"\s]+\.js)"/)?.[1];
assert.ok(asset, "Built JavaScript entry missing.");
assert.equal((await request(asset)).status, 200);

// API basics: signed-out is 401, unknown API routes stay JSON 404 (not the SPA page),
// and a CSRF token is issued.
assert.equal((await request("/api/v1/me")).status, 401);
assert.equal((await request("/api/v1/not-a-route")).status, 404);
const csrf = await request("/api/v1/auth/csrf");
assert.equal(csrf.status, 200);
assert.ok((await csrf.json()).csrfToken);
console.log(`Smoke passed: frontend, assets, API and readiness for ${sha}.`);
