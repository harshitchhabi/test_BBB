import { NextResponse } from "next/server";
import { voidBid } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

export async function POST(req: Request, { params }: { params: Promise<{ eventId: string; bidId: string }> }) {
  try {
    const { eventId, bidId } = await params;
    const participant = await requireParticipant();
    const { reason } = await req.json().catch(() => ({}));
    const bid = await voidBid({ eventId, bidId, actorParticipantId: participant.id, reason: typeof reason === "string" ? reason : undefined });
    return NextResponse.json(bid);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
