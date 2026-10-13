import pg from "pg";

// Hosted connections need verified TLS: in production (app and migrations) the URL
// must say sslmode=verify-full, so pg checks the server certificate and host name.
// Supabase's CA is not a public root; add sslrootcert=<path to its CA file> or set
// NODE_EXTRA_CA_CERTS (see docs/OPERATIONS.md). Local HTTP/Compose runs development.
export function createPool(connectionString) {
  if (process.env.NODE_ENV === "production" &&
      new URL(connectionString).searchParams.get("sslmode") !== "verify-full")
    throw new Error("Production database URLs need sslmode=verify-full.");
  return new pg.Pool({
    connectionString,
    max: 10,
    // Fail fast instead of hanging a request when the database is unreachable,
    // close idle connections, and stop any single query after 10 s.
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
  });
}

export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  let broken;
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    // A failed ROLLBACK leaves the connection unusable; keep the original error.
    await client.query("ROLLBACK").catch((rollbackErr) => (broken = rollbackErr));
    throw err;
  } finally {
    client.release(broken);
  }
}
