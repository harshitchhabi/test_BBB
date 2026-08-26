import { NextResponse } from "next/server";
import { purchaseScoutReport } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const { teamId, cityId } = await req.json();
    if (typeof teamId !== "string" || typeof cityId !== "string") {
      return NextResponse.json({ error: "invalid_input", message: "teamId and cityId are required." }, { status: 400 });
    }
    const report = await purchaseScoutReport({ eventId, teamId, cityId, actingParticipantId: participant.id });
    return NextResponse.json(report);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
