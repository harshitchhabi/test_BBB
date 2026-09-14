import { NextResponse } from "next/server";
import { deleteStaffLogin } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// DELETE /events/:id/staff/:participantId — staff-only, requires a
// reason. Frees the login's username for reuse without deleting the
// underlying participant/audit trail — see team-service.ts's
// deleteStaffLogin for why.
export async function DELETE(req: Request, { params }: { params: Promise<{ eventId: string; participantId: string }> }) {
  try {
    const { eventId, participantId } = await params;
    const participant = await requireParticipant();
    const { reason } = await req.json().catch(() => ({}));

    const result = await deleteStaffLogin({ eventId, actorParticipantId: participant.id, participantId, reason: typeof reason === "string" ? reason : undefined });
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
