import { NextResponse } from "next/server";
import { db, eq, and } from "db";
import { events, auctionRounds, auctionLots, bids, materialTypes, materialLots, teams, cityAuctions, cityBids, cities } from "db/schema";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// GET /events/:id/spectator-view — the "view desk" read-model for
// someone who is neither on a team nor staff: current stage, the live
// Stage 1 lot (material + current bid + current leader team name) if
// one is open, and the live city auction (city + current bid + current
// leader team name) if one is open. Deliberately narrower than
// auction-state/city-auctions/list — no token balances, no per-team
// inventory, no trade activity, no history, and no team is ever named
// except whoever currently holds the highest bid.
export async function GET(_req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    // Any authenticated participant may view this — it carries nothing
    // more sensitive than what's already projected on a screen at the
    // event, so there's no need to gate it to spectator-only logins.
    await requireParticipant();

    const [event] = await db.select().from(events).where(eq(events.id, eventId));
    if (!event) return NextResponse.json({ error: "not_found", message: "Event not found." }, { status: 404 });

    const teamRows = await db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.eventId, eventId));
    const teamNameById = new Map(teamRows.map((t) => [t.id, t.name]));

    let liveLot: { materialName: string | null; currentBid: number | null; leaderTeamName: string | null } | null = null;
    if (event.activeRoundId) {
      const [round] = await db.select().from(auctionRounds).where(eq(auctionRounds.id, event.activeRoundId));
      if (round) {
        const [lot] = await db
          .select()
          .from(auctionLots)
          .where(and(eq(auctionLots.roundId, round.id), eq(auctionLots.status, "live")));
        if (lot) {
          const [material] = await db.select({ name: materialTypes.name }).from(materialTypes).where(eq(materialTypes.id, round.materialTypeId));
          const [highest] = await db.select().from(bids).where(and(eq(bids.auctionLotId, lot.id), eq(bids.status, "winning")));
          liveLot = {
            materialName: material?.name ?? null,
            currentBid: highest ? highest.amount : lot.openingBid,
            leaderTeamName: highest ? (teamNameById.get(highest.teamId) ?? null) : null,
          };
        }
      }
    }

    let liveCityAuction: { cityName: string | null; currentBid: number | null; leaderTeamName: string | null } | null = null;
    if (event.activeCityAuctionId) {
      const [auction] = await db.select().from(cityAuctions).where(eq(cityAuctions.id, event.activeCityAuctionId));
      if (auction && auction.status === "live") {
        const [city] = await db.select({ name: cities.name }).from(cities).where(eq(cities.id, auction.cityId));
        const [highest] = await db.select().from(cityBids).where(and(eq(cityBids.cityAuctionId, auction.id), eq(cityBids.status, "winning")));
        liveCityAuction = {
          cityName: city?.name ?? null,
          currentBid: highest ? highest.amount : auction.openingBid,
          leaderTeamName: highest ? (teamNameById.get(highest.teamId) ?? null) : null,
        };
      }
    }

    return NextResponse.json({
      eventName: event.name,
      eventStatus: event.status,
      liveLot,
      liveCityAuction,
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
