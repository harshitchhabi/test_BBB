import { NextResponse, NextRequest } from "next/server";
import { db, eq, and, inArray } from "db";
import { constructedBuildings, buildingRecipes, teams, buildingBonusUses } from "db/schema";
import { getParticipantContext } from "game-engine";
import { isStaff } from "common";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// GET /events/:id/buildings/list — Section 7.5 "Constructed buildings /
// deeds / bonuses / current base score" and the moderator Build/Deed
// desk's building list. ?teamId= filters to one team (any participant
// of the event may pass ANY team's id, or omit it to see every team's
// buildings); a constructed building is meant to be visible across
// teams once built — a team can only ever request an inspection
// (Section 7.6) by first being able to see what other teams have built
// to challenge, which this previously made structurally impossible for
// a non-staff caller (teamFilter was hard-forced to the caller's own
// team, silently ignoring any ?teamId= they passed).
export async function GET(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const ctx = await getParticipantContext(eventId, participant.id);
    if (!isStaff(ctx) && !ctx.team) {
      return NextResponse.json({ error: "forbidden", message: "You are not part of this event." }, { status: 403 });
    }

    const teamFilter = req.nextUrl.searchParams.get("teamId");

    const whereClause = teamFilter
      ? and(eq(constructedBuildings.eventId, eventId), eq(constructedBuildings.teamId, teamFilter))
      : eq(constructedBuildings.eventId, eventId);

    const buildings = await db.select().from(constructedBuildings).where(whereClause);

    const recipeRows = await db.select().from(buildingRecipes).where(eq(buildingRecipes.eventId, eventId));
    const recipeById = new Map(recipeRows.map((r) => [r.id, r]));
    const teamRows = await db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.eventId, eventId));
    const teamNameById = new Map(teamRows.map((t) => [t.id, t.name]));

    // One query for every building's bonus uses instead of one query per
    // building — see the identical fix on trades/list and
    // city-auctions/list.
    const buildingIds = buildings.map((b) => b.id);
    const allBonusUses = buildingIds.length
      ? await db.select().from(buildingBonusUses).where(inArray(buildingBonusUses.constructedBuildingId, buildingIds))
      : [];
    const bonusUsesByBuildingId = new Map<string, typeof allBonusUses>();
    for (const use of allBonusUses) {
      const existing = bonusUsesByBuildingId.get(use.constructedBuildingId);
      if (existing) existing.push(use);
      else bonusUsesByBuildingId.set(use.constructedBuildingId, [use]);
    }

    const result = buildings.map((b) => ({
      ...b,
      recipeName: recipeById.get(b.recipeId)?.name,
      teamName: teamNameById.get(b.teamId),
      bonusUses: bonusUsesByBuildingId.get(b.id) ?? [],
    }));

    return NextResponse.json({ buildings: result });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
