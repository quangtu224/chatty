import express from "express";
import { randomUUID } from "node:crypto";
import { sendError } from "./auth.js";

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
  // TODO(M1): implement the authentication/profile/health routes above.
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
