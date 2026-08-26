import { NextResponse } from "next/server";
import { closeCityAuction } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

export async function POST(_req: Request, { params }: { params: Promise<{ eventId: string; auctionId: string }> }) {
  try {
    const { eventId, auctionId } = await params;
    const participant = await requireParticipant();
    const result = await closeCityAuction({ eventId, cityAuctionId: auctionId, actorParticipantId: participant.id });
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
