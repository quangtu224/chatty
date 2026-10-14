-- Existing email values remain private legacy data; new accounts no longer need one.
-- Keep the unique handle/IDs/passwords/sessions and existing chat history unchanged.
ALTER TABLE chatty.users ALTER COLUMN email DROP NOT NULL;
