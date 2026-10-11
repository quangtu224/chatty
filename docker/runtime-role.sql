-- Local Compose and CI only; these public demo credentials are never used on a hosted DB.
-- Re-runnable on existing volumes. Migrations continue to use the schema owner (chatty);
-- the app process connects as chatty_app with the least privileges it needs.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'chatty_app') THEN
    CREATE ROLE chatty_app LOGIN PASSWORD 'chatty_app_local';
  END IF;
END $$;
GRANT USAGE ON SCHEMA chatty TO chatty_app;
GRANT SELECT, INSERT, UPDATE ON chatty.users, chatty.conversations TO chatty_app;
GRANT SELECT, INSERT, DELETE ON chatty.sessions TO chatty_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON chatty.conversation_members TO chatty_app;
GRANT SELECT, INSERT ON chatty.messages TO chatty_app;
-- No DDL, migration-ledger access, or message deletion for the app process.

-- Guard for future migrations: grants are listed per table on purpose (least privilege),
-- so a new table or sequence would otherwise be unreadable by the app. Private tests run
-- as the owner and would not notice; this check fails provisioning instead, so Compose
-- never starts the app and CI goes red. Fix: add the new object's GRANT above.
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO missing
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'chatty'
    AND c.relkind IN ('r', 'p', 'S')            -- tables, partitioned tables, sequences
    AND c.relname <> 'schema_migrations'        -- the ledger stays owner-only
    AND NOT has_table_privilege('chatty_app', c.oid, 'SELECT');
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'chatty_app has no grant on: % (update docker/runtime-role.sql)', missing;
  END IF;
END $$;
