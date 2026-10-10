import { createApp } from "./app.js";
import { createPool } from "./db.js";
import { createServer } from "node:http";
import { createRealtime } from "./realtime.js";

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
  const port = process.env.PORT ?? "3000";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    throw new Error("PORT must be a number between 1 and 65535.");

  const pool = createPool(DATABASE_URL);
  let realtime;
  const app = createApp({
    pool, appOrigin: APP_ORIGIN, secureCookies: NODE_ENV === "production",
    onMessage: (message) => realtime.publishMessage(message),
    onSessionRevoked: (token) => realtime.revokeSession(token),
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
    try { await stopServer(server, pool, realtime); } catch {
      console.error("Server shutdown failed.");
      process.exitCode = 1;
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
