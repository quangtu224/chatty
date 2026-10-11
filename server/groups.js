import express from "express";
import { sendError, toUser } from "./auth.js";
import { withTransaction } from "./db.js";
import { UUID, listConversations } from "./conversations.js";
import { groupNameError } from "../src/model.js";

// Contract (pinned by server/groups.test.js). Every route needs a session.
//   group conversation: { id, type: "group", name, ownerId, memberCount, lastMessage }
//   details (GET /conversations/:id): the list shape plus members: [public user], sorted
//   by display name then handle. Works for direct chats too.
//
// POST   /conversations/groups { name, memberIds }
//        201 { conversation }. The caller becomes owner and a member. memberIds: an array
//        of other users' UUIDs; duplicates and the caller's own id are ignored; 1–19 others.
//        400 validation_failed (fieldErrors.name | fieldErrors.memberIds, incl. unknown users)
// GET    /conversations/:id                    200 { conversation } with members | 404
// POST   /conversations/:id/members { userIds } owner only; existing members are ignored
//        200 { conversation } with members | 400 (bad/unknown ids) | 403 forbidden (not owner)
//        409 not_a_group (direct chat) | 409 group_full (would exceed 20 members)
// DELETE /conversations/:id/members/:userId     owner only
//        204 | 400 (yourself: use leave) | 403 forbidden | 404 (not a member) | 409 not_a_group
// POST   /conversations/:id/transfer-owner { userId } owner only
//        200 { conversation } with members | 400 (not a member / yourself) | 403 | 409 not_a_group
// POST   /conversations/:id/leave
//        204 | 409 transfer_required (owner while others remain) | 409 not_a_group
//        The last member leaving closes the group (closed_at); history is kept.
//
// Outsiders and malformed ids always get 404 not_found (never reveal that a group exists).
// Members who are not the owner get 403 forbidden: they already know the group exists.
export const MAX_GROUP_MEMBERS = 20;

// ---------------------------------------------------------------------------
// SQL for group routes. Values are passed separately ($1, $2, ...), never concatenated.
// uuid[] parameters: pass a JavaScript array of UUID strings; pg sends it as an array.
// ---------------------------------------------------------------------------
export const GROUP_SQL = {
  // How many of the given ids ($1 uuid[]) are real users. Compare with the array length
  // (after removing duplicates) to detect unknown ids in one query.
  countUsers: `SELECT count(*)::int AS n FROM chatty.users WHERE id = ANY($1::uuid[])`,

  // New open group owned by $2 with name $1 (already trimmed).
  insertGroup: `
    INSERT INTO chatty.conversations (type, name, owner_id)
    VALUES ('group', $1, $2)
    RETURNING id`,

  // Adds every user in $2 (uuid[]) to conversation $1. unnest turns the array into rows.
  // ON CONFLICT DO NOTHING skips people who are already members (the primary key).
  addMembers: `
    INSERT INTO chatty.conversation_members (conversation_id, user_id)
    SELECT $1, unnest($2::uuid[])
    ON CONFLICT DO NOTHING`,

  // Step 1 of every membership change ($1 conversation, $2 caller). Returns the group's
  // state only if the caller is a member (no row -> 404). FOR UPDATE OF c takes the same
  // row lock as sending a message, so "remove member" and "that member sends" can never
  // interleave: whichever commits first wins, and a removed member's later send is a 404.
  // member_count is read under the lock, so the 20-member check cannot race either.
  lockGroup: `
    SELECT c.type, c.owner_id,
           (SELECT count(*)::int FROM chatty.conversation_members cm
            WHERE cm.conversation_id = c.id) AS member_count
    FROM chatty.conversations c
    JOIN chatty.conversation_members me
      ON me.conversation_id = c.id AND me.user_id = $2
    WHERE c.id = $1
    FOR UPDATE OF c`,

  // How many of $2 (uuid[]) are NOT yet members of $1: the real growth of an "add".
  countNewcomers: `
    SELECT count(*)::int AS n
    FROM unnest($2::uuid[]) AS candidate(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM chatty.conversation_members cm
      WHERE cm.conversation_id = $1 AND cm.user_id = candidate.id
    )`,

  // Removes one membership ($1 conversation, $2 user). rowCount 0 means "not a member".
  // History stays; the removed user simply fails every later membership check.
  removeMember: `
    DELETE FROM chatty.conversation_members
    WHERE conversation_id = $1 AND user_id = $2`,

  // Makes $2 the owner of $1, but only if $2 is a member (rowCount 0 otherwise).
  transferOwner: `
    UPDATE chatty.conversations SET owner_id = $2
    WHERE id = $1 AND EXISTS (
      SELECT 1 FROM chatty.conversation_members cm
      WHERE cm.conversation_id = $1 AND cm.user_id = $2
    )`,

  // Called after the last member left: no owner, closed timestamp (the shape check
  // requires both together). The rows and messages remain for history.
  closeGroup: `
    UPDATE chatty.conversations SET owner_id = NULL, closed_at = now()
    WHERE id = $1`,

  // Public profiles of current members ($1 conversation) for the details view.
  members: `
    SELECT u.id, u.handle, u.display_name, u.avatar_id
    FROM chatty.conversation_members cm
    JOIN chatty.users u ON u.id = cm.user_id
    WHERE cm.conversation_id = $1
    ORDER BY u.display_name, u.handle`,
};

// TODO(M3a): (await listConversations(db, userId, id))[0] plus
// members: (await db.query(GROUP_SQL.members, [id])).rows.map((row) => toUser(row)).
// Return null when the caller is not a member (listConversations returns []).
export async function conversationDetails(db, userId, id) {
  throw new Error("TODO: conversationDetails");
}

export function groupRoutes({ pool, auth }) {
  const router = express.Router();
  router.use("/conversations", auth);

  // TODO(M3a): validate groupNameError(name) and memberIds (array of UUIDs; lowercase,
  // drop duplicates and your own id; 1–19 left). GROUP_SQL.countUsers must equal that
  // count, else 400 fieldErrors.memberIds. In one withTransaction: insertGroup (trimmed
  // name, you as owner) -> addMembers with [you, ...others] -> 201 with the list shape.
  router.post("/conversations/groups", async (req, res) => {
    throw new Error("TODO: POST /conversations/groups");
  });

  // TODO(M3a): non-UUID -> 404; conversationDetails(pool, me, id) ?? 404.
  router.get("/conversations/:id", async (req, res) => {
    throw new Error("TODO: GET /conversations/:id");
  });

  // TODO(M3a) for the four routes below, inside one withTransaction each:
  //   lockGroup (no row -> 404) -> type !== "group" -> 409 not_a_group
  //   -> owner_id !== me (except leave) -> 403 forbidden -> the change -> respond.
  // Tip: return a small result object from the transaction ({ status, code } or data) and
  // send the response after it commits, so an error never leaves half a change behind.

  // TODO(M3a): validate userIds like memberIds (countUsers); countNewcomers +
  // member_count > MAX_GROUP_MEMBERS -> 409 group_full; addMembers; 200 with details.
  router.post("/conversations/:id/members", async (req, res) => {
    throw new Error("TODO: POST /conversations/:id/members");
  });

  // TODO(M3a): :userId must be a UUID (else 404) and not yourself (400);
  // removeMember rowCount 0 -> 404; 204.
  router.delete("/conversations/:id/members/:userId", async (req, res) => {
    throw new Error("TODO: DELETE /conversations/:id/members/:userId");
  });

  // TODO(M3a): userId must be a UUID and not yourself (400); transferOwner rowCount 0
  // -> 400 (not a member); 200 with details.
  router.post("/conversations/:id/transfer-owner", async (req, res) => {
    throw new Error("TODO: POST /conversations/:id/transfer-owner");
  });

  // TODO(M3a): any member may leave. Owner with member_count > 1 -> 409 transfer_required.
  // removeMember(me); if you were the last member (member_count === 1) -> closeGroup. 204.
  router.post("/conversations/:id/leave", async (req, res) => {
    throw new Error("TODO: POST /conversations/:id/leave");
  });

  return router;
}
