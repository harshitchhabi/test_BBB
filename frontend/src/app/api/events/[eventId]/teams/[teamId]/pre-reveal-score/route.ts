import { NextResponse } from "next/server";
import { getPreRevealScore, getParticipantContext } from "game-engine";
import { isStaff } from "common";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// GET /events/:id/teams/:id/pre-reveal-score — Section 7.7 "Before
// reveal": approved deeds + bonus points, pre-multiplier, plus the team's
// city name/tier without its multiplier.
export async function GET(_req: Request, { params }: { params: Promise<{ eventId: string; teamId: string }> }) {
  try {
    const { eventId, teamId } = await params;
    const participant = await requireParticipant();
    const ctx = await getParticipantContext(eventId, participant.id);
    if (!isStaff(ctx) && ctx.team?.teamId !== teamId) {
      return NextResponse.json({ error: "forbidden", message: "You can only view your own team's score." }, { status: 403 });
    }
    const score = await getPreRevealScore(eventId, teamId);
    return NextResponse.json(score);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
