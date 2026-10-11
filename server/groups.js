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

// Details view: the list shape plus the public profiles of current members.
// Returns null when the caller is not a member (listConversations returns []).
export async function conversationDetails(db, userId, id) {
  const conversations = await listConversations(db, userId, id);
  if (conversations.length === 0) return null;
  const { rows } = await db.query(GROUP_SQL.members, [id]);
  return { ...conversations[0], members: rows.map((row) => toUser(row)) };
}

// Cleans a list of user ids from a request body: must be an array of UUID strings.
// Lowercases them (pg returns lowercase, so comparisons with req.user.id work), drops
// duplicates and the caller's own id. Returns the ids, or null when the input is malformed.
function otherUserIds(value, me) {
  if (!Array.isArray(value) || value.length > 100) return null;
  if (!value.every((id) => typeof id === "string" && UUID.test(id))) return null;
  return [...new Set(value.map((id) => id.toLowerCase()))].filter((id) => id !== me);
}

// Realtime (M3c): every successful change calls onGroupChanged(conversationId,
// revokedUserIds) after the transaction commits; revokedUserIds lists users who just lost
// access (removed member, the leaver). A push failure never fails the response.
export function groupRoutes({ pool, auth, onGroupChanged = async () => {} }) {
  const router = express.Router();

  // Called only after COMMIT. The change is durable, so a push failure is only logged.
  async function pushChange(req, conversationId, revokedUserIds = []) {
    try {
      await onGroupChanged(conversationId, revokedUserIds);
    } catch {
      console.error({ requestId: req.id, code: "group_push_failed" });
    }
  }
  router.use("/conversations", auth);

  const notFound = (req, res) =>
    sendError(req, res, 404, "not_found", "Conversation not found.");
  const invalid = (req, res, fieldErrors) =>
    sendError(req, res, 400, "validation_failed", "Check the highlighted fields.", fieldErrors);

  // Runs `change` inside one transaction after the shared checks of every membership
  // change: lock the group row (proves membership, else 404), it must be a group (409),
  // and unless `anyMember` the caller must own it (403). `change` returns either
  // { error: [status, code, message, fieldErrors?] } or { value }; throwing rolls back.
  // The response is sent only after COMMIT, so a failure never leaves half a change.
  async function changeGroup(req, res, { anyMember = false }, change) {
    const { id } = req.params;
    if (!UUID.test(id)) return notFound(req, res);
    const me = req.user.id;
    const result = await withTransaction(pool, async (db) => {
      const { rows } = await db.query(GROUP_SQL.lockGroup, [id, me]);
      if (!rows[0]) return { error: [404, "not_found", "Conversation not found."] };
      const group = rows[0];
      if (group.type !== "group")
        return { error: [409, "not_a_group", "Direct chats don’t have members to manage."] };
      if (!anyMember && group.owner_id !== me)
        return { error: [403, "forbidden", "Only the group owner can do that."] };
      // An error result must not keep earlier writes, so it throws to roll back.
      const outcome = await change(db, { id, me, group });
      if (outcome.error) throw Object.assign(new Error("rollback"), { outcome });
      return outcome;
    }).catch((err) => {
      if (err.outcome) return err.outcome;
      throw err; // a real failure: the app's error handler answers 500
    });
    if (result.error) return sendError(req, res, ...result.error);
    return result.value;
  }

  // Create a group: the caller becomes owner and member; 1–19 other members.
  router.post("/conversations/groups", async (req, res) => {
    const me = req.user.id;
    const { name, memberIds } = req.body ?? {};
    const fieldErrors = {};
    const nameError = groupNameError(name);
    if (nameError) fieldErrors.name = nameError;
    const others = otherUserIds(memberIds, me);
    if (!others || others.length < 1 || others.length > MAX_GROUP_MEMBERS - 1)
      fieldErrors.memberIds = `Choose 1–${MAX_GROUP_MEMBERS - 1} teammates.`;
    if (Object.keys(fieldErrors).length) return invalid(req, res, fieldErrors);

    // Every id must belong to a real user; one count query checks them all.
    const { rows } = await pool.query(GROUP_SQL.countUsers, [others]);
    if (rows[0].n !== others.length)
      return invalid(req, res, { memberIds: "Some teammates were not found." });

    const conversation = await withTransaction(pool, async (db) => {
      const { id } = (await db.query(GROUP_SQL.insertGroup, [name.trim(), me])).rows[0];
      await db.query(GROUP_SQL.addMembers, [id, [me, ...others]]);
      return (await listConversations(db, me, id))[0];
    });
    await pushChange(req, conversation.id); // every new member sees the group appear
    res.status(201).json({ conversation });
  });

  // Details for any conversation the caller belongs to (groups and direct chats).
  router.get("/conversations/:id", async (req, res) => {
    const { id } = req.params;
    if (!UUID.test(id)) return notFound(req, res);
    const details = await conversationDetails(pool, req.user.id, id);
    if (!details) return notFound(req, res);
    res.json({ conversation: details });
  });

  // Owner adds members. Existing members are ignored; the group stays at most 20.
  router.post("/conversations/:id/members", async (req, res) => {
    const userIds = otherUserIds(req.body?.userIds, req.user.id);
    const conversation = await changeGroup(req, res, {}, async (db, { id, me, group }) => {
      // Body checks run after the 404/403 checks: outsiders learn nothing from them.
      if (!userIds || userIds.length < 1)
        return {
          error: [400, "validation_failed", "Check the highlighted fields.",
            { userIds: "Choose at least one teammate." }],
        };
      const known = (await db.query(GROUP_SQL.countUsers, [userIds])).rows[0].n;
      if (known !== userIds.length)
        return {
          error: [400, "validation_failed", "Check the highlighted fields.",
            { userIds: "Some teammates were not found." }],
        };
      // member_count was read under the row lock, so this check cannot race another add.
      const newcomers = (await db.query(GROUP_SQL.countNewcomers, [id, userIds])).rows[0].n;
      if (group.member_count + newcomers > MAX_GROUP_MEMBERS)
        return { error: [409, "group_full", `Groups can have at most ${MAX_GROUP_MEMBERS} members.`] };
      await db.query(GROUP_SQL.addMembers, [id, userIds]);
      return { value: await conversationDetails(db, me, id) };
    });
    if (!conversation) return; // changeGroup already answered with the error
    await pushChange(req, req.params.id); // newcomers and existing members refresh
    res.json({ conversation });
  });

  // Owner removes one member. The owner leaves through /leave instead.
  router.delete("/conversations/:id/members/:userId", async (req, res) => {
    const { userId } = req.params;
    if (!UUID.test(userId))
      return sendError(req, res, 404, "not_found", "That person isn’t in this group.");
    const target = userId.toLowerCase();
    const done = await changeGroup(req, res, {}, async (db, { id, me }) => {
      if (target === me)
        return {
          error: [400, "validation_failed", "Check the highlighted fields.",
            { userId: "Use “Leave group” to leave." }],
        };
      const removed = await db.query(GROUP_SQL.removeMember, [id, target]);
      if (!removed.rowCount)
        return { error: [404, "not_found", "That person isn’t in this group."] };
      return { value: true };
    });
    if (!done) return;
    await pushChange(req, req.params.id, [target]); // the removed user loses the chat
    res.status(204).end();
  });

  // Owner hands ownership to another current member.
  router.post("/conversations/:id/transfer-owner", async (req, res) => {
    const raw = req.body?.userId;
    const target = typeof raw === "string" && UUID.test(raw) ? raw.toLowerCase() : null;
    const conversation = await changeGroup(req, res, {}, async (db, { id, me }) => {
      // Checked after the owner check: a non-owner gets 403 whatever they send.
      if (!target || target === me)
        return {
          error: [400, "validation_failed", "Check the highlighted fields.",
            { userId: "Choose another member." }],
        };
      const moved = await db.query(GROUP_SQL.transferOwner, [id, target]);
      if (!moved.rowCount)
        return {
          error: [400, "validation_failed", "Check the highlighted fields.",
            { userId: "Only current members can become owner." }],
        };
      return { value: await conversationDetails(db, me, id) };
    });
    if (!conversation) return;
    await pushChange(req, req.params.id); // everyone sees the new owner
    res.json({ conversation });
  });

  // Any member leaves. The owner must transfer first unless they are the last member;
  // the last member leaving closes the group (history is kept).
  router.post("/conversations/:id/leave", async (req, res) => {
    const done = await changeGroup(req, res, { anyMember: true }, async (db, { id, me, group }) => {
      if (group.owner_id === me && group.member_count > 1)
        return { error: [409, "transfer_required", "Make someone else the owner before leaving."] };
      await db.query(GROUP_SQL.removeMember, [id, me]);
      if (group.member_count === 1) await db.query(GROUP_SQL.closeGroup, [id]);
      return { value: true };
    });
    if (!done) return;
    await pushChange(req, req.params.id, [req.user.id]); // my other tabs drop the chat
    res.status(204).end();
  });

  return router;
}
