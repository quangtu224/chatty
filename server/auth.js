import crypto from "node:crypto";
import { promisify } from "node:util";

export const SESSION_COOKIE = "chatty_session";
export const CSRF_COOKIE = "chatty_csrf";
export const SESSION_DAYS = 7;

const argon2 = promisify(crypto.argon2);
// OWASP minimum for Argon2id: 19 MiB memory, 2 passes, 1 lane.
const ARGON2 = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 };
const HASH_FORMAT =
  /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;
const b64 = (buffer) => buffer.toString("base64").replace(/=+$/, "");

// PHC string format: $argon2id$v=19$m=..,t=..,p=..$<salt>$<hash>
export async function hashPassword(password) {
  const nonce = crypto.randomBytes(16);
  const hash = await argon2("argon2id", { message: password, nonce, ...ARGON2 });
  const { memory, passes, parallelism } = ARGON2;
  return `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${b64(nonce)}$${b64(hash)}`;
}

export async function verifyPassword(password, stored) {
  const match = HASH_FORMAT.exec(stored ?? "");
  if (!match || typeof password !== "string") return false;
  const [, memory, passes, parallelism, nonce, hash] = match;
  const expected = Buffer.from(hash, "base64");
  const actual = await argon2("argon2id", {
    message: password,
    nonce: Buffer.from(nonce, "base64"),
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
    tagLength: expected.length,
  });
  return crypto.timingSafeEqual(actual, expected);
}

export function toUser(row, withEmail = false) {
  const user = {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    avatarId: row.avatar_id,
  };
  return withEmail ? { ...user, email: row.email } : user;
}

const hashToken = (token) => crypto.createHash("sha256").update(token).digest();

export async function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  // Expiry uses the database clock, the same one findSessionUser checks against.
  await db.query(
    `INSERT INTO chatty.sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3))`,
    [hashToken(token), userId, SESSION_DAYS],
  );
  return token;
}

export async function findSessionUser(db, token) {
  if (typeof token !== "string" || !token) return null;
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.handle, u.display_name, u.avatar_id
     FROM chatty.sessions s JOIN chatty.users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

export async function deleteSession(db, token) {
  if (typeof token !== "string" || !token) return;
  await db.query("DELETE FROM chatty.sessions WHERE token_hash = $1", [
    hashToken(token),
  ]);
}

export function parseCookies(header = "") {
  const cookies = Object.create(null);
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) cookies[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return cookies;
}

// Contract error shape: { error: { code, message, fieldErrors? }, requestId }.
export function sendError(req, res, status, code, message, fieldErrors) {
  req.id ??= crypto.randomUUID();
  const error = fieldErrors ? { code, message, fieldErrors } : { code, message };
  res.status(status).json({ error, requestId: req.id });
}

export function requireUser(pool) {
  return async (req, res, next) => {
    try {
      req.user = await findSessionUser(
        pool,
        parseCookies(req.headers.cookie)[SESSION_COOKIE],
      );
    } catch (err) {
      return next(err); // A database failure is a 500, not a sign-out.
    }
    if (!req.user)
      return sendError(req, res, 401, "unauthenticated", "Sign in to continue.");
    next();
  };
}

// Hashing both sides gives equal lengths for timingSafeEqual.
const sameSecret = (a, b) => crypto.timingSafeEqual(hashToken(a), hashToken(b));

export function csrfProtection(appOrigin) {
  return (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD") return next();
    const cookie = parseCookies(req.headers.cookie)[CSRF_COOKIE];
    const header = req.get("x-csrf-token");
    if (req.get("origin") !== appOrigin || !cookie || !header || !sameSecret(cookie, header))
      return sendError(req, res, 403, "csrf_failed", "Refresh the page and try again.");
    next();
  };
}

// ponytail: in-memory per limiter, one server instance only, entries live until
// restart; move to PostgreSQL if we scale out.
export function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    let entry = hits.get(req.ip);
    if (!entry || now - entry.start >= windowMs) {
      entry = { start: now, count: 0 };
      hits.set(req.ip, entry);
    }
    if (++entry.count > max)
      return sendError(req, res, 429, "rate_limited", "Too many attempts. Try again later.");
    next();
  };
}
