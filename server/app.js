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
  verifyPassword,
} from "./auth.js";
import { normalizeEmail, validateAuth, validateProfile } from "../src/model.js";

// Hash of a random password: lets login spend Argon2 time for unknown emails too.
const DUMMY_HASH = await hashPassword(randomBytes(16).toString("hex"));

// TODO(M1): DB row -> { id, handle, displayName, avatarId } (+ email when withEmail).
function toUser(row, withEmail = false) {
  throw new Error("TODO: toUser");
}

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
  secureCookies = false,
}) {
  const app = express();
  app.use((req, res, next) => {
    req.id = randomUUID();
    res.set("X-Request-ID", req.id);
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  const cookieOptions = { httpOnly: true, sameSite: "lax", path: "/", secure: secureCookies };
  const auth = requireUser(pool);
  const limit = rateLimit(authRateLimit);

  // TODO(M1): `SELECT 1`; 503 `not_ready` when the query throws.
  app.get("/health/live", (req, res) => res.json({ status: "ok" }));
  app.get("/health/ready", async (req, res) => {
    throw new Error("TODO: GET /health/ready");
  });

  const v1 = express.Router();
  v1.use(csrfProtection(appOrigin));

  // TODO(M1): 32 random bytes (base64url) -> CSRF_COOKIE (cookieOptions) and { csrfToken }.
  v1.get("/auth/csrf", (req, res) => {
    throw new Error("TODO: GET /auth/csrf");
  });

  // TODO(M1): validateAuth({ email, password, name: displayName, handle }, true);
  // map name -> displayName in fieldErrors. INSERT normalized email + trimmed name +
  // hashPassword; unique violation (err.code "23505", err.constraint) -> 409.
  // createSession -> SESSION_COOKIE with maxAge SESSION_DAYS; 201 { user: toUser(row, true) }.
  v1.post("/auth/register", limit, async (req, res) => {
    throw new Error("TODO: POST /auth/register");
  });

  // TODO(M1): validateAuth(body, false). Unknown email still runs verifyPassword
  // against DUMMY_HASH so timing does not reveal accounts. deleteSession(old cookie),
  // then createSession like register; 200 { user }.
  v1.post("/auth/login", limit, async (req, res) => {
    throw new Error("TODO: POST /auth/login");
  });

  // TODO(M1): deleteSession(cookie), res.clearCookie(SESSION_COOKIE, cookieOptions), 204.
  v1.post("/auth/logout", async (req, res) => {
    throw new Error("TODO: POST /auth/logout");
  });

  v1.get("/me", auth, (req, res) => res.json({ user: toUser(req.user, true) }));

  // TODO(M1): validateProfile({ name: displayName, avatar: avatarId }); map field names
  // back; UPDATE only the provided columns (COALESCE works); 200 { user }.
  v1.patch("/me", auth, async (req, res) => {
    throw new Error("TODO: PATCH /me");
  });

  // TODO(M1): escape \ % _ in query; WHERE id <> caller AND (handle LIKE q% OR
  // display_name ILIKE %q%) AND handle > cursor ORDER BY handle LIMIT limit + 1;
  // the extra row tells you whether nextCursor = last handle or null.
  v1.get("/users", auth, async (req, res) => {
    throw new Error("TODO: GET /users");
  });

  app.use("/api/v1", v1);
  app.use("/api", (req, res) => {
    sendError(req, res, 404, "not_found", "API route not found.");
  });
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.type === "entity.parse.failed")
      return sendError(req, res, 400, "validation_failed", "Provide valid JSON.");
    if (err.type === "entity.too.large")
      return sendError(req, res, 413, "payload_too_large", "Request body is too large.");
    console.error({ requestId: req.id, code: "internal_server_error" });
    sendError(req, res, 500, "internal_server_error", "Internal Server Error");
  });

  return app;
}
