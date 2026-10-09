import express from "express";
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
import { withTransaction } from "./db.js";
import { normalizeEmail, validateAuth, validateProfile } from "../src/model.js";

// Hash of a random password: lets login spend Argon2 time for unknown emails too.
const DUMMY_HASH = await hashPassword(randomBytes(16).toString("hex"));

const renameKeys = (errors, names) =>
  Object.fromEntries(Object.entries(errors).map(([k, v]) => [names[k] ?? k, v]));
const USER_COLUMNS = "id, email, handle, display_name, avatar_id";

// Contract (pinned by server/auth.test.js):
//   JSON errors: { error: { code, message, fieldErrors? }, requestId }
//   public user: { id, handle, displayName, avatarId }; /me and auth responses add `email`
//
// GET    /health/live           200 { status: "ok" }
// GET    /health/ready          200 { status: "ok" } | 503 when the DB is unreachable
// GET    /api/v1/auth/csrf      200 { csrfToken } and sets CSRF_COOKIE
// POST   /api/v1/auth/register  { email, password, displayName, handle } -> 201 { user } + session cookie
//                               400 validation_failed | 409 already_exists (fieldErrors.email or .handle)
// POST   /api/v1/auth/login     { email, password } -> 200 { user }; deletes any session cookie sent
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
export function createApp({
  pool,
  appOrigin,
  authRateLimit = { windowMs: 15 * 60_000, max: 10 },
  sendRateLimit = { windowMs: 10_000, max: 30 },
  secureCookies = false,
}) {
  const app = express();
  app.use((req, res, next) => {
    req.id = randomUUID();
    res.set("X-Request-ID", req.id);
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

  app.get("/health/live", (req, res) => res.json({ status: "ok" }));
  app.get("/health/ready", async (req, res) => {
    try {
      await pool.query("SELECT 1");
    } catch {
      return sendError(req, res, 503, "not_ready", "Database is unavailable.");
    }
    res.json({ status: "ok" });
  });

  const v1 = express.Router();
  v1.use(csrfProtection(appOrigin));

  v1.get("/auth/csrf", (req, res) => {
    const csrfToken = randomBytes(32).toString("base64url");
    res.cookie(CSRF_COOKIE, csrfToken, cookieOptions);
    res.json({ csrfToken });
  });

  v1.post("/auth/register", limit, async (req, res) => {
    const { email, password, displayName, handle } = req.body ?? {};
    const errors = validateAuth({ email, password, name: displayName, handle }, true);
    if (Object.keys(errors).length)
      return invalid(req, res, renameKeys(errors, { name: "displayName" }));
    const passwordHash = await hashPassword(password);
    try {
      const user = await withTransaction(pool, async (db) => {
        const { rows } = await db.query(
          `INSERT INTO chatty.users (email, handle, display_name, password_hash)
           VALUES ($1, $2, $3, $4) RETURNING ${USER_COLUMNS}`,
          [normalizeEmail(email), handle, displayName.trim(), passwordHash],
        );
        await startSession(req, res, db, rows[0].id);
        return rows[0];
      });
      res.status(201).json({ user: toUser(user, true) });
    } catch (err) {
      if (err.code !== "23505") throw err;
      const field = err.constraint?.includes("email") ? "email" : "handle";
      sendError(req, res, 409, "already_exists", "That email or handle is already in use.", {
        [field]:
          field === "email"
            ? "An account with this email already exists."
            : "That handle is taken.",
      });
    }
  });

  v1.post("/auth/login", limit, async (req, res) => {
    const { email, password } = req.body ?? {};
    const errors = validateAuth({ email, password }, false);
    if (Object.keys(errors).length) return invalid(req, res, errors);
    const { rows } = await pool.query(
      `SELECT ${USER_COLUMNS}, password_hash FROM chatty.users WHERE email = $1`,
      [normalizeEmail(email)],
    );
    // Unknown emails still pay for one Argon2 run, so timing does not reveal accounts.
    const valid = await verifyPassword(password, rows[0]?.password_hash ?? DUMMY_HASH);
    if (!rows[0] || !valid)
      return sendError(req, res, 401, "invalid_credentials", "Email or password is incorrect.");
    await startSession(req, res, pool, rows[0].id);
    res.json({ user: toUser(rows[0], true) });
  });

  v1.post("/auth/logout", async (req, res) => {
    await deleteSession(pool, parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, cookieOptions);
    res.status(204).end();
  });

  v1.get("/me", auth, (req, res) => res.json({ user: toUser(req.user, true) }));

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
    res.json({ user: toUser(rows[0], true) });
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

  v1.use(conversationRoutes({ pool, auth, sendLimit: rateLimit(sendRateLimit) }));

  app.use("/api/v1", v1);
  app.use("/api", (req, res) => {
    sendError(req, res, 404, "not_found", "API route not found.");
  });
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
