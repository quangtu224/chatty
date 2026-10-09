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
export function validateAuth({ email, password, name }, signup) {
  const errors = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.email = "Enter a valid email address.";
  if (password.length < 8) errors.password = "Use at least 8 characters.";
  if (signup && !name.trim()) errors.name = "Enter your display name.";
  return errors;
}
