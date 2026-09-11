import { NextResponse } from "next/server";
import { declineTrade } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// POST /events/:id/trades/:tradeId/decline — either side of a still-just-
// proposed trade turning it down (the proposer withdrawing their own
// offer, or the counterparty saying no). Once a trade is accepted, only
// a moderator's reject/cancel can undo it — see trade-service.ts.
export async function POST(_req: Request, { params }: { params: Promise<{ eventId: string; tradeId: string }> }) {
  try {
    const { eventId, tradeId } = await params;
    const participant = await requireParticipant();
    const trade = await declineTrade({ eventId, tradeId, decliningParticipantId: participant.id });
    return NextResponse.json(trade);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
