import { NextResponse } from "next/server";
import { getParticipantContext } from "game-engine";
import { isStaff } from "common";
import { db, eq } from "db";
import { bids, auctionLots, auctionRounds, materialTypes, teams } from "db/schema";
import { requireParticipant, apiErrorResponse } from "@/lib/api";
import { toCsv } from "@/lib/csv";

// GET /events/:id/exports/bid-history — Section 7.9 "Exports: bid
// history." Every Stage 1 bid ever submitted, accepted or rejected,
// with which lot/material/round it belongs to — the full paper trail
// behind every material sale.
export async function GET(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const ctx = await getParticipantContext(eventId, participant.id);
    if (!isStaff(ctx)) {
      return NextResponse.json({ error: "forbidden", message: "Moderators only." }, { status: 403 });
    }

    const lots = await db.select().from(auctionLots).where(eq(auctionLots.eventId, eventId));
    const lotById = new Map(lots.map((l) => [l.id, l]));
    const rounds = await db.select().from(auctionRounds).where(eq(auctionRounds.eventId, eventId));
    const roundById = new Map(rounds.map((r) => [r.id, r]));
    const materialRows = await db.select({ id: materialTypes.id, name: materialTypes.name }).from(materialTypes).where(eq(materialTypes.eventId, eventId));
    const materialNameById = new Map(materialRows.map((m) => [m.id, m.name]));
    const teamRows = await db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.eventId, eventId));
    const teamNameById = new Map(teamRows.map((t) => [t.id, t.name]));

    const allBids = [];
    for (const lot of lots) {
      const lotBids = await db.select().from(bids).where(eq(bids.auctionLotId, lot.id));
      for (const bid of lotBids) {
        const round = roundById.get(lot.roundId);
        allBids.push({
          submittedAt: bid.submittedAt.toISOString(),
          round: round?.sequence,
          material: round ? materialNameById.get(round.materialTypeId) : "",
          lotNumber: lot.lotNumber,
          team: teamNameById.get(bid.teamId) ?? bid.teamId,
          amount: bid.amount,
          status: bid.status,
          rejectionReason: bid.rejectionReason ?? "",
        });
      }
    }
    allBids.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));

    if (new URL(req.url).searchParams.get("format") === "json") {
      return NextResponse.json({ bids: allBids });
    }

    return new NextResponse(toCsv(allBids), {
      headers: { "content-type": "text/csv", "content-disposition": `attachment; filename="bid-history-${eventId}.csv"` },
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
