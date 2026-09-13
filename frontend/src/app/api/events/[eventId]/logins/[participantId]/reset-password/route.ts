import { NextResponse } from "next/server";
import { resetLoginPassword } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// POST /events/:id/logins/:participantId/reset-password — staff-only.
// Regenerates a team or staff login's password and force-clears its
// current session, so whoever was signed in has to sign in again with
// the new password. Mirrors dream_team's reissue-credentials action.
export async function POST(req: Request, { params }: { params: Promise<{ eventId: string; participantId: string }> }) {
  try {
    const { eventId, participantId } = await params;
    const participant = await requireParticipant();
    const { reason } = await req.json();
    if (typeof reason !== "string" || reason.trim().length === 0) {
      return NextResponse.json({ error: "invalid_input", message: "A reason is required to reset a login's password." }, { status: 400 });
    }

    const result = await resetLoginPassword({ eventId, actorParticipantId: participant.id, participantId, reason });
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
