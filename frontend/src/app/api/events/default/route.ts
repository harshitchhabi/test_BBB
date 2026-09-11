import { NextResponse } from "next/server";
import { db, desc } from "db";
import { events } from "db/schema";

// GET /api/events/default — this deployment is one EC2 instance per live
// event (Section: deployment model), so there is never a real choice of
// "which event" for a participant to make. The home page uses this to
// send everyone straight into the one event that exists here instead of
// asking anyone to type/paste an event id. Returns only the id/name/status
// needed to route and greet — no team or token data, so it's safe to call
// before sign-in.
export async function GET() {
  const [event] = await db.select({ id: events.id, name: events.name, status: events.status }).from(events).orderBy(desc(events.createdAt)).limit(1);
  if (!event) return NextResponse.json({ event: null });
  return NextResponse.json({ event });
}
