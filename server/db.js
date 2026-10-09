import pg from "pg";

// Hosted connections need verified TLS (M5).
export function createPool(connectionString) {
  return new pg.Pool({ connectionString, max: 10 });
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
