import { createHash } from "node:crypto";
import { Server } from "socket.io";
import { parseCookies, SESSION_COOKIE } from "./auth.js";

// Match the existing session table: raw cookie tokens never become room names.
const tokenHash = (token) => createHash("sha256").update(token).digest();
const sessionRoom = (hash) => `session:${hash.toString("hex")}`;

// Connection authentication needs the expiry to schedule an idle-session disconnect.
const SESSION_SQL = `
  SELECT user_id, expires_at FROM chatty.sessions
  WHERE token_hash = $1 AND expires_at > now()`;

// Check current membership and expiry for every push, not just at socket connection.
// Multiple sessions/tabs receive one event each; outsiders never enter these rooms.
const RECIPIENTS_SQL = `
  SELECT s.token_hash
  FROM chatty.conversation_members cm
  JOIN chatty.sessions s ON s.user_id = cm.user_id
  WHERE cm.conversation_id = $1 AND s.expires_at > now()`;

// Live sessions of specific users ($1 uuid[]), whether or not they are still members:
// a removed member's tabs, or my own other tabs for read sync (uses sessions_user_id_idx).
const USER_SESSIONS_SQL = `
  SELECT token_hash FROM chatty.sessions
  WHERE user_id = ANY($1::uuid[]) AND expires_at > now()`;

export function createRealtime(server, { pool, appOrigin }) {
  const io = new Server(server, {
    // Browser WebSocket handshakes carry Origin; require it to prevent cross-site sockets.
    transports: ["websocket"],
    maxHttpBufferSize: 16 * 1024,
    allowRequest: (request, callback) => callback(null, request.headers.origin === appOrigin),
  });
  io.use(async (socket, next) => {
    try {
      const token = parseCookies(socket.handshake.headers.cookie)[SESSION_COOKIE];
      if (!token) return next(new Error("unauthenticated"));
      const hash = tokenHash(token);
      const { rows } = await pool.query(SESSION_SQL, [hash]);
      if (!rows[0]) return next(new Error("unauthenticated"));
      socket.data.sessionRoom = sessionRoom(hash);
      socket.data.expiresAt = rows[0].expires_at;
      next();
    } catch {
      // Do not expose database errors or credentials to the connecting browser.
      next(new Error("realtime_unavailable"));
    }
  });
  io.on("connection", (socket) => {
    // Only the server chooses a room; no client event can join arbitrary users/chats.
    socket.join(socket.data.sessionRoom);
    const remaining = new Date(socket.data.expiresAt).getTime() - Date.now();
    const expiry = setTimeout(() => socket.disconnect(true), Math.max(0, remaining));
    expiry.unref();
    socket.on("disconnect", () => clearTimeout(expiry));
  });

  return {
    async publishMessage(message) {
      const { rows } = await pool.query(RECIPIENTS_SQL, [message.conversationId]);
      const rooms = rows.map((row) => sessionRoom(row.token_hash));
      if (rooms.length) io.to(rooms).emit("message:created", message);
    },
    // M3c event contract (payloads carry ids only; clients refetch GET /conversations/:id,
    // which already returns the per-user shape: name, members, unreadCount, ...):
    //   conversation:updated        { conversationId }               current members
    //   conversation:access-revoked { conversationId }               users who lost access
    //   read:updated                { conversationId, lastReadSeq }  the reader's own sessions
    // Rooms are per session (see sessionRoom); turn token_hash rows into room names like
    // publishMessage does and skip the emit when there are no rooms.

    // TODO(owner): emit "conversation:updated" to every live session of the current
    // members of conversationId (RECIPIENTS_SQL). A closed group has no members: no-op.
    async publishConversation(conversationId) {},

    // TODO(owner): emit "conversation:access-revoked" to every live session of userIds
    // (USER_SESSIONS_SQL). They are no longer members, so RECIPIENTS_SQL cannot find them.
    // Ignore an empty userIds array.
    async revokeAccess(conversationId, userIds) {},

    // TODO(owner): emit "read:updated" { conversationId, lastReadSeq } to every live session
    // of userId (USER_SESSIONS_SQL with [userId]) so the other tabs clear their badge.
    async publishRead(userId, conversationId, lastReadSeq) {},

    revokeSession(token) {
      // A logout/rotation closes this session's tabs, preserving independent logins.
      if (typeof token === "string" && token)
        io.in(sessionRoom(tokenHash(token))).disconnectSockets(true);
    },
    close() {
      // Socket.IO closes its sockets and the attached HTTP server; disconnect clears timers.
      return new Promise((resolve, reject) => io.close((err) => err ? reject(err) : resolve()));
    },
  };
}
