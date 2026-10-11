-- Local Compose only; these public demo credentials are never used on a hosted DB.
-- Re-runnable on existing volumes. Migrations continue to use the schema owner.
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
