import express from "express";
import { sendError, toUser } from "./auth.js";
import { withTransaction } from "./db.js";
import { messageBodyError } from "../src/model.js";

// Contract (pinned by server/conversations.test.js). Every route needs a session.
//   conversation: { id, type: "direct", peer: public user, lastMessage: message | null }
//   message: { id, conversationId, clientMessageId, senderId, seq, kind, body, gifId, createdAt }
//            createdAt is an ISO UTC string (a pg Date serializes that way).
//
// POST /conversations/direct { userId }
//      201 { conversation } when created | 200 { conversation } when it already existed
//      400 validation_failed (fieldErrors.userId: not a UUID or your own id) | 404 not_found (no such user)
// GET  /conversations
//      200 { conversations } newest activity first (last message time, else creation time)
// GET  /conversations/:id/messages?beforeSeq=&limit=
//      200 { messages, hasMore }: ascending by seq; the latest page without beforeSeq;
//      beforeSeq is exclusive; limit default 30, clamped to 1–50
//      400 validation_failed when beforeSeq is not a positive integer | 404 not_found unless a member
// POST /conversations/:id/messages { clientMessageId, body }
//      201 { message } | 200 { message } for a repeated clientMessageId (original body kept)
//      400 validation_failed (fieldErrors.clientMessageId / .body) | 404 not_found unless a member
//
// Non-UUID ids are 404 too: never query PostgreSQL with them, never reveal whether a chat exists.
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// SQL used by the routes below. Values are always passed separately ($1, $2, ...),
// never concatenated into the string, so user input cannot change a query.
// Rows come back with snake_case columns; toUser/toMessage turn them into API shapes.
// ---------------------------------------------------------------------------
export const SQL = {
  // Conversations visible to a user ($1), optionally only one of them ($2, or null for all).
  // Columns: conversation_id; the peer as id/handle/display_name/avatar_id (so toUser(row)
  // works directly); the latest message with a "last_" prefix (all null when there is none).
  listConversations: `
    SELECT c.id AS conversation_id,
           peer.id, peer.handle, peer.display_name, peer.avatar_id,
           last.id                AS last_id,
           last.conversation_id   AS last_conversation_id,
           last.client_message_id AS last_client_message_id,
           last.sender_id         AS last_sender_id,
           last.seq               AS last_seq,
           last.kind              AS last_kind,
           last.body              AS last_body,
           last.gif_id            AS last_gif_id,
           last.created_at        AS last_created_at
    FROM chatty.conversation_members me                      -- start from MY memberships
    JOIN chatty.conversations c ON c.id = me.conversation_id
    JOIN chatty.conversation_members other                   -- the other person in the chat
      ON other.conversation_id = c.id AND other.user_id <> me.user_id
    JOIN chatty.users peer ON peer.id = other.user_id
    -- LATERAL runs the subquery once per conversation: its newest message, if any.
    -- The unique (conversation_id, seq) index lets it read a single index entry.
    LEFT JOIN LATERAL (
      SELECT * FROM chatty.messages m
      WHERE m.conversation_id = c.id
      ORDER BY m.seq DESC
      LIMIT 1
    ) last ON true
    WHERE me.user_id = $1
      AND ($2::uuid IS NULL OR c.id = $2)
    -- Newest activity first; c.id breaks ties so the order is stable.
    ORDER BY coalesce(last.created_at, c.created_at) DESC, c.id`,

  // 404 check for "open a chat with this user" ($1 user id).
  userExists: `SELECT 1 FROM chatty.users WHERE id = $1`,

  // Creates the chat unless the pair already has one ($1 direct_key). If another request
  // inserts the same key at the same moment, PostgreSQL waits for it to finish and then does
  // nothing, so exactly one request gets a row back (and only that one inserts the members).
  insertDirect: `
    INSERT INTO chatty.conversations (direct_key) VALUES ($1)
    ON CONFLICT (direct_key) DO NOTHING
    RETURNING id`,
  // Both members in one statement ($1 conversation, $2 and $3 the two users).
  insertMembers: `
    INSERT INTO chatty.conversation_members (conversation_id, user_id)
    VALUES ($1, $2), ($1, $3)`,
  // Used when insertDirect returned no row: the chat already existed ($1 direct_key).
  findDirect: `SELECT id FROM chatty.conversations WHERE direct_key = $1`,

  // Permission check for reading history ($1 conversation, $2 user). Uses the primary key.
  isMember: `
    SELECT 1 FROM chatty.conversation_members
    WHERE conversation_id = $1 AND user_id = $2`,

  // One page of history, newest first ($1 conversation; $2 beforeSeq, exclusive, or null for
  // the latest page; $3 row count: pass limit + 1 to learn whether an older page exists).
  // "seq < beforeSeq" is keyset pagination: it stays fast on deep pages, unlike OFFSET.
  history: `
    SELECT * FROM chatty.messages
    WHERE conversation_id = $1
      AND ($2::int IS NULL OR seq < $2)
    ORDER BY seq DESC
    LIMIT $3`,

  // Send step 1 ($1 conversation, $2 sender). Returns next_seq only if the sender is a
  // member (no row -> 404). FOR UPDATE OF c locks the conversation row until COMMIT, so
  // concurrent sends to the same chat take turns and can never get the same seq.
  lockForSend: `
    SELECT c.next_seq
    FROM chatty.conversations c
    JOIN chatty.conversation_members m
      ON m.conversation_id = c.id AND m.user_id = $2
    WHERE c.id = $1
    FOR UPDATE OF c`,

  // Send step 2: was this clientMessageId ($3) already stored? It runs after the lock, so a
  // parallel duplicate that committed first is visible here and is returned, not re-inserted.
  findSent: `
    SELECT * FROM chatty.messages
    WHERE conversation_id = $1 AND sender_id = $2 AND client_message_id = $3`,

  // Send step 3: store the message with seq = next_seq from step 1 ($4, body $5), then
  // advance the counter. Same transaction, so a failure rolls the counter back too.
  insertMessage: `
    INSERT INTO chatty.messages (conversation_id, sender_id, client_message_id, seq, body)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *`,
  bumpSeq: `UPDATE chatty.conversations SET next_seq = next_seq + 1 WHERE id = $1`,
};

// TODO(M2a): DB row -> message shape above. `prefix` reads prefixed columns, e.g.
// toMessage(row, "last_") for SQL.listConversations (row.last_id, row.last_body, ...).
export function toMessage(row, prefix = "") {
  throw new Error("TODO: toMessage");
}

// TODO(M2a): run SQL.listConversations with [userId, conversationId] and map each row to
// { id: row.conversation_id, type: "direct", peer: toUser(row),
//   lastMessage: row.last_id ? toMessage(row, "last_") : null }.
async function listConversations(db, userId, conversationId = null) {
  throw new Error("TODO: listConversations");
}

export function conversationRoutes({ pool, auth, sendLimit }) {
  const router = express.Router();
  router.use("/conversations", auth);

  // TODO(M2a): validate userId (UUID, not your own id). Lowercase it first: clients may
  // send uppercase UUIDs, but the direct_key check only accepts lowercase.
  // direct_key = [me, other].sort().join(":"). In one withTransaction:
  //   SQL.userExists (no row -> 404) -> SQL.insertDirect -> got a row? SQL.insertMembers (201)
  //   : SQL.findDirect (200). Respond with (await listConversations(db, me, id))[0].
  router.post("/conversations/direct", async (req, res) => {
    throw new Error("TODO: POST /conversations/direct");
  });

  router.get("/conversations", async (req, res) => {
    throw new Error("TODO: GET /conversations");
  });

  // TODO(M2a): non-UUID id -> 404; beforeSeq must be a positive integer or absent (null);
  // clamp limit. SQL.isMember (no row -> 404), then SQL.history with limit + 1:
  // more rows than limit means hasMore; drop the extra one and reverse to ascending.
  router.get("/conversations/:id/messages", async (req, res) => {
    throw new Error("TODO: GET /conversations/:id/messages");
  });

  // TODO(M2a): non-UUID id -> 404; validate clientMessageId (UUID) and
  // messageBodyError(body). Then in one withTransaction:
  //   1. SQL.lockForSend   no row -> 404
  //   2. SQL.findSent      row -> 200 with that message (the original body is kept)
  //   3. SQL.insertMessage (seq = next_seq) + SQL.bumpSeq -> 201
  router.post("/conversations/:id/messages", sendLimit, async (req, res) => {
    throw new Error("TODO: POST /conversations/:id/messages");
  });

  return router;
}
