export function updateStatus(conversations, chatId, messageId, status) {
  return conversations.map((c) =>
    c.id === chatId
      ? {
          ...c,
          messages: c.messages.map((m) =>
            m.id === messageId ? { ...m, status } : m,
          ),
        }
      : c,
  );
}
export function readStorage(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
export function saveStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Browsing without storage still supports this session. */
  }
}
export const AVATARS = ["cat", "fox", "raccoon", "owl", "frog", "bear"];
export function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}
export function validateAuth(fields, signup) {
  const { email, password, name, handle } = fields ?? {};
  const errors = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email)))
    errors.email = "Enter a valid email address.";
  if (typeof password !== "string" || !password.length)
    errors.password = "Enter your password.";
  else if (signup && (password.length < 10 || password.length > 128))
    errors.password = "Use 10–128 characters.";
  if (
    signup &&
    (typeof name !== "string" || !name.trim() || name.trim().length > 40)
  )
    errors.name = "Use 1–40 characters for your display name.";
  if (
    signup &&
    (typeof handle !== "string" || !/^[a-z0-9_]{3,24}$/.test(handle))
  )
    errors.handle = "Use 3–24 lowercase letters, numbers, or underscores.";
  return errors;
}
export function validateProfile(fields) {
  const { name, avatar } = fields ?? {};
  const errors = {};
  if (name === undefined && avatar === undefined)
    errors.name = "Provide a display name or avatar.";
  else if (
    name !== undefined &&
    (typeof name !== "string" || !name.trim() || name.trim().length > 40)
  )
    errors.name = "Use 1–40 characters for your display name.";
  if (avatar !== undefined && !AVATARS.includes(avatar))
    errors.avatar = "Choose an avatar.";
  return errors;
}
