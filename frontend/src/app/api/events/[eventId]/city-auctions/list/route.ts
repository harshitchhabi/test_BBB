import { NextResponse } from "next/server";
import { db, eq, and, inArray } from "db";
import { cityAuctions, cityBids, cities, teams } from "db/schema";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// GET /events/:id/city-auctions/list — Section 7.6 City Auction screen's
// "current city auction with timer, bid entry, and result." Joins in the
// city's PUBLIC columns only (tier/name/opening bid) — never
// hidden_multiplier, same guarantee as GET /events/:id/cities.
export async function GET(_req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    await requireParticipant();

    const auctions = await db.select().from(cityAuctions).where(eq(cityAuctions.eventId, eventId));
    const cityRows = await db
      .select({ id: cities.id, name: cities.name, tier: cities.tier, revealState: cities.revealState })
      .from(cities)
      .where(eq(cities.eventId, eventId));
    const cityById = new Map(cityRows.map((c) => [c.id, c]));
    const teamRows = await db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.eventId, eventId));
    const teamNameById = new Map(teamRows.map((t) => [t.id, t.name]));

    // One query for every auction's current-highest bid instead of one
    // query per auction — see the identical fix on trades/list.
    const auctionIds = auctions.map((a) => a.id);
    const highestBids = auctionIds.length
      ? await db.select().from(cityBids).where(and(inArray(cityBids.cityAuctionId, auctionIds), eq(cityBids.status, "winning")))
      : [];
    const highestByAuctionId = new Map(highestBids.map((b) => [b.cityAuctionId, b]));

    const result = auctions.map((auction) => {
      const highest = highestByAuctionId.get(auction.id);
      return {
        ...auction,
        city: cityById.get(auction.cityId),
        currentHighestBid: highest ? { amount: highest.amount, teamId: highest.teamId, teamName: teamNameById.get(highest.teamId) } : null,
      };
    });

    return NextResponse.json({ auctions: result });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
