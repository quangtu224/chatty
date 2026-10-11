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
// GET  /conversations/:id/messages?beforeSeq=&limit=   (older pages)
// GET  /conversations/:id/messages?afterSeq=&limit=    (catch-up, M4)
//      200 { messages, hasMore }: ascending by seq; the latest page without a cursor;
//      beforeSeq/afterSeq are exclusive; limit default 30, clamped to 1–50.
//      hasMore: an older page exists (beforeSeq/no cursor) or a newer one (afterSeq).
//      400 validation_failed: beforeSeq not a positive integer, afterSeq not a whole number
//      >= 0, or both given | 404 not_found unless a member
// POST /conversations/:id/messages { clientMessageId, body, kind?: "text"|"gif", gifId? }
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
  // Columns: conversation_id, type, name, owner_id, member_count; for direct chats the peer
  // as id/handle/display_name/avatar_id (so toUser(row) works directly; all null for groups);
  // the latest message with a "last_" prefix (all null when there is none);
  // last_read_seq (my read cursor) and unread_count (others' messages after it).
  listConversations: `
    SELECT c.id AS conversation_id, c.type, c.name, c.owner_id,
           (SELECT count(*)::int FROM chatty.conversation_members cm
            WHERE cm.conversation_id = c.id) AS member_count,
           me.last_read_seq,
           -- Messages after my cursor that someone else sent. My own messages never count
           -- as unread. Reads a seq range of the (conversation_id, seq) index.
           (SELECT count(*)::int FROM chatty.messages um
            WHERE um.conversation_id = c.id
              AND um.seq > me.last_read_seq
              AND um.sender_id <> me.user_id) AS unread_count,
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
    -- The other person, for direct chats only. A plain JOIN would repeat a group once per
    -- member; LATERAL ... LIMIT 1 with LEFT JOIN keeps exactly one row per conversation.
    LEFT JOIN LATERAL (
      SELECT u.* FROM chatty.conversation_members other
      JOIN chatty.users u ON u.id = other.user_id
      WHERE c.type = 'direct'
        AND other.conversation_id = c.id AND other.user_id <> me.user_id
      LIMIT 1
    ) peer ON true
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

  // Catch-up page ($1 conversation, $2 afterSeq exclusive, $3 limit + 1 to learn whether a
  // newer page exists). Oldest first, so repeated calls walk forward without gaps; uses the
  // unique (conversation_id, seq) index like history.
  catchUp: `
    SELECT * FROM chatty.messages
    WHERE conversation_id = $1 AND seq > $2
    ORDER BY seq ASC
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
    INSERT INTO chatty.messages (conversation_id, sender_id, client_message_id, seq, body, kind, gif_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *`,
  bumpSeq: `UPDATE chatty.conversations SET next_seq = next_seq + 1 WHERE id = $1`,

  // Moves my read cursor ($1 conversation, $2 me, $3 seq) forward, never back:
  // GREATEST keeps the larger value, so a late or out-of-order request cannot "unread"
  // messages, and two tabs updating at once both end at the higher value (one atomic UPDATE).
  // "$3 < next_seq" rejects cursors beyond the newest stored message (no row comes back).
  // Returns the cursor after the update. Run SQL.isMember first to tell 404 from 400.
  markRead: `
    UPDATE chatty.conversation_members cm
    SET last_read_seq = GREATEST(cm.last_read_seq, $3::int)
    FROM chatty.conversations c
    WHERE c.id = cm.conversation_id
      AND cm.conversation_id = $1 AND cm.user_id = $2
      AND $3::int < c.next_seq
    RETURNING cm.last_read_seq`,
};

// DB row -> API message. `prefix` reads prefixed columns, e.g. toMessage(row, "last_")
// for SQL.listConversations (row.last_id, row.last_body, ...). Returns null when the
// row has no message (a conversation without messages yet).
export function toMessage(row, prefix = "") {
  const id = row[`${prefix}id`];
  if (!id) return null;
  return {
    id,
    conversationId: row[`${prefix}conversation_id`],
    clientMessageId: row[`${prefix}client_message_id`],
    senderId: row[`${prefix}sender_id`],
    seq: row[`${prefix}seq`],
    kind: row[`${prefix}kind`],
    body: row[`${prefix}body`],
    gifId: row[`${prefix}gif_id`],
    // pg returns timestamptz as a Date; ISO strings are always UTC ("...Z").
    createdAt: row[`${prefix}created_at`].toISOString(),
  };
}

// Conversations visible to userId: all of them, or only conversationId when given.
// The SQL returns one row per conversation; the API shape depends on its type:
//   direct: { id, type: "direct", peer, lastMessage }  (peer columns are the other user)
//   group:  { id, type: "group", name, ownerId, memberCount, lastMessage }
//           (peer columns are null for groups, so no peer is exposed)
// Both shapes also carry my read state: lastReadSeq (my cursor) and unreadCount
// (other people's messages after it).
export async function listConversations(db, userId, conversationId = null) {
  const { rows } = await db.query(SQL.listConversations, [
    userId,
    conversationId,
  ]);
  return rows.map((row) => {
    const lastMessage = toMessage(row, "last_");
    const readState = {
      lastReadSeq: row.last_read_seq,
      unreadCount: row.unread_count,
    };
    if (row.type === "group")
      return {
        id: row.conversation_id,
        type: "group",
        name: row.name,
        ownerId: row.owner_id,
        memberCount: row.member_count,
        lastMessage,
        ...readState,
      };
    return {
      id: row.conversation_id,
      type: "direct",
      peer: toUser(row),
      lastMessage,
      ...readState,
    };
  });
}

// PostgreSQL integer limit; a larger beforeSeq would make the query itself fail (500).
const MAX_SEQ = 2_147_483_647;

// Strict positive-integer parser for query strings: "12" -> 12; "1.5", "-3", "0x10",
// "abc", arrays (?a=1&a=2) and out-of-range values -> null.
function positiveInt(value) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const n = Number(value);
  return n <= MAX_SEQ ? n : null;
}
// Same, but also accepts "0" (afterSeq=0 means "from the first message").
const wholeInt = (value) => (value === "0" ? 0 : positiveInt(value));

export function conversationRoutes({
  pool,
  auth,
  sendLimit,
  onMessage = async () => {},
  onRead = async () => {},
}) {
  const router = express.Router();
  // Every conversation route needs a signed-in user (sets req.user).
  router.use("/conversations", auth);

  // One response for "does not exist" and "not yours", so outsiders cannot probe ids.
  const notFound = (req, res) =>
    sendError(req, res, 404, "not_found", "Conversation not found.");
  const invalid = (req, res, fieldErrors) =>
    sendError(
      req,
      res,
      400,
      "validation_failed",
      "Check the highlighted fields.",
      fieldErrors,
    );

  // Open (or create) the direct chat between the caller and req.body.userId.
  router.post("/conversations/direct", async (req, res) => {
    const me = req.user.id;
    const raw = req.body?.userId;
    // Lowercase: clients may send uppercase UUIDs, but direct_key only accepts lowercase.
    const other =
      typeof raw === "string" && UUID.test(raw) ? raw.toLowerCase() : null;
    if (!other) return invalid(req, res, { userId: "Choose a teammate." });
    if (other === me)
      return invalid(req, res, {
        userId: "You can’t start a chat with yourself.",
      });

    // Sorting makes A->B and B->A produce the same key (the unique constraint does the rest).
    const directKey = [me, other].sort().join(":");
    const result = await withTransaction(pool, async (db) => {
      if (!(await db.query(SQL.userExists, [other])).rowCount) return null;
      const inserted = await db.query(SQL.insertDirect, [directKey]);
      let id;
      if (inserted.rowCount) {
        // This request created the chat, so it also adds both members.
        id = inserted.rows[0].id;
        await db.query(SQL.insertMembers, [id, me, other]);
      } else {
        // The pair already had a chat (maybe created a moment ago by a parallel request).
        id = (await db.query(SQL.findDirect, [directKey])).rows[0].id;
      }
      const [conversation] = await listConversations(db, me, id);
      return { conversation, created: inserted.rowCount === 1 };
    });
    if (!result)
      return sendError(
        req,
        res,
        404,
        "not_found",
        "That teammate doesn’t exist.",
      );
    res
      .status(result.created ? 201 : 200)
      .json({ conversation: result.conversation });
  });

  router.get("/conversations", async (req, res) => {
    res.json({ conversations: await listConversations(pool, req.user.id) });
  });

  // One page of history. Without a cursor: the latest page. Always ascending by seq.
  router.get("/conversations/:id/messages", async (req, res) => {
    const { id } = req.params;
    // Checked before any query: PostgreSQL would reject a malformed uuid with a 500.
    if (!UUID.test(id)) return notFound(req, res);

    let beforeSeq = null;
    if (req.query.beforeSeq !== undefined) {
      beforeSeq = positiveInt(req.query.beforeSeq);
      if (beforeSeq === null)
        return invalid(req, res, { beforeSeq: "Use a positive whole number." });
    }
    let afterSeq = null;
    if (req.query.afterSeq !== undefined) {
      afterSeq = wholeInt(req.query.afterSeq);
      if (afterSeq === null)
        return invalid(req, res, { afterSeq: "Use a whole number of 0 or more." });
      if (beforeSeq !== null)
        return invalid(req, res, { afterSeq: "Use either beforeSeq or afterSeq, not both." });
    }
    // Lenient like /users: a bad or missing limit falls back to 30; range is 1–50.
    const limit = Math.min(Math.max(positiveInt(req.query.limit) ?? 30, 1), 50);

    if (!(await pool.query(SQL.isMember, [id, req.user.id])).rowCount)
      return notFound(req, res);
    // Fetch one extra row: if it exists, another page exists in the same direction.
    const { rows } = afterSeq === null
      ? await pool.query(SQL.history, [id, beforeSeq, limit + 1])
      : await pool.query(SQL.catchUp, [id, afterSeq, limit + 1]);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    // history comes newest first; catch-up already ascends.
    if (afterSeq === null) page.reverse();
    res.json({ messages: page.map((row) => toMessage(row)), hasMore });
  });

  // Text and GIFs share the same membership, sequence and idempotency checks.
  router.post("/conversations/:id/messages", sendLimit, async (req, res) => {
    const { id } = req.params;
    if (!UUID.test(id)) return notFound(req, res);
    const {
      clientMessageId,
      body,
      kind = "text",
      gifId = null,
    } = req.body ?? {};
    const fieldErrors = {};
    if (typeof clientMessageId !== "string" || !UUID.test(clientMessageId))
      fieldErrors.clientMessageId =
        "Missing message id. Refresh and try again.";
    const bodyError = messageBodyError(body);
    if (bodyError) fieldErrors.body = bodyError;
    if (!["text", "gif"].includes(kind))
      fieldErrors.kind = "Choose text or GIF.";
    // Only an ID is stored; user-supplied URLs never reach the renderer.
    if (
      kind === "gif"
        ? typeof gifId !== "string" || !/^[A-Za-z0-9]{1,100}$/.test(gifId)
        : gifId !== null
    )
      fieldErrors.gifId =
        "GIFs need a valid Giphy ID; text must not include one.";
    if (Object.keys(fieldErrors).length) return invalid(req, res, fieldErrors);

    const me = req.user.id;
    const result = await withTransaction(pool, async (db) => {
      // 1. Lock the conversation row (and prove membership). Parallel sends wait here.
      const locked = await db.query(SQL.lockForSend, [id, me]);
      if (!locked.rowCount) return null;
      // 2. A retry of an already stored message returns the original, unchanged.
      const existing = await db.query(SQL.findSent, [id, me, clientMessageId]);
      if (existing.rowCount) return { row: existing.rows[0], created: false };
      // 3. New message: take the next seq and advance the counter in the same transaction.
      const { next_seq: seq } = locked.rows[0];
      const inserted = await db.query(SQL.insertMessage, [
        id,
        me,
        clientMessageId,
        seq,
        body,
        kind,
        gifId,
      ]);
      await db.query(SQL.bumpSeq, [id]);
      return { row: inserted.rows[0], created: true };
    });
    if (!result) return notFound(req, res);
    const message = toMessage(result.row);
    if (result.created) {
      try {
        await onMessage(message);
      } catch {
        // The write already committed; a push failure cannot invalidate its acknowledgement.
        console.error({ requestId: req.id, code: "message_push_failed" });
      }
    }
    res.status(result.created ? 201 : 200).json({ message });
  });

  // Move my read cursor forward: 200 { lastReadSeq }. The answer may be higher than the
  // requested seq when another tab already read further (the cursor never moves back).
  router.put("/conversations/:id/read", async (req, res) => {
    const { id } = req.params;
    if (!UUID.test(id)) return notFound(req, res);
    const seq = req.body?.seq;
    // JSON numbers only ("3" is rejected); MAX_SEQ keeps the value inside PostgreSQL's
    // integer range, otherwise the query itself would fail with a 500.
    const seqError = { seq: "Use a whole number from 0 to the newest message." };
    if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0 || seq > MAX_SEQ)
      return invalid(req, res, seqError);
    const me = req.user.id;
    // Membership first, so outsiders get 404 rather than learning anything from a 400.
    if (!(await pool.query(SQL.isMember, [id, me])).rowCount) return notFound(req, res);
    const { rows } = await pool.query(SQL.markRead, [id, me, seq]);
    // No row: the member exists, so the seq was beyond the newest stored message.
    if (!rows[0]) return invalid(req, res, seqError);
    try {
      // My other tabs clear their badge. The cursor is stored, so a push failure is only logged.
      await onRead(me, id, rows[0].last_read_seq);
    } catch {
      console.error({ requestId: req.id, code: "read_push_failed" });
    }
    res.json({ lastReadSeq: rows[0].last_read_seq });
  });

  return router;
}
