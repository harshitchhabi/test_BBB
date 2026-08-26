import type { WsEventType } from "common";

// The frontend (Next.js, serverless on Vercel) cannot hold the persistent
// WebSocket connections teams/moderators watch live — that requires a
// long-running process, which is what backend/ is for. So "broadcast a
// committed event" means: POST it to the backend's internal relay
// endpoint, which then fans it out over WebSocket to every client in that
// event's room. This is the ONLY thing backend/ does now — no DB access,
// no game rules, purely a relay — which is what fixes Section 3.1 issue
// #1 ("Unify the bidding service"): all rule logic lives here in
// game-engine, backend/ never re-implements any of it.
const BACKEND_INTERNAL_URL = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8080";
const INTERNAL_BROADCAST_SECRET = process.env.INTERNAL_BROADCAST_SECRET;

export async function postBroadcast(broadcast: { eventId: string; type: WsEventType; data: unknown }) {
  if (!INTERNAL_BROADCAST_SECRET) {
    throw new Error(
      "INTERNAL_BROADCAST_SECRET is not set — refusing to call the broadcast relay unauthenticated.",
    );
  }

  const res = await fetch(`${BACKEND_INTERNAL_URL}/internal/broadcast`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-secret": INTERNAL_BROADCAST_SECRET,
    },
    body: JSON.stringify(broadcast),
  });

  if (!res.ok) {
    throw new Error(`Broadcast relay responded ${res.status}: ${await res.text().catch(() => "")}`);
  }
}
