import { NextResponse } from "next/server";
import { getSessionParticipant } from "./session";
import { GameError, HTTP_STATUS_BY_CODE } from "game-engine";

// Every command route (Section 8.1) starts the same way: who is signed
// in, and do they exist as a participant. Centralized here so each route
// doesn't re-implement "no session -> 401" slightly differently. Task 1:
// this used to go through next-auth's getServerSession + look up a
// participant by email; it now reads our own signed session cookie
// directly and returns the participant it already names — none of the
// ~50 route files that call this needed to change.
export async function requireParticipant() {
  const participant = await getSessionParticipant();
  if (!participant) {
    throw new GameError("unauthorized", "Sign in required.");
  }
  return participant;
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
