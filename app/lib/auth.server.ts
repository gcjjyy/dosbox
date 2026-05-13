import { createCookieSessionStorage } from "react-router";
import crypto from "node:crypto";
import { Unauthorized, RateLimited } from "./errors";

interface SessionData { isAdmin: boolean; }
interface SessionFlash {}

function getStorage() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set to a 32+ character value");
  }
  return createCookieSessionStorage<SessionData, SessionFlash>({
    cookie: {
      name: "__dosbox_session",
      httpOnly: true,
      secure: process.env.NODE_ENV !== "development",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
      secrets: [secret],
    },
  });
}

let _storage: ReturnType<typeof getStorage> | null = null;
function storage() {
  return _storage ??= getStorage();
}

export async function getSession(request: Request) {
  return storage().getSession(request.headers.get("cookie"));
}

export async function commitSession(session: Awaited<ReturnType<typeof getSession>>) {
  return storage().commitSession(session);
}

export async function destroySession(session: Awaited<ReturnType<typeof getSession>>) {
  return storage().destroySession(session);
}

export async function requireAdmin(request: Request) {
  const session = await getSession(request);
  if (!session.get("isAdmin")) throw new Unauthorized();
  return session;
}

export function verifyPassword(input: string): boolean {
  const expected = process.env.DOSBOX_ADMIN_PASSWORD ?? "";
  if (input.length === 0 || expected.length === 0) return false;
  const a = Buffer.alloc(64, " ");
  const b = Buffer.alloc(64, " ");
  Buffer.from(input.slice(0, 64)).copy(a);
  Buffer.from(expected.slice(0, 64)).copy(b);
  if (!crypto.timingSafeEqual(a, b)) return false;
  return input === expected; // defeat padding-length bypass
}

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;
const rateMap = new Map<string, { count: number; resetAt: number }>();

export function checkLoginRate(ip: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || entry.resetAt < now) {
    rateMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_MAX) return false;
  entry.count += 1;
  return true;
}

export function __resetRateLimitForTests() {
  rateMap.clear();
}
