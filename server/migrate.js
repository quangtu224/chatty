import { readdir, readFile } from "node:fs/promises";
import { createPool } from "./db.js";

const dir = new URL("./migrations/", import.meta.url);

export async function migrate(pool) {
  const sqlFiles = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied = [];
  const client = await pool.connect();
  let locked = false;
  let broken;
  try {
    // A session lock must stay on this connection until every migration finishes.
    await client.query("SELECT pg_advisory_lock(1128813657)");
    locked = true;
    await client.query("CREATE SCHEMA IF NOT EXISTS chatty");
    await client.query("REVOKE ALL ON SCHEMA chatty FROM PUBLIC");
    await client.query(`CREATE TABLE IF NOT EXISTS chatty.schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    for (const file of sqlFiles) {
      const { rows } = await client.query(
        "SELECT name FROM chatty.schema_migrations WHERE name = $1", [file],
      );
      if (rows.length) continue;
      const sql = await readFile(new URL(file, dir), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO chatty.schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        applied.push(file);
      } catch (err) {
        await client.query("ROLLBACK").catch((rollbackErr) => (broken = rollbackErr));
        throw err;
      }
    }
    return applied;
  } finally {
    if (locked && !broken) {
      await client.query("SELECT pg_advisory_unlock(1128813657)")
        .catch((unlockErr) => (broken = unlockErr));
    }
    client.release(broken);
  }
}

if (import.meta.main) {
  if (!process.env.MIGRATION_DATABASE_URL)
    throw new Error("MIGRATION_DATABASE_URL is required.");
  const pool = createPool(process.env.MIGRATION_DATABASE_URL);
  try {
    const applied = await migrate(pool);
    console.log(
      applied.length ? `Applied: ${applied.join(", ")}` : "Up to date.",
    );
  } finally {
    await pool.end();
  }
}
