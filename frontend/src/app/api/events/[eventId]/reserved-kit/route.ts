import { NextResponse } from "next/server";
import { claimReservedKit } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// POST /events/:id/reserved-kit — a team leader claiming their team's
// Reserved Kit lot (Bricks/Cement/Steel only, one no-bid lot at printed
// opening price, only before open bidding starts on that material).
// Team-leader authorization is checked inside claimReservedKit itself,
// same as placeBid.
export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const { teamId, materialTypeId } = await req.json();
    if (typeof teamId !== "string" || typeof materialTypeId !== "string") {
      return NextResponse.json({ error: "invalid_input", message: "teamId and materialTypeId are required." }, { status: 400 });
    }

    const result = await claimReservedKit({ eventId, teamId, materialTypeId, actingParticipantId: participant.id });
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
