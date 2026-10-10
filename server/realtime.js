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
