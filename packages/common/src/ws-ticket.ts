import { createHmac, timingSafeEqual } from "crypto";

// Security hardening (post-Task-1 audit): the browser opens its
// WebSocket connection directly to backend/'s relay, a different
// origin/port than the frontend, so the httpOnly session cookie never
// reaches it — before this, anyone who knew (or guessed) an event's
// UUID could open a raw socket and join that event's room with zero
// authentication, silently receiving every live bid/trade/stage
// broadcast. A ws-ticket is a short-lived, HMAC-signed
// {eventId, participantId, exp} the frontend mints server-side (only
// after requireParticipant() + confirming that participant actually
// belongs to the event) and the client must present in its "join"
// message; the relay verifies it with the same secret before adding
// the socket to the room. Signed with INTERNAL_BROADCAST_SECRET — the
// one secret both processes already share for POST /internal/broadcast
// — so no new secret/env var is needed.
const TICKET_TTL_SECONDS = 60;

interface WsTicketPayload {
  eventId: string;
  participantId: string;
  exp: number;
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function mintWsTicket(secret: string, eventId: string, participantId: string): string {
  const exp = Math.floor(Date.now() / 1000) + TICKET_TTL_SECONDS;
  const payload: WsTicketPayload = { eventId, participantId, exp };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(secret, body)}`;
}

// Only confirms the ticket is authentic, unexpired, and minted for this
// exact eventId — the relay has no DB access and doesn't need one; the
// frontend already did the real "is this participant actually part of
// this event" check before minting it.
export function verifyWsTicket(secret: string, ticket: string, expectedEventId: string): boolean {
  const dot = ticket.lastIndexOf(".");
  if (dot < 0) return false;
  const body = ticket.slice(0, dot);
  const signature = ticket.slice(dot + 1);
  const expected = sign(secret, body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as WsTicketPayload;
    if (typeof payload.eventId !== "string" || typeof payload.participantId !== "string" || typeof payload.exp !== "number") {
      return false;
    }
    if (payload.eventId !== expectedEventId) return false;
    if (payload.exp < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch {
    return false;
  }
}
