-- M3a: group conversations. Existing rows are direct chats and stay valid unchanged.
-- migrate.js runs this file in one transaction: it applies fully or not at all.

alter table chatty.conversations
  -- Existing rows and the direct-chat insert keep relying on the 'direct' default.
  add column type text not null default 'direct' check (type in ('direct', 'group')),
  -- Group name: 1–48 characters, stored already trimmed (the API trims before insert).
  add column name text
    check (name is null or (char_length(name) between 1 and 48 and name = btrim(name))),
  -- The single owner of an open group. Only owners add/remove members or transfer ownership.
  -- shortcut: no index on owner_id; only a user delete would scan by it. Add one with
  -- account deletion, like messages.sender_id.
  add column owner_id uuid references chatty.users (id),
  -- Set when the last member leaves. History is kept; nobody can read or send any more,
  -- because nobody is a member.
  add column closed_at timestamptz,
  -- Groups have no pair key. Unique still applies to the non-null keys of direct chats.
  alter column direct_key drop not null;

-- Which columns each kind of conversation must (not) have, enforced by the database so a
-- bug cannot create half a group:
--   direct: has direct_key; no name, owner or closed_at.
--   group:  has a name and no direct_key; an open group has an owner, a closed one has none.
alter table chatty.conversations add constraint conversations_shape_check check (
  case type
    when 'direct' then direct_key is not null and name is null
                       and owner_id is null and closed_at is null
    else direct_key is null and name is not null
         and (owner_id is not null) = (closed_at is null)
  end
);
