-- The migration runner creates the private chatty schema.
CREATE TABLE chatty.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(btrim(email)) and char_length(email) > 0),
  handle text not null unique check (handle ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null check (char_length(display_name) between 1 and 40 and display_name = btrim(display_name)),
  password_hash text not null,
  avatar_id text not null default 'cat' check (avatar_id in ('cat', 'fox', 'raccoon', 'owl', 'frog', 'bear')),
  created_at timestamptz not null default now()
);

CREATE TABLE chatty.sessions (
  token_hash bytea primary key check (octet_length(token_hash) = 32),
  user_id uuid not null references chatty.users(id),
  expires_at timestamptz not null
);

CREATE INDEX sessions_user_id_idx ON chatty.sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON chatty.sessions (expires_at);

REVOKE ALL ON chatty.users, chatty.sessions FROM PUBLIC;
