import { NextResponse } from "next/server";
import { getParticipantContext } from "game-engine";
import { mintWsTicket } from "common";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// GET /events/:id/ws-ticket — mints a short-lived, signed ticket the
// browser presents when it opens its direct WebSocket connection to
// backend/'s relay (a different origin/port, so the httpOnly session
// cookie never reaches it — see packages/common/src/ws-ticket.ts for why
// this exists). Confirms the signed-in participant actually belongs to
// this event (staff or a team member) before minting anything; a
// participant of Event A gets no ticket for Event B.
export async function GET(_req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const ctx = await getParticipantContext(eventId, participant.id);
    if (!ctx.staffRole && !ctx.team) {
      return NextResponse.json({ error: "forbidden", message: "You are not part of this event." }, { status: 403 });
    }

    const secret = process.env.INTERNAL_BROADCAST_SECRET;
    if (!secret) {
      return NextResponse.json({ error: "internal_error", message: "Broadcast relay is not configured." }, { status: 500 });
    }

    const ticket = mintWsTicket(secret, eventId, participant.id);
    return NextResponse.json({ ticket });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
