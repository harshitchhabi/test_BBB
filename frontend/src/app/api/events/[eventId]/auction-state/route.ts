import { NextResponse } from "next/server";
import { db, eq, and, sql } from "db";
import { events, auctionRounds, auctionLots, bids, materialTypes, teams, marketShockCards } from "db/schema";
import { getParticipantContext } from "game-engine";
import { isStaff } from "common";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// GET /events/:id/auction-state — the one read-model both the team Live
// Auction screen and the moderator console poll on load / after a
// WebSocket nudge (Section 7.3: "Show enough information to bid
// correctly, but never show other teams' hidden data"). Non-staff callers
// only get their own team's balance — every other team's row has
// auctionTokens stripped to null (Section 8.3: "Clients receive their own
// private balance").
export async function GET(_req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const ctx = await getParticipantContext(eventId, participant.id);
    if (!ctx.staffRole && !ctx.team) {
      return NextResponse.json({ error: "forbidden", message: "Join a team or be staff for this event first." }, { status: 403 });
    }

    const [event] = await db.select().from(events).where(eq(events.id, eventId));
    if (!event) return NextResponse.json({ error: "not_found", message: "Event not found." }, { status: 404 });

    let activeRound: {
      id: string;
      sequence: number;
      materialKey?: string;
      materialName?: string;
      shock: { title: string; description: string } | null;
    } | null = null;
    let liveLot: {
      id: string;
      lotNumber: number;
      materialKey?: string;
      materialName?: string;
      openingBid: number;
      minimumRaise: number;
      closesAt: Date | null;
      currentHighestBid: { amount: number; teamId: string } | null;
      nextMinimumBid: number;
    } | null = null;
    let pendingLotsCount = 0;

    if (event.activeRoundId) {
      const [round] = await db.select().from(auctionRounds).where(eq(auctionRounds.id, event.activeRoundId));

      if (round) {
        const [material] = await db.select().from(materialTypes).where(eq(materialTypes.id, round.materialTypeId));

        let shock: { title: string; description: string } | null = null;
        if (round.marketShockCardId) {
          const [card] = await db.select().from(marketShockCards).where(eq(marketShockCards.id, round.marketShockCardId));
          if (card) shock = { title: card.title, description: card.description };
        }
        activeRound = { id: round.id, sequence: round.sequence, materialKey: material?.key, materialName: material?.name, shock };

        const [pendingCountRow] = await db
          .select({ count: sql<number>`count(*)` })
          .from(auctionLots)
          .where(and(eq(auctionLots.roundId, round.id), eq(auctionLots.status, "pending")));
        pendingLotsCount = Number(pendingCountRow?.count ?? 0);

        const [lot] = await db
          .select()
          .from(auctionLots)
          .where(and(eq(auctionLots.roundId, round.id), eq(auctionLots.status, "live")));

        if (lot) {
          const [highest] = await db
            .select()
            .from(bids)
            .where(and(eq(bids.auctionLotId, lot.id), eq(bids.status, "winning")));

          liveLot = {
            id: lot.id,
            lotNumber: lot.lotNumber,
            materialKey: material?.key,
            materialName: material?.name,
            openingBid: lot.openingBid,
            minimumRaise: lot.minimumRaise,
            closesAt: lot.closesAt,
            currentHighestBid: highest ? { amount: highest.amount, teamId: highest.teamId } : null,
            nextMinimumBid: highest ? highest.amount + lot.minimumRaise : lot.openingBid,
          };
        }
      }
    }

    const teamRows = await db
      .select({ id: teams.id, name: teams.name, auctionTokens: teams.auctionTokens, status: teams.status })
      .from(teams)
      .where(eq(teams.eventId, eventId));

    const visibleTeams = isStaff(ctx)
      ? teamRows
      : teamRows.map((t) => (t.id === ctx.team?.teamId ? t : { ...t, auctionTokens: null }));

    return NextResponse.json({
      eventStatus: event.status,
      isStaff: isStaff(ctx),
      myTeamId: ctx.team?.teamId ?? null,
      myRole: ctx.team?.role ?? null,
      activeRound,
      liveLot,
      pendingLotsCount,
      teams: visibleTeams,
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
