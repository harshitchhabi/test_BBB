import { NextResponse } from "next/server";
import { getTeamScoutReports, getParticipantContext } from "game-engine";
import { isStaff } from "common";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// GET /events/:id/teams/:id/scout-reports — Section 7.6: "showing only
// the purchasing team's private clue." Same visibility rule as the
// inventory route: own team or staff only.
export async function GET(_req: Request, { params }: { params: Promise<{ eventId: string; teamId: string }> }) {
  try {
    const { eventId, teamId } = await params;
    const participant = await requireParticipant();
    const ctx = await getParticipantContext(eventId, participant.id);
    if (!isStaff(ctx) && ctx.team?.teamId !== teamId) {
      return NextResponse.json({ error: "forbidden", message: "You can only view your own team's scout reports." }, { status: 403 });
    }
    const reports = await getTeamScoutReports(eventId, teamId);
    return NextResponse.json({ reports });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
