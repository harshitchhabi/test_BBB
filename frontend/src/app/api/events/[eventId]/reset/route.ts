import { NextResponse } from "next/server";
import { resetEventForNewRound } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// POST /events/:id/reset — wipes all runtime state (teams, tokens, bids,
// rounds/lots, trades, buildings, cities/auctions, scores) for a fresh
// round on the SAME event id/link, keeping materials/recipes/cities/
// settings configuration untouched. Staff-only, requires a reason,
// enforced inside resetEventForNewRound itself.
export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const { reason } = await req.json();
    if (typeof reason !== "string" || reason.trim().length === 0) {
      return NextResponse.json({ error: "invalid_input", message: "A reason is required to reset an event." }, { status: 400 });
    }
    const event = await resetEventForNewRound({ eventId, actorParticipantId: participant.id, reason });
    return NextResponse.json(event);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
