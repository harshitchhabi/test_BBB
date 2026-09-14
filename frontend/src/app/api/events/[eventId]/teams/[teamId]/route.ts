import { NextResponse } from "next/server";
import { deleteTeam } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// DELETE /events/:id/teams/:teamId — permanent removal, staff-only,
// requires a reason. See incident-service.ts's deleteTeam for what this
// does and doesn't touch — setTeamStatus (withdraw/disqualify) is the
// safer choice for a team with real game history.
export async function DELETE(req: Request, { params }: { params: Promise<{ eventId: string; teamId: string }> }) {
  try {
    const { eventId, teamId } = await params;
    const participant = await requireParticipant();
    const { reason } = await req.json().catch(() => ({}));
    const result = await deleteTeam({ eventId, teamId, actorParticipantId: participant.id, reason: typeof reason === "string" ? reason : undefined });
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
