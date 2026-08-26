import { NextResponse } from "next/server";
import { requestInspection } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const { challengerTeamId, targetBuildingId } = await req.json();

    if (typeof challengerTeamId !== "string" || typeof targetBuildingId !== "string") {
      return NextResponse.json(
        { error: "invalid_input", message: "challengerTeamId and targetBuildingId are required." },
        { status: 400 },
      );
    }

    const inspection = await requestInspection({ eventId, challengerTeamId, targetBuildingId, actingParticipantId: participant.id });
    return NextResponse.json(inspection);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
