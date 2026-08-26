import { NextResponse } from "next/server";
import { auth } from "../../auth";
import { GameError, HTTP_STATUS_BY_CODE, resolveParticipantByEmail } from "game-engine";

// Every command route (Section 8.1) starts the same way: who is signed in,
// and do they exist as a participant. Centralized here so each route
// doesn't re-implement "no session -> 401" slightly differently.
export async function requireParticipant() {
  const session = await auth();
  if (!session?.user?.email) {
    throw new GameError("unauthorized", "Sign in required.");
  }
  return resolveParticipantByEmail(session.user.email);
}

// Maps a GameError (or any other thrown error) to the HTTP response a
// command endpoint returns. GameError.code drives both the status and a
// stable machine-readable reason the UI can act on (Section 7.3: "always
// show the reason"); anything else is logged and returned as a generic
// 500 rather than leaking internals.
export function apiErrorResponse(err: unknown) {
  if (err instanceof GameError) {
    return NextResponse.json({ error: err.code, message: err.message }, { status: HTTP_STATUS_BY_CODE[err.code] });
  }
  console.error("Unhandled error in API route:", err);
  return NextResponse.json({ error: "internal_error", message: "Something went wrong." }, { status: 500 });
}
