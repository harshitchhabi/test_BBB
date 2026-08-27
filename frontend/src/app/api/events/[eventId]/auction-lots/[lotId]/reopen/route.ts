import { NextResponse } from "next/server";
import { reopenLot } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

export async function POST(req: Request, { params }: { params: Promise<{ eventId: string; lotId: string }> }) {
  try {
    const { eventId, lotId } = await params;
    const participant = await requireParticipant();
    const { reason } = await req.json();
    if (typeof reason !== "string" || reason.trim().length === 0) {
      return NextResponse.json({ error: "invalid_input", message: "A reason is required." }, { status: 400 });
    }
    const lot = await reopenLot({ eventId, auctionLotId: lotId, actorParticipantId: participant.id, reason });
    return NextResponse.json(lot);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
