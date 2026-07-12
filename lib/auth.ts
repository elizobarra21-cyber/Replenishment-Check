import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

// Authentication helpers: password hashing (scrypt, no native deps) and a
// stateless signed session cookie (HMAC-SHA256). Everything here is server-only.

export const SESSION_COOKIE = "sr_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function sessionSecret(): string {
  // In production SESSION_SECRET must be set; fall back to a fixed dev secret so
  // local runs work without extra setup (dev cookies just aren't portable).
  return process.env.SESSION_SECRET || "dev-insecure-session-secret";
}

// --- Passwords --------------------------------------------------------------

/** Hash a password as `salt:hash` (both hex) using scrypt. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

/** Verify a password against a stored `salt:hash` value (constant-time). */
export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) {
    return false;
  }
  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const derived = scryptSync(password, salt, expected.length);
    return expected.length === derived.length && timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

// --- Session tokens ---------------------------------------------------------

export type SessionPayload = { uid: string; uname: string; iat: number };

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function sign(data: string): string {
  return createHmac("sha256", sessionSecret()).update(data).digest("hex");
}

/** Create a signed session token for a user. */
export function signSession(uid: string, uname: string): string {
  const payload: SessionPayload = { uid, uname, iat: Date.now() };
  const body = base64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

/** Verify a session token and return its payload, or null if invalid/expired. */
export function verifySession(token: string | undefined | null): SessionPayload | null {
  if (!token) {
    return null;
  }
  const dot = token.lastIndexOf(".");
  if (dot <= 0) {
    return null;
  }
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body);
  if (
    sig.length !== expected.length ||
    !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
    ) as SessionPayload;
    if (!payload?.uid || Date.now() - payload.iat > SESSION_TTL_MS) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/** Read and verify the session from a request's Cookie header. */
export function getSessionUser(request: Request): SessionPayload | null {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (!match) {
    return null;
  }
  return verifySession(decodeURIComponent(match.slice(SESSION_COOKIE.length + 1)));
}

/** Serialized Set-Cookie value for a session token (httpOnly, SameSite=Lax). */
export function sessionCookie(token: string): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${maxAge}`;
}

/** Serialized Set-Cookie value that clears the session. */
export function clearSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=0`;
}

// --- Validation -------------------------------------------------------------

export function normalizeUsername(input: unknown): string {
  return String(input ?? "").trim().toLowerCase();
}

export function validateCredentials(
  username: string,
  password: string,
): string | null {
  if (username.length < 3 || username.length > 32) {
    return "Username must be 3-32 characters.";
  }
  if (!/^[a-z0-9._-]+$/.test(username)) {
    return "Username may use letters, digits, and . _ - only.";
  }
  if (password.length < 6 || password.length > 128) {
    return "Password must be at least 6 characters.";
  }
  return null;
}
