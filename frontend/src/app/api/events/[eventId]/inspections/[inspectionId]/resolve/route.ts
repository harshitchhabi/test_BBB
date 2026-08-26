import { NextResponse } from "next/server";
import { resolveInspection } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

export async function POST(req: Request, { params }: { params: Promise<{ eventId: string; inspectionId: string }> }) {
  try {
    const { eventId, inspectionId } = await params;
    const participant = await requireParticipant();
    const { result } = await req.json();
    if (result !== "passed" && result !== "failed") {
      return NextResponse.json({ error: "invalid_input", message: 'result must be "passed" or "failed".' }, { status: 400 });
    }
    const inspection = await resolveInspection({ eventId, inspectionId, result, moderatorParticipantId: participant.id });
    return NextResponse.json(inspection);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
