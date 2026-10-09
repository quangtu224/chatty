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

// TODO(M2a): DB row -> message shape above.
export function toMessage(row) {
  throw new Error("TODO: toMessage");
}

// TODO(M2a): conversations visible to userId (all of them, or just conversationId).
// One query: my membership -> conversation -> the other member -> users, plus
// LEFT JOIN LATERAL (latest message by seq) for lastMessage; ORDER BY
// coalesce(last message created_at, conversation created_at) DESC.
async function listConversations(db, userId, conversationId = null) {
  throw new Error("TODO: listConversations");
}

export function conversationRoutes({ pool, auth, sendLimit }) {
  const router = express.Router();
  router.use("/conversations", auth);

  // TODO(M2a): validate userId; in one transaction: target exists (else 404),
  // INSERT conversation with direct_key = sorted "idA:idB" ON CONFLICT (direct_key)
  // DO NOTHING RETURNING id; when a row came back insert both members (created).
  // Otherwise SELECT the existing id. Respond with listConversations(..., id)[0].
  router.post("/conversations/direct", async (req, res) => {
    throw new Error("TODO: POST /conversations/direct");
  });

  router.get("/conversations", async (req, res) => {
    throw new Error("TODO: GET /conversations");
  });

  // TODO(M2a): membership check, then SELECT ... WHERE seq < beforeSeq ORDER BY seq DESC
  // LIMIT limit + 1; the extra row means hasMore; reverse for ascending output.
  router.get("/conversations/:id/messages", async (req, res) => {
    throw new Error("TODO: GET /conversations/:id/messages");
  });

  // TODO(M2a): validate (UUID clientMessageId, messageBodyError(body)), then one transaction:
  // 1. SELECT next_seq FROM conversations JOIN my membership ... FOR UPDATE OF c  (none -> 404)
  // 2. existing row for (conversation, sender, clientMessageId) -> 200 with it
  // 3. INSERT with seq = next_seq, UPDATE next_seq = next_seq + 1 -> 201
  // The row lock serializes sends per conversation, so seqs stay contiguous.
  router.post("/conversations/:id/messages", sendLimit, async (req, res) => {
    throw new Error("TODO: POST /conversations/:id/messages");
  });

  return router;
}
