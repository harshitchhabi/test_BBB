import { NextResponse } from "next/server";
import { assignLastCity } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

export async function POST(req: Request, { params }: { params: Promise<{ eventId: string; cityId: string }> }) {
  try {
    const { eventId, cityId } = await params;
    const participant = await requireParticipant();
    const { teamId } = await req.json();
    if (typeof teamId !== "string") {
      return NextResponse.json({ error: "invalid_input", message: "teamId is required." }, { status: 400 });
    }
    const result = await assignLastCity({ eventId, cityId, teamId, actorParticipantId: participant.id });
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
