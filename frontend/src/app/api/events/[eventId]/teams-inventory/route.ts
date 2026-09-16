import { NextResponse } from "next/server";
import { getAllTeamsInventory, getParticipantContext } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// GET /events/:id/teams-inventory — every team's MATERIAL holdings (not
// their token balance, not their score — those stay private, see the
// overview/inventory routes), visible to any participant of this event
// so a team can actually see what a prospective counterparty has before
// proposing a trade, instead of guessing blind. Requires being part of
// this event (staff or a team member) — same gate as ws-ticket — but not
// staff specifically, since every team needs this to trade.
export async function GET(_req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const ctx = await getParticipantContext(eventId, participant.id);
    if (!ctx.staffRole && !ctx.team) {
      return NextResponse.json({ error: "forbidden", message: "You are not part of this event." }, { status: 403 });
    }

    const teams = await getAllTeamsInventory(eventId);
    return NextResponse.json({ teams });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
