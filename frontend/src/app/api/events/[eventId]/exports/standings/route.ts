import { NextResponse } from "next/server";
import { getScoreboard, getParticipantContext } from "game-engine";
import { isStaff } from "common";
import { db, eq } from "db";
import { teams } from "db/schema";
import { requireParticipant, apiErrorResponse } from "@/lib/api";
import { toCsv } from "@/lib/csv";

// GET /events/:id/exports/standings — Section 7.9 "Exports: ... final
// standings" and Section 9 Phase 5 "exported backup score sheet." Staff
// only — even after reveal, this is the moderator's paper-trail export,
// not a public leaderboard endpoint.
export async function GET(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
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

    if (new URL(req.url).searchParams.get("format") === "json") {
      return NextResponse.json({ standings: rows });
    }

    return new NextResponse(toCsv(rows), {
      headers: { "content-type": "text/csv", "content-disposition": `attachment; filename="standings-${eventId}.csv"` },
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
