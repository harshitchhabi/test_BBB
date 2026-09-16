import { NextResponse } from "next/server";
import { startRound, getParticipantContext, GameError } from "game-engine";
import { isStaff } from "common";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// POST /events/:id/auction-rounds — moderator starts the next material
// round (Section 8.1 lists auction-lot open/close/bid explicitly; a round
// start is the same class of moderator-only command).
export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const ctx = await getParticipantContext(eventId, participant.id);
    if (!isStaff(ctx)) {
      throw new GameError("forbidden", "Only event moderators can start an auction round.");
    }

    const { materialTypeId, openingBidOverride, lotQuantityOverride } = await req.json();
    if (typeof materialTypeId !== "string") {
      return NextResponse.json({ error: "invalid_input", message: "materialTypeId is required." }, { status: 400 });
    }

    const round = await startRound({
      eventId,
      materialTypeId,
      actorParticipantId: participant.id,
      openingBidOverride: typeof openingBidOverride === "number" ? openingBidOverride : undefined,
      lotQuantityOverride: typeof lotQuantityOverride === "number" ? lotQuantityOverride : undefined,
    });
    return NextResponse.json(round);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
