import { NextResponse } from "next/server";
import { login } from "game-engine";
import { setSessionCookie } from "@/lib/session";
import { checkLoginAllowed, recordLoginSuccess, clientAddress } from "@/lib/login-limiter";
import { apiErrorResponse } from "@/lib/api";

// POST /api/auth/login — Task 1's replacement for next-auth's Google
// sign-in. Username + password, rate-limited per account and per
// address (see login-limiter.ts), sets the signed session cookie on
// success.
export async function POST(req: Request) {
  try {
    const { username, password } = await req.json();
    if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
      return NextResponse.json({ error: "invalid_input", message: "Username and password are required." }, { status: 400 });
    }

    const address = clientAddress(req);
    const { ok, waitSeconds } = checkLoginAllowed(username, address);
    if (!ok) {
      return NextResponse.json(
        { error: "invalid_input", message: "Too many sign-in attempts. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(waitSeconds) } },
      );
    }

    const { participant, sessionId } = await login({ username, password });
    recordLoginSuccess(username);
    await setSessionCookie(participant.id, sessionId);

    return NextResponse.json({ user: { id: participant.id, name: participant.name, username: participant.username } });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
