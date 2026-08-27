import { NextResponse } from "next/server";
import { setTeamStatus } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// POST /events/:id/teams/:id/status — Section 7.9 Incidents: team
// withdrawal / disqualification (and reactivation back to "active").
export async function POST(req: Request, { params }: { params: Promise<{ eventId: string; teamId: string }> }) {
  try {
    const { eventId, teamId } = await params;
    const participant = await requireParticipant();
    const { status, reason } = await req.json();
    if (status !== "active" && status !== "withdrawn" && status !== "disqualified") {
      return NextResponse.json({ error: "invalid_input", message: 'status must be "active", "withdrawn", or "disqualified".' }, { status: 400 });
    }
    if (typeof reason !== "string" || reason.trim().length === 0) {
      return NextResponse.json({ error: "invalid_input", message: "A reason is required." }, { status: 400 });
    }
    const result = await setTeamStatus({ eventId, teamId, status, actorParticipantId: participant.id, reason });
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
