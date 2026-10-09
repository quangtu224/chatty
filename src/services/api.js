// Browser client for /api/v1. Same origin (Vite proxies /api in development).

export class ApiError extends Error {
  constructor(status, { code, message, fieldErrors } = {}) {
    super(message || "Something went wrong.");
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors || {};
  }
}

let csrfToken;
let csrfRequest;

async function getCsrfToken() {
  if (csrfToken) return csrfToken;
  // Concurrent mutations share the request so they use the same CSRF cookie.
  csrfRequest ??= api("/auth/csrf")
    .then((data) => {
      if (typeof data?.csrfToken !== "string" || !data.csrfToken.trim())
        throw new ApiError(200, { code: "invalid_response", message: "Invalid CSRF response." });
      csrfToken = data.csrfToken;
      return csrfToken;
    })
    .finally(() => { csrfRequest = undefined; });
  return csrfRequest;
}

export async function api(path, { method = "GET", body } = {}) {
  method = method.toUpperCase();
  const mutation = method !== "GET" && method !== "HEAD";
  const payload = body === undefined ? undefined : JSON.stringify(body);
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = mutation ? await getCsrfToken() : undefined;
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (mutation) headers["X-CSRF-Token"] = token;
    const response = await fetch(`/api/v1${path}`, {
      method, headers, body: payload, credentials: "same-origin",
    });
    if (response.ok && (response.status === 204 || method === "HEAD")) return null;
    let data;
    try { data = await response.json(); } catch {
      if (response.ok)
        throw new ApiError(response.status, { code: "invalid_response", message: "Expected a JSON response." });
    }
    if (!response.ok) {
      const error = new ApiError(response.status, data?.error ?? {
        code: "http_error", message: `Request failed (${response.status}).`,
      });
      if (mutation && attempt === 0 && error.status === 403 && error.code === "csrf_failed") {
        if (csrfToken === token) csrfToken = undefined;
        continue;
      }
      throw error;
    }
    return data;
  }
}

export const getMe = () => api("/me");
export const register = (fields) =>
  api("/auth/register", { method: "POST", body: fields });
export const login = (fields) =>
  api("/auth/login", { method: "POST", body: fields });
export const logout = () => api("/auth/logout", { method: "POST" });
export const updateMe = (fields) =>
  api("/me", { method: "PATCH", body: fields });
export const searchUsers = (query) =>
  api(`/users?query=${encodeURIComponent(query)}`);
