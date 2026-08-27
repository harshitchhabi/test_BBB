import { NextResponse } from "next/server";
import { voidBid } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

export async function POST(req: Request, { params }: { params: Promise<{ eventId: string; bidId: string }> }) {
  try {
    const { eventId, bidId } = await params;
    const participant = await requireParticipant();
    const { reason } = await req.json();
    if (typeof reason !== "string" || reason.trim().length === 0) {
      return NextResponse.json({ error: "invalid_input", message: "A reason is required." }, { status: 400 });
    }
    const bid = await voidBid({ eventId, bidId, actorParticipantId: participant.id, reason });
    return NextResponse.json(bid);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
