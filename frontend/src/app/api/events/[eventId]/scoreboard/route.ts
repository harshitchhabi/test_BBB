import { NextResponse } from "next/server";
import { getScoreboard } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// GET /events/:id/scoreboard — Section 7.7 "After reveal" — public once
// revealCitiesAndScore has run; there's nothing private left in a final
// snapshot (every hidden multiplier that mattered is, by definition,
// revealed by the time this table exists).
export async function GET(_req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    await requireParticipant();
    const standings = await getScoreboard(eventId);
    return NextResponse.json({ standings });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
