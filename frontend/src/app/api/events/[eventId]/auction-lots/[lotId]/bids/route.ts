import { NextResponse } from "next/server";
import { placeBid } from "game-engine";
import { requireParticipant, apiErrorResponse, isValidAmount } from "@/lib/api";

// POST /events/:id/auction-lots/:id/bids — Section 8.1, actor: team leader.
// Authorization (must be the leader of the team being bid for) happens
// inside placeBid itself, against the DB, not against anything the client
// asserts — the request only supplies which team it claims to bid for, and
// the engine verifies that against team_members.
export async function POST(req: Request, { params }: { params: Promise<{ eventId: string; lotId: string }> }) {
  try {
    const { eventId, lotId } = await params;
    const participant = await requireParticipant();
    const { teamId, amount } = await req.json();

    if (typeof teamId !== "string" || !isValidAmount(amount)) {
      return NextResponse.json(
        { error: "invalid_input", message: "teamId and a positive whole-number amount are required." },
        { status: 400 },
      );
    }

    const result = await placeBid({
      eventId,
      auctionLotId: lotId,
      teamId,
      actingParticipantId: participant.id,
      amount,
    });

    if (!result.accepted) {
      const code = result.bid.rejectionReason?.startsWith("Insufficient") ? "insufficient_tokens" : "bid_too_low";
      return NextResponse.json({ error: code, message: result.bid.rejectionReason, bid: result.bid }, { status: 400 });
    }

    return NextResponse.json(result.bid);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
