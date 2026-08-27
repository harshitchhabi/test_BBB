import { NextResponse } from "next/server";
import { db, eq } from "db";
import { inspections, constructedBuildings, teams } from "db/schema";
import { getParticipantContext } from "game-engine";
import { isStaff } from "common";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

export async function GET(_req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const ctx = await getParticipantContext(eventId, participant.id);

    const rows = isStaff(ctx)
      ? await db.select().from(inspections).where(eq(inspections.eventId, eventId))
      : ctx.team
        ? await db.select().from(inspections).where(eq(inspections.challengerTeamId, ctx.team.teamId))
        : [];

    const teamRows = await db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.eventId, eventId));
    const teamNameById = new Map(teamRows.map((t) => [t.id, t.name]));
    const buildingRows = await db.select().from(constructedBuildings).where(eq(constructedBuildings.eventId, eventId));
    const buildingById = new Map(buildingRows.map((b) => [b.id, b]));

    return NextResponse.json({
      inspections: rows.map((r) => ({
        ...r,
        challengerTeamName: teamNameById.get(r.challengerTeamId),
        targetBuilding: buildingById.get(r.targetBuildingId),
        targetTeamName: teamNameById.get(buildingById.get(r.targetBuildingId)?.teamId ?? ""),
      })),
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
