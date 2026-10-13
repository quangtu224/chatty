import { createApp } from "./app.js";
import { createPool } from "./db.js";
import { createServer } from "node:http";
import { createRealtime } from "./realtime.js";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function stopServer(server, pool, realtime) {
  try {
    // Realtime owns the shared HTTP server when present; never close it twice.
    if (realtime) await realtime.close();
    else await new Promise((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve());
    });
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  const { DATABASE_URL, APP_ORIGIN, NODE_ENV } = process.env;
  if (!DATABASE_URL) throw new Error("DATABASE_URL is required.");
  let origin;
  try { origin = new URL(APP_ORIGIN); } catch {
    throw new Error("APP_ORIGIN must be a valid HTTP or HTTPS origin.");
  }
  if (!["http:", "https:"].includes(origin.protocol) || origin.origin !== APP_ORIGIN)
    throw new Error("APP_ORIGIN must contain only its scheme, host and optional port.");
  // Production sets Secure cookies, which browsers drop on plain HTTP.
  if (NODE_ENV === "production" && origin.protocol !== "https:")
    throw new Error("Production APP_ORIGIN must use HTTPS. Use NODE_ENV=development for local HTTP.");
  // The Docker image bakes in its Git SHA; health reports it (see scripts/smoke.mjs).
  const releaseSha = process.env.RELEASE_SHA ?? "development";
  if (releaseSha !== "development" && !/^[a-f0-9]{40}$/.test(releaseSha))
    throw new Error("RELEASE_SHA must be a full Git SHA.");
  // Serve the built frontend when dist/ exists (Docker); `npm run server` in
  // development usually has none and Vite serves the UI instead.
  const frontendDir = fileURLToPath(new URL("../dist/", import.meta.url));
  const hasFrontend = existsSync(new URL("../dist/index.html", import.meta.url));
  if (NODE_ENV === "production" && !hasFrontend)
    throw new Error("Build the frontend before starting production.");
  const port = process.env.PORT ?? "3000";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    throw new Error("PORT must be a number between 1 and 65535.");

  // TRUST_PROXY: hops of reverse proxies in front (1 on most hosts, unset locally).
  const trustProxy = Number(process.env.TRUST_PROXY ?? 0);
  if (!Number.isInteger(trustProxy) || trustProxy < 0 || trustProxy > 5)
    throw new Error("TRUST_PROXY must be a whole number of proxies (0-5).");

  const pool = createPool(DATABASE_URL);
  let realtime;
  const app = createApp({
    pool, appOrigin: APP_ORIGIN, secureCookies: NODE_ENV === "production",
    frontendDir: hasFrontend ? frontendDir : undefined,
    releaseSha,
    trustProxy,
    // JSON lines on stdout: Docker/hosting collects them (docker compose logs app).
    logger: (record) => console.log(JSON.stringify(record)),
    onMessage: (message) => realtime.publishMessage(message),
    onSessionRevoked: (token) => realtime.revokeSession(token),
    // Revoke first: a removed member's tabs drop the chat before others see the new list.
    onGroupChanged: async (id, revoked = []) => {
      await realtime.revokeAccess(id, revoked);
      await realtime.publishConversation(id);
    },
    onRead: (userId, id, seq) => realtime.publishRead(userId, id, seq),
  });
  const server = createServer(app);
  // Attach Socket.IO before listening so writes and pushes share the same runtime.
  realtime = createRealtime(server, { pool, appOrigin: APP_ORIGIN });
  server.listen(Number(port), () => {
    console.log(`Server listening on port ${server.address().port}`);
  });
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    // Bound shutdown so a stuck connection cannot hold a container stop indefinitely.
    // Docker sends SIGTERM and kills after its grace period (15 s in Compose).
    const deadline = setTimeout(() => process.exit(1), 10_000);
    deadline.unref();
    try { await stopServer(server, pool, realtime); } catch {
      console.error("Server shutdown failed.");
      process.exitCode = 1;
    } finally {
      clearTimeout(deadline);
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  server.on("error", async () => {
    console.error("Unable to start the HTTP server.");
    process.exitCode = 1;
    await shutdown();
  });
}
