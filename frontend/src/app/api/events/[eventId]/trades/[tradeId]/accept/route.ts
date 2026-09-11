import { NextResponse } from "next/server";
import { acceptTrade } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// POST /events/:id/trades/:tradeId/accept — the counterparty's leader
// agreeing to the trade exactly as proposed. Required before a moderator
// can register it; see trade-service.ts's acceptTrade for why this step
// exists.
export async function POST(_req: Request, { params }: { params: Promise<{ eventId: string; tradeId: string }> }) {
  try {
    const { eventId, tradeId } = await params;
    const participant = await requireParticipant();
    const trade = await acceptTrade({ eventId, tradeId, acceptingParticipantId: participant.id });
    return NextResponse.json(trade);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
