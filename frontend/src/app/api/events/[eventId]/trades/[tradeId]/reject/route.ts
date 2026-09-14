import { NextResponse } from "next/server";
import { rejectTrade } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

export async function POST(req: Request, { params }: { params: Promise<{ eventId: string; tradeId: string }> }) {
  try {
    const { eventId, tradeId } = await params;
    const participant = await requireParticipant();
    const { reason } = await req.json().catch(() => ({}));
    const trade = await rejectTrade({ eventId, tradeId, moderatorParticipantId: participant.id, reason: typeof reason === "string" ? reason : undefined });
    return NextResponse.json(trade);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
