import { NextResponse } from "next/server";
import { setEventStatus } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// POST /events/:id/status — advances (or pauses/resumes) the event
// through setup -> lobby -> stage_1 -> stage_2 -> stage_3 -> completed.
// This was a genuine gap: nothing anywhere else ever wrote to
// events.status except the final reveal, so every stage-gated action
// would fail forever without this endpoint.
export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const { status, reason } = await req.json();
    if (typeof status !== "string") {
      return NextResponse.json({ error: "invalid_input", message: "status is required." }, { status: 400 });
    }
    const event = await setEventStatus({ eventId, status, actorParticipantId: participant.id, reason });
    return NextResponse.json(event);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
