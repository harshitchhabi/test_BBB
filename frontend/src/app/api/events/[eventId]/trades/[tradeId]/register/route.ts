import { NextResponse } from "next/server";
import { registerTrade } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

export async function POST(_req: Request, { params }: { params: Promise<{ eventId: string; tradeId: string }> }) {
  try {
    const { eventId, tradeId } = await params;
    const participant = await requireParticipant();
    const trade = await registerTrade({ eventId, tradeId, moderatorParticipantId: participant.id });
    return NextResponse.json(trade);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
