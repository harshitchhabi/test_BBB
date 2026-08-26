import { NextResponse } from "next/server";
import { rejectTrade } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

export async function POST(req: Request, { params }: { params: Promise<{ eventId: string; tradeId: string }> }) {
  try {
    const { eventId, tradeId } = await params;
    const participant = await requireParticipant();
    const { reason } = await req.json();
    if (typeof reason !== "string" || reason.trim().length === 0) {
      return NextResponse.json({ error: "invalid_input", message: "A reason is required to reject a trade." }, { status: 400 });
    }
    const trade = await rejectTrade({ eventId, tradeId, moderatorParticipantId: participant.id, reason });
    return NextResponse.json(trade);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
