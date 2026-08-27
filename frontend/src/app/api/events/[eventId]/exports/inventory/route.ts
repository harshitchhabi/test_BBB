import { NextResponse } from "next/server";
import { getParticipantContext } from "game-engine";
import { isStaff } from "common";
import { db, eq } from "db";
import { teamInventoryTransactions, teams, materialTypes } from "db/schema";
import { requireParticipant, apiErrorResponse } from "@/lib/api";
import { toCsv } from "@/lib/csv";

// GET /events/:id/exports/inventory — Section 7.9 "Exports: team
// inventory..." Every team's full ledger (not just current stock) so the
// moderator has a complete paper trail of every won/traded/bought/
// consumed unit, matching the audit-log export's level of detail.
export async function GET(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const ctx = await getParticipantContext(eventId, participant.id);
    if (!isStaff(ctx)) {
      return NextResponse.json({ error: "forbidden", message: "Moderators only." }, { status: 403 });
    }

    const rows = await db.select().from(teamInventoryTransactions).where(eq(teamInventoryTransactions.eventId, eventId));
    const teamRows = await db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.eventId, eventId));
    const teamNameById = new Map(teamRows.map((t) => [t.id, t.name]));
    const materialRows = await db.select({ id: materialTypes.id, name: materialTypes.name }).from(materialTypes).where(eq(materialTypes.eventId, eventId));
    const materialNameById = new Map(materialRows.map((m) => [m.id, m.name]));

    const csvRows = rows.map((r) => ({
      timestamp: r.createdAt.toISOString(),
      team: teamNameById.get(r.teamId) ?? r.teamId,
      material: materialNameById.get(r.materialTypeId) ?? r.materialTypeId,
      quantityDelta: r.quantityDelta,
      reason: r.reason,
      relatedEntityType: r.relatedEntityType ?? "",
      relatedEntityId: r.relatedEntityId ?? "",
    }));

    if (new URL(req.url).searchParams.get("format") === "json") {
      return NextResponse.json({ inventory: csvRows });
    }

    return new NextResponse(toCsv(csvRows), {
      headers: { "content-type": "text/csv", "content-disposition": `attachment; filename="inventory-${eventId}.csv"` },
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
