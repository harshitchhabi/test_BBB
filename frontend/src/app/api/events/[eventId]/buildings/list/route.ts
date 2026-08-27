import { NextResponse, NextRequest } from "next/server";
import { db, eq, and } from "db";
import { constructedBuildings, buildingRecipes, teams, buildingBonusUses } from "db/schema";
import { getParticipantContext } from "game-engine";
import { isStaff } from "common";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// GET /events/:id/buildings/list — Section 7.5 "Constructed buildings /
// deeds / bonuses / current base score" and the moderator Build/Deed
// desk's building list. A team only sees its own; staff can pass
// ?teamId= to filter, or omit it to see every team's buildings (for the
// void/inspect workflow).
export async function GET(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const ctx = await getParticipantContext(eventId, participant.id);
    const staff = isStaff(ctx);

    const requestedTeamId = req.nextUrl.searchParams.get("teamId");
    const teamFilter = staff ? requestedTeamId : ctx.team?.teamId;

    const whereClause = teamFilter
      ? and(eq(constructedBuildings.eventId, eventId), eq(constructedBuildings.teamId, teamFilter))
      : eq(constructedBuildings.eventId, eventId);

    const buildings = staff || teamFilter ? await db.select().from(constructedBuildings).where(whereClause) : [];

    const recipeRows = await db.select().from(buildingRecipes).where(eq(buildingRecipes.eventId, eventId));
    const recipeById = new Map(recipeRows.map((r) => [r.id, r]));
    const teamRows = await db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.eventId, eventId));
    const teamNameById = new Map(teamRows.map((t) => [t.id, t.name]));

    const result = [];
    for (const b of buildings) {
      const bonusUses = await db.select().from(buildingBonusUses).where(eq(buildingBonusUses.constructedBuildingId, b.id));
      result.push({ ...b, recipeName: recipeById.get(b.recipeId)?.name, teamName: teamNameById.get(b.teamId), bonusUses });
    }

    return NextResponse.json({ buildings: result });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
