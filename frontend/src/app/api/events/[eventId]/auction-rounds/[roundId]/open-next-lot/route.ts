import { openNextLot, getParticipantContext, GameError } from "game-engine";
import { isStaff } from "common";
import { requireParticipant, apiErrorResponse } from "@/lib/api";
import { NextResponse } from "next/server";

export async function POST(_req: Request, { params }: { params: Promise<{ eventId: string; roundId: string }> }) {
  try {
    const { eventId, roundId } = await params;
    const participant = await requireParticipant();
    const ctx = await getParticipantContext(eventId, participant.id);
    if (!isStaff(ctx)) {
      throw new GameError("forbidden", "Only event moderators can open a lot.");
    }

    const lot = await openNextLot({ eventId, roundId, actorParticipantId: participant.id });
    return NextResponse.json(lot);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
