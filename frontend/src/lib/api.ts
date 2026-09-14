import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getSessionParticipant } from "./session";
import { GameError, HTTP_STATUS_BY_CODE } from "game-engine";

// Second CSRF layer, on top of the session cookie's SameSite=Lax
// (which already blocks the practical cross-site POST/fetch attack on
// its own): if the request carries an Origin header at all, its host
// must match the request's own Host header. A same-origin fetch() from
// this app always has them match; a cross-site page trying to POST
// here would send its own Origin, which won't. A request with no
// Origin header at all (common for a normal same-tab GET/navigation)
// is allowed through — SameSite=Lax is what's actually protecting that
// case. Behind a reverse proxy, this only works correctly if the proxy
// forwards the original client Host header unchanged (nginx's default
// `proxy_set_header Host $host;` does exactly that).
async function assertSameOrigin() {
  const hdrs = await headers();
  const origin = hdrs.get("origin");
  if (!origin) return;
  const host = hdrs.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new GameError("forbidden", "Cross-origin request rejected.");
  }
  if (!host || originHost !== host) {
    throw new GameError("forbidden", "Cross-origin request rejected.");
  }
}

// Every command route (Section 8.1) starts the same way: who is signed
// in, and do they exist as a participant. Centralized here so each route
// doesn't re-implement "no session -> 401" slightly differently. Task 1:
// this used to go through next-auth's getServerSession + look up a
// participant by email; it now reads our own signed session cookie
// directly and returns the participant it already names — none of the
// ~50 route files that call this needed to change.
export async function requireParticipant() {
  await assertSameOrigin();
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
// Bid amounts, purchase quantities, etc: the DB column is a Postgres
// `integer` (32-bit) either way, so an out-of-range value would already
// fail at insert time rather than overflow into a wraparound value — but
// that failure is an ugly 500, not a friendly rejected-with-a-reason
// response, and there's no reason to accept `10.5` and let the recipe
// math or bid-comparison logic quietly work with a fractional value
// before the DB ever gets a say. One bound, shared by every route that
// takes a token amount or a material quantity from the request body.
const MAX_REASONABLE_AMOUNT = 1_000_000;

export function isValidAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_REASONABLE_AMOUNT;
}

// Every route that takes an id from the URL (e.g. /bids/:bidId/void)
// passes it straight into a `WHERE id = $1` against a uuid column with
// no format check first — found live via a full smoke test: a malformed
// id (not shaped like a UUID at all) makes Postgres itself reject the
// query with SQLSTATE 22P02 ("invalid input syntax"), which isn't a
// GameError, so it used to fall through to a bare 500. That's not a
// security hole (nothing leaks, nothing crashes the process, and it was
// already logged server-side), but a bad/stale/copy-pasted id in a URL
// is exactly the kind of ordinary mistake that shouldn't come back as a
// scary "Something went wrong" instead of a plain "not found" — so this
// one specific Postgres error code, and only this one, is mapped to a
// clean 404 here, centrally, rather than adding a UUID-format check to
// every one of the ~54 route files that takes an id.
function isInvalidTextRepresentation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "22P02";
}

export function apiErrorResponse(err: unknown) {
  if (err instanceof GameError) {
    return NextResponse.json({ error: err.code, message: err.message }, { status: HTTP_STATUS_BY_CODE[err.code] });
  }
  if (isInvalidTextRepresentation(err)) {
    return NextResponse.json({ error: "not_found", message: "Not found." }, { status: 404 });
  }
  console.error("Unhandled error in API route:", err);
  return NextResponse.json({ error: "internal_error", message: "Something went wrong." }, { status: 500 });
}
