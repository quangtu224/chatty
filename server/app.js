import express from "express";
import { extname, join, relative, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  SESSION_DAYS,
  createSession,
  csrfProtection,
  deleteSession,
  hashPassword,
  parseCookies,
  rateLimit,
  requireUser,
  sendError,
  toUser,
  verifyPassword,
} from "./auth.js";
import { conversationRoutes } from "./conversations.js";
import { groupRoutes } from "./groups.js";
import { gifSearch } from './gifs.js';
import { withTransaction } from "./db.js";
import { normalizeHandle, validateAuth, validateProfile } from "../src/model.js";

// Hash of a random password: lets login spend Argon2 time for unknown emails too.
const DUMMY_HASH = await hashPassword(randomBytes(16).toString("hex"));

// Browser hardening for the same-origin frontend (also harmless on JSON responses).
// CSP: scripts, sockets and API calls only from this origin; images also from GIPHY
// (GIF messages) and data: URIs (Bootstrap's inline SVG icons); styles/fonts from
// Google Fonts (styles.css @import). frame-ancestors 'none' blocks clickjacking.
// React's style={...} props use the CSSOM, which CSP style-src does not restrict.
const SECURITY_HEADERS = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "connect-src 'self'",
    "img-src 'self' data: https://media.giphy.com",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  // GIF images already use referrerPolicy="no-referrer"; no URL leaks to other sites.
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
};

const renameKeys = (errors, names) =>
  Object.fromEntries(Object.entries(errors).map(([k, v]) => [names[k] ?? k, v]));
const USER_COLUMNS = "id, handle, display_name, avatar_id";

// Contract (pinned by server/auth.test.js):
//   JSON errors: { error: { code, message, fieldErrors? }, requestId }
//   public user: { id, handle, displayName, avatarId }; email is never exposed
//
// GET    /health/live           200 { status: "ok" }
// GET    /health/ready          200 { status: "ok" } | 503 when the DB is unreachable
// GET    /api/v1/auth/csrf      200 { csrfToken } and sets CSRF_COOKIE
// POST   /api/v1/auth/register  { handle, password, displayName? } -> 201 { user } + session cookie
//                               400 validation_failed | 409 already_exists (fieldErrors.handle)
// POST   /api/v1/auth/login     { handle, password } -> 200 { user }; deletes any session cookie sent
//                               401 invalid_credentials (same message for unknown email and wrong password)
// POST   /api/v1/auth/logout    204, deletes the session, clears the cookie
// GET    /api/v1/me             200 { user } | 401 unauthenticated
// PATCH  /api/v1/me             { displayName?, avatarId? } -> 200 { user } | 400 validation_failed
// GET    /api/v1/users?query=&limit=&cursor=
//                               200 { users, nextCursor }: handle prefix or display-name substring,
//                               case-insensitive, LIKE wildcards escaped, excludes the caller,
//                               ordered by handle, limit default 10 / max 20, nextCursor null on last page
// unknown /api/* route           404 not_found
//
// Mutations go through csrfProtection; register/login through rateLimit(authRateLimit).
// Cookies: HttpOnly, SameSite=Lax, Path=/, Secure when secureCookies is true.
// Every response sends SECURITY_HEADERS; HSTS too when secureCookies (HTTPS) is on.
export function createApp({
  pool,
  appOrigin,
  authRateLimit = { windowMs: 15 * 60_000, max: 10 },
  sendRateLimit = { windowMs: 10_000, max: 30 },
  secureCookies = false,
  onMessage = async () => {},
  onSessionRevoked = () => {},
  // M3c pushes, called after COMMIT (see realtime.js for the event contract).
  // onGroupChanged(conversationId, revokedUserIds = []) and
  // onRead(userId, conversationId, lastReadSeq).
  onGroupChanged = async () => {},
  onRead = async () => {},
  giphyApiKey = process.env.GIPHY_API_KEY,
  gifFetch = fetch,
  gifRateLimit = {windowMs:60_000,max:20},
  frontendDir,
  releaseSha,
  logger = () => {},
  // Number of reverse proxies in front of the app (hosting platform load balancer).
  // 0 = none: X-Forwarded-For is client-controlled, so trusting it would let anyone
  // dodge the per-IP rate limits. With 1, req.ip is the address that proxy saw.
  trustProxy = 0,
}) {
  const app = express();
  app.set("trust proxy", trustProxy);
  app.use((req, res, next) => {
    res.set(SECURITY_HEADERS);
    // Browsers only honor HSTS over HTTPS; it pins this host to HTTPS for 180 days.
    if (secureCookies) res.set("Strict-Transport-Security", "max-age=15552000");
    next();
  });
  app.use((req, res, next) => {
    req.id = randomUUID();
    res.set("X-Request-ID", req.id);
    // One structured log line per finished request. The route *pattern* (e.g.
    // "/conversations/:id/messages", relative to its router) is logged instead of the
    // URL, so ids, query strings, headers, cookies and bodies never reach the logs.
    const started = performance.now();
    res.on("finish", () => logger({
      requestId: req.id,
      method: req.method,
      route: req.route?.path ?? "unmatched",
      status: res.statusCode,
      durationMs: Math.round(performance.now() - started),
    }));
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: secureCookies,
  };
  const auth = requireUser(pool);
  const limit = rateLimit(authRateLimit);

  const invalid = (req, res, fieldErrors) =>
    sendError(req, res, 400, "validation_failed", "Check the highlighted fields.", fieldErrors);
  // Replaces any session the browser already had (session fixation).
  async function startSession(req, res, db, userId) {
    await deleteSession(db, parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    const token = await createSession(db, userId);
    res.cookie(SESSION_COOKIE, token, {
      ...cookieOptions,
      maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    });
  }

  // Health reports the running Git SHA so releases and rollbacks can prove which
  // revision is live. no-store: a cached answer could show the wrong revision.
  const health = { status: "ok", ...(releaseSha && { sha: releaseSha }) };
  // live = the process answers; ready (below) = it can also reach the database.
  app.get("/health/live", (req, res) => res.set("Cache-Control", "no-store").json(health));
  app.get("/health/ready", async (req, res) => {
    try {
      await pool.query("SELECT 1");
    } catch (err) {
      // Log only the error code (ENOENT/EACCES = CA file, 28P01 = password, ENOTFOUND =
      // host, SELF_SIGNED_CERT_IN_CHAIN = wrong CA); messages never include the URL.
      logger({ requestId: req.id, code: "db_unavailable", reason: err.code ?? err.name });
      return sendError(req, res, 503, "not_ready", "Database is unavailable.");
    }
    res.set("Cache-Control", "no-store").json(health);
  });

  const v1 = express.Router();
  v1.use(csrfProtection(appOrigin));

  v1.get("/auth/csrf", (req, res) => {
    const csrfToken = randomBytes(32).toString("base64url");
    res.cookie(CSRF_COOKIE, csrfToken, cookieOptions);
    res.json({ csrfToken });
  });

  v1.post("/auth/register", limit, async (req, res) => {
    const { password, displayName, handle: rawHandle } = req.body ?? {};
    const handle = normalizeHandle(rawHandle);
    const errors = validateAuth({ password, name: displayName, handle }, true);
    if (Object.keys(errors).length)
      return invalid(req, res, renameKeys(errors, { name: "displayName" }));
    const passwordHash = await hashPassword(password);
    try {
      const user = await withTransaction(pool, async (db) => {
        const { rows } = await db.query(
          `INSERT INTO chatty.users (handle, display_name, password_hash)
           VALUES ($1, $2, $3) RETURNING ${USER_COLUMNS}`,
          [handle, displayName?.trim() ?? handle, passwordHash],
        );
        await startSession(req, res, db, rows[0].id);
        return rows[0];
      });
      // Revoke the previous socket session only after registration commits.
      onSessionRevoked(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
      res.status(201).json({ user: toUser(user) });
    } catch (err) {
      if (err.code !== "23505") throw err;
      sendError(req, res, 409, "already_exists", "That username is taken. Choose another one.", {
        handle: "That username is taken. Choose another one.",
      });
    }
  });

  v1.post("/auth/login", limit, async (req, res) => {
    const { handle, password } = req.body ?? {};
    const errors = validateAuth({ handle, password }, false);
    if (Object.keys(errors).length) return invalid(req, res, errors);
    const { rows } = await pool.query(
      `SELECT ${USER_COLUMNS}, password_hash FROM chatty.users WHERE handle = $1`,
      [normalizeHandle(handle)],
    );
    // Unknown usernames still pay for one Argon2 run, so timing does not reveal accounts.
    const valid = await verifyPassword(password, rows[0]?.password_hash ?? DUMMY_HASH);
    if (!rows[0] || !valid)
      return sendError(req, res, 401, "invalid_credentials", "Username or password is incorrect.");
    await startSession(req, res, pool, rows[0].id);
    onSessionRevoked(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    res.json({ user: toUser(rows[0]) });
  });

  v1.post("/auth/logout", async (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    await deleteSession(pool, token);
    onSessionRevoked(token);
    res.clearCookie(SESSION_COOKIE, cookieOptions);
    res.status(204).end();
  });

  v1.get("/me", auth, (req, res) => res.json({ user: toUser(req.user) }));

  v1.patch("/me", auth, async (req, res) => {
    const { displayName, avatarId } = req.body ?? {};
    const errors = validateProfile({ name: displayName, avatar: avatarId });
    if (Object.keys(errors).length)
      return invalid(req, res, renameKeys(errors, { name: "displayName", avatar: "avatarId" }));
    const { rows } = await pool.query(
      `UPDATE chatty.users
       SET display_name = COALESCE($2, display_name), avatar_id = COALESCE($3, avatar_id)
       WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [req.user.id, displayName?.trim() ?? null, avatarId ?? null],
    );
    res.json({ user: toUser(rows[0]) });
  });

  v1.get("/users", auth, async (req, res) => {
    const text = (value) => (typeof value === "string" ? value : "");
    const query = text(req.query.query).trim().replace(/[\\%_]/g, "\\$&");
    const cursor = text(req.query.cursor) || null;
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 10, 1), 20);
    const { rows } = await pool.query(
      `SELECT id, handle, display_name, avatar_id FROM chatty.users
       WHERE id <> $1
         AND (handle LIKE (lower($2) || '%') OR display_name ILIKE ('%' || $2 || '%'))
         AND ($3::text IS NULL OR handle > $3)
       ORDER BY handle
       LIMIT $4`,
      [req.user.id, query, cursor, limit + 1],
    );
    const page = rows.slice(0, limit);
    res.json({
      users: page.map((row) => toUser(row)),
      nextCursor: rows.length > limit ? page.at(-1).handle : null,
    });
  });

  v1.use(conversationRoutes({ pool, auth, sendLimit: rateLimit(sendRateLimit), onMessage, onRead }));
  v1.use(groupRoutes({ pool, auth, onGroupChanged }));
  // Separate quota: a provider outage cannot block ordinary text chat.
  v1.get('/gifs',auth,rateLimit(gifRateLimit),gifSearch({apiKey:giphyApiKey,fetchGifs:gifFetch}));

  app.use("/api/v1", v1);
  app.use("/api", (req, res) => {
    sendError(req, res, 404, "not_found", "API route not found.");
  });
  // Production/Docker: serve the built frontend (dist/) from the same origin as the API
  // and sockets, so cookies, CSRF and Origin checks need no cross-site setup. In
  // development Vite serves the frontend instead and frontendDir is undefined.
  if (frontendDir) {
    app.use(express.static(frontendDir, {
      index: false,
      dotfiles: "ignore",
      // Vite puts a content hash in every assets/ file name, so those can be cached
      // forever; index.html must be revalidated to pick up a new release.
      setHeaders: (res, path) => {
        const hashed = relative(frontendDir, path).startsWith(`assets${sep}`) && !path.endsWith(".html");
        res.set("Cache-Control", hashed ? "public, max-age=31536000, immutable" : "no-cache");
      },
    }));
    // Single-page app fallback: browser navigations get index.html. Anything that looks
    // like a file, a dotfile, health or socket.io falls through to the normal 404.
    app.get("/{*path}", (req, res, next) => {
      const notPage = !req.accepts("html") || extname(req.path) ||
        req.path.split("/").some((part) => part.startsWith(".")) ||
        req.path.startsWith("/health") || req.path.startsWith("/socket.io");
      if (notPage) return next();
      res.set("Cache-Control", "no-cache").sendFile(join(frontendDir, "index.html"));
    });
  }
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.type === "entity.parse.failed")
      return sendError(
        req,
        res,
        400,
        "validation_failed",
        "Provide valid JSON.",
      );
    if (err.type === "entity.too.large")
      return sendError(
        req,
        res,
        413,
        "payload_too_large",
        "Request body is too large.",
      );
    console.error({ requestId: req.id, code: "internal_server_error" });
    sendError(req, res, 500, "internal_server_error", "Internal Server Error");
  });

  return app;
}
