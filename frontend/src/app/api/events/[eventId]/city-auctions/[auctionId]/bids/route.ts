import { NextResponse } from "next/server";
import { placeCityBid } from "game-engine";
import { requireParticipant, apiErrorResponse, isValidAmount } from "@/lib/api";

export async function POST(req: Request, { params }: { params: Promise<{ eventId: string; auctionId: string }> }) {
  try {
    const { eventId, auctionId } = await params;
    const participant = await requireParticipant();
    const { teamId, amount } = await req.json();
    if (typeof teamId !== "string" || !isValidAmount(amount)) {
      return NextResponse.json({ error: "invalid_input", message: "teamId and a positive whole-number amount are required." }, { status: 400 });
    }

    const result = await placeCityBid({ eventId, cityAuctionId: auctionId, teamId, actingParticipantId: participant.id, amount });
    if (!result.accepted) {
      return NextResponse.json({ error: "bid_too_low", message: result.reason, bid: result.bid }, { status: 400 });
    }
    return NextResponse.json(result.bid);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
