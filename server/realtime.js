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

// M3d presence audience: everyone who shares at least one conversation with $1 (direct
// chats and groups). DISTINCT because two people can share several conversations.
// Uses the conversation_members primary key and its user_id index.
const CONTACTS_SQL = `
  SELECT DISTINCT other.user_id
  FROM chatty.conversation_members mine
  JOIN chatty.conversation_members other
    ON other.conversation_id = mine.conversation_id AND other.user_id <> mine.user_id
  WHERE mine.user_id = $1`;

// M3d typing audience ($1 conversation, $2 typist): the other members' live sessions, and
// only if the typist is still a member (EXISTS). One query authorizes and addresses the
// event, so a removed member's typing reaches nobody.
const TYPING_RECIPIENTS_SQL = `
  SELECT s.token_hash
  FROM chatty.conversation_members cm
  JOIN chatty.sessions s ON s.user_id = cm.user_id
  WHERE cm.conversation_id = $1 AND cm.user_id <> $2 AND s.expires_at > now()
    AND EXISTS (SELECT 1 FROM chatty.conversation_members me
                WHERE me.conversation_id = $1 AND me.user_id = $2)`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Repeating the same typing state faster than this is dropped (clients refresh every 3 s).
const TYPING_THROTTLE_MS = 1000;

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
      socket.data.userId = rows[0].user_id;
      socket.data.expiresAt = rows[0].expires_at;
      next();
    } catch {
      // Do not expose database errors or credentials to the connecting browser.
      next(new Error("realtime_unavailable"));
    }
  });
  // Presence: open sockets per user id. Online means at least one socket (any tab/session).
  // ponytail: in-memory, one server process only; move to Redis/an adapter when scaling out.
  const sockets = new Map();
  // Tells my contacts that I came online or went offline. Best effort: presence is
  // ephemeral, so a database hiccup only delays it until the next change or reconnect.
  async function announce(userId, online) {
    try {
      const { rows } = await pool.query(CONTACTS_SQL, [userId]);
      if (rows.length)
        await emitTo(USER_SESSIONS_SQL, [rows.map((row) => row.user_id)], "presence:updated",
          { userIds: [userId], online });
    } catch {
      console.error({ code: "presence_push_failed" });
    }
  }

  io.on("connection", async (socket) => {
    // Only the server chooses a room; no client event can join arbitrary users/chats.
    socket.join(socket.data.sessionRoom);
    const { userId } = socket.data;
    const remaining = new Date(socket.data.expiresAt).getTime() - Date.now();
    const expiry = setTimeout(() => socket.disconnect(true), Math.max(0, remaining));
    expiry.unref();
    // Last typing state sent per conversation by this socket: { typing, at }.
    const lastTyping = new Map();
    let typingQueue = Promise.resolve();

    socket.on("disconnect", () => {
      clearTimeout(expiry);
      const left = (sockets.get(userId) ?? 1) - 1;
      if (left > 0) return sockets.set(userId, left);
      sockets.delete(userId);
      announce(userId, false);
    });

    // typing:set { conversationId, typing }. Malformed, too frequent or unauthorized
    // events are dropped silently: typing is a hint, not a request that needs an answer.
    socket.on("typing:set", (payload) => {
      const { conversationId, typing } = payload ?? {};
      if (typeof conversationId !== "string" || !UUID.test(conversationId) || typeof typing !== "boolean")
        return;
      const now = Date.now(), last = lastTyping.get(conversationId);
      if (last?.typing === typing && now - last.at < TYPING_THROTTLE_MS) return;
      lastTyping.set(conversationId, { typing, at: now });
      // One at a time per socket: "typing" then "stopped" must never arrive swapped.
      typingQueue = typingQueue.then(() =>
        emitTo(TYPING_RECIPIENTS_SQL, [conversationId, userId], "typing:updated",
          { conversationId, userId, typing }),
      ).catch(() => console.error({ code: "typing_push_failed" }));
    });

    const count = (sockets.get(userId) ?? 0) + 1;
    sockets.set(userId, count);
    try {
      // Snapshot for this socket only: which of my contacts are online right now.
      const { rows } = await pool.query(CONTACTS_SQL, [userId]);
      const online = rows.map((row) => row.user_id).filter((id) => sockets.has(id));
      if (socket.connected) socket.emit("presence:updated", { userIds: online, online: true });
    } catch {
      console.error({ code: "presence_snapshot_failed" });
    }
    // First socket of this user: everyone who shares a chat sees them come online.
    if (count === 1) announce(userId, true);
  });

  // Emits once to every session room the query returns (rows with token_hash).
  async function emitTo(sql, params, event, payload) {
    const { rows } = await pool.query(sql, params);
    const rooms = rows.map((row) => sessionRoom(row.token_hash));
    if (rooms.length) io.to(rooms).emit(event, payload);
  }

  return {
    async publishMessage(message) {
      await emitTo(RECIPIENTS_SQL, [message.conversationId], "message:created", message);
    },
    // M3c event contract (payloads carry ids only; clients refetch GET /conversations/:id,
    // which already returns the per-user shape: name, members, unreadCount, ...):
    //   conversation:updated        { conversationId }               current members
    //   conversation:access-revoked { conversationId }               users who lost access
    //   read:updated                { conversationId, lastReadSeq }  the reader's own sessions
    // M3d (sent from the connection handler above):
    //   presence:updated { userIds, online }  contacts (people sharing a chat); on connect
    //                                         the socket gets a snapshot of online contacts
    //   typing:updated   { conversationId, userId, typing }  the other members

    // Current members' sessions. A closed group has no members, so nothing is sent.
    async publishConversation(conversationId) {
      await emitTo(RECIPIENTS_SQL, [conversationId], "conversation:updated", { conversationId });
    },
    // Users who just lost access are no longer members: RECIPIENTS_SQL cannot find them.
    async revokeAccess(conversationId, userIds) {
      if (!userIds?.length) return;
      await emitTo(USER_SESSIONS_SQL, [userIds], "conversation:access-revoked", { conversationId });
    },
    // My own sessions only (other tabs clear their badge); peers learn nothing about it.
    async publishRead(userId, conversationId, lastReadSeq) {
      await emitTo(USER_SESSIONS_SQL, [[userId]], "read:updated", { conversationId, lastReadSeq });
    },

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
