import { NextResponse } from "next/server";
import { startRound, listActiveRounds, getParticipantContext, GameError } from "game-engine";
import { isStaff } from "common";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// GET /events/:id/auction-rounds — every round still "active" (started,
// not yet fully sold through), whether or not it currently has a live
// lot. Backs the moderator console's round switcher: a round can be
// paused (started another material instead) and resumed later, so this
// is how the moderator picks which one to open the next lot in.
export async function GET(_req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const ctx = await getParticipantContext(eventId, participant.id);
    if (!isStaff(ctx)) {
      throw new GameError("forbidden", "Only event moderators can see the round switcher.");
    }
    const rounds = await listActiveRounds(eventId);
    return NextResponse.json({ rounds });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

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
