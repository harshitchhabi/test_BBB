import { NextResponse } from "next/server";
import { deleteSpectatorLogin } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// DELETE /events/:id/spectator-logins/:participantId — staff-only,
// requires a reason. Same released-login pattern as DELETE .../staff.
export async function DELETE(req: Request, { params }: { params: Promise<{ eventId: string; participantId: string }> }) {
  try {
    const { eventId, participantId } = await params;
    const participant = await requireParticipant();
    const { reason } = await req.json().catch(() => ({}));

    const result = await deleteSpectatorLogin({ eventId, actorParticipantId: participant.id, participantId, reason: typeof reason === "string" ? reason : undefined });
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
