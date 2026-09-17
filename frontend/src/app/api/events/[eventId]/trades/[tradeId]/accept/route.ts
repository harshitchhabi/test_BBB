import { NextResponse } from "next/server";
import { acceptTrade } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// POST /events/:id/trades/:tradeId/accept — the counterparty's leader
// agreeing to the trade exactly as proposed. Required before a moderator
// can register it; see trade-service.ts's acceptTrade for why this step
// exists.
//
// acceptingTeamId is only needed (and only used) when accepting an OPEN
// OFFER (the trade has no fixed counterparty yet) - it says which team
// is claiming it. Ignored for a normal two-party trade, where the
// counterparty is already fixed and acceptTrade verifies the caller
// leads it regardless of what's sent here.
export async function POST(req: Request, { params }: { params: Promise<{ eventId: string; tradeId: string }> }) {
  try {
    const { eventId, tradeId } = await params;
    const participant = await requireParticipant();
    const { acceptingTeamId } = await req.json().catch(() => ({}));
    const trade = await acceptTrade({
      eventId,
      tradeId,
      acceptingParticipantId: participant.id,
      acceptingTeamId: typeof acceptingTeamId === "string" ? acceptingTeamId : undefined,
    });
    return NextResponse.json(trade);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
