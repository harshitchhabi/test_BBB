import { NextResponse } from "next/server";
import { startCityAuction } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

export async function POST(_req: Request, { params }: { params: Promise<{ eventId: string; cityId: string }> }) {
  try {
    const { eventId, cityId } = await params;
    const participant = await requireParticipant();
    const auction = await startCityAuction({ eventId, cityId, actorParticipantId: participant.id });
    return NextResponse.json(auction);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
