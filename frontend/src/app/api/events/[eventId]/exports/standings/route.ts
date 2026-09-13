import { NextResponse } from "next/server";
import { getScoreboard, getParticipantContext } from "game-engine";
import { isStaff } from "common";
import { db, eq } from "db";
import { teams } from "db/schema";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// GET /events/:id/exports/standings — Section 7.9 "Exports: ... final
// standings" and Section 9 Phase 5 "exported backup score sheet." Staff
// only. On-screen only (no CSV download) — the moderator "Final Results"
// screen and the Stage 3 Cities post-reveal table both read this JSON.
export async function GET(_req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const ctx = await getParticipantContext(eventId, participant.id);
    if (!isStaff(ctx)) {
      return NextResponse.json({ error: "forbidden", message: "Moderators only." }, { status: 403 });
    }

    const standings = await getScoreboard(eventId);
    const teamRows = await db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.eventId, eventId));
    const teamNameById = new Map(teamRows.map((t) => [t.id, t.name]));

    const rows = standings.map((s) => ({
      place: s.tiebreakerRank,
      team: teamNameById.get(s.teamId) ?? s.teamId,
      buildingPoints: s.buildingPoints,
      bonusPoints: s.bonusPoints,
      leftoverPoints: s.leftoverPoints,
      cityMultiplier: s.cityMultiplier,
      finalScore: s.finalScore,
      rank: s.rank,
    }));

    return NextResponse.json({ standings: rows });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
