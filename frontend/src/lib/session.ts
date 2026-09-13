import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";
import { verifySessionParticipant } from "game-engine";

// Task 1: replaces next-auth entirely. A session is a small signed
// token in an httpOnly cookie — {participantId, sessionId, exp}, HMAC-
// signed with SESSION_SECRET so it can't be forged or edited client-
// side, but NOT a JWT library or anything else "heavy" — this is a
// ~20-30-login internal event, not a public system, and Node's built-in
// crypto is enough. sessionId is re-checked against the participant's
// row on every request (see verifySessionParticipant in auth-service.ts)
// so a password reset or a newer login instantly invalidates any older
// cookie for the same login, even though the cookie itself hasn't
// "expired" yet.
const COOKIE_NAME = "bbb_session";
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days — matches "a shared team login stays signed in for the event"

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is not set.");
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

interface SessionPayload {
  participantId: string;
  sessionId: string;
  exp: number; // unix seconds
}

function encode(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function decode(token: string): SessionPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(body);
  // Lengths can differ if the cookie was tampered with; timingSafeEqual
  // requires equal-length buffers, so mismatched length is just invalid.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.participantId !== "string" || typeof payload.sessionId !== "string" || typeof payload.exp !== "number") {
      return null;
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function setSessionCookie(participantId: string, sessionId: string) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  const token = encode({ participantId, sessionId, exp });
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

// The full check: a syntactically valid, unexpired, correctly-signed
// cookie AND a sessionId that still matches the participant's row (see
// the module comment above for why both matter).
export async function getSessionParticipant() {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  const payload = decode(raw);
  if (!payload) return null;
  return verifySessionParticipant(payload.participantId, payload.sessionId);
}
