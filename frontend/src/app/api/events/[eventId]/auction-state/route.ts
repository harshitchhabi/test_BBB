import { NextResponse } from "next/server";
import { db, eq, and, ne, desc, sql } from "db";
import { events, auctionRounds, auctionLots, bids, materialTypes, materialLots, teams, marketShockCards } from "db/schema";
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

    const teamRows = await db
      .select({ id: teams.id, name: teams.name, auctionTokens: teams.auctionTokens, status: teams.status })
      .from(teams)
      .where(eq(teams.eventId, eventId));

    let activeRound: {
      id: string;
      sequence: number;
      materialTypeId?: string;
      materialKey?: string;
      materialName?: string;
      shock: { title: string; description: string } | null;
      // Rulebook v2 Reserved Kit: only Bricks/Cement/Steel carry the
      // right, and only until the first lot in this round has ever gone
      // live — see claimReservedKit's own window check, mirrored here so
      // the team-facing screen can show/hide the claim button without
      // guessing.
      reservedKitEligible?: boolean;
      reservedKitWindowOpen?: boolean;
    } | null = null;
    let liveLot: {
      id: string;
      lotNumber: number;
      materialKey?: string;
      materialName?: string;
      quantity: number | null;
      openingBid: number;
      minimumRaise: number;
      closesAt: Date | null;
      currentHighestBid: { id: string; amount: number; teamId: string } | null;
      nextMinimumBid: number;
    } | null = null;
    let pendingLotsCount = 0;
    let recentLots: Array<{ id: string; lotNumber: number; status: string; winnerTeamName: string | null; winningBidId: string | null }> = [];

    if (event.activeRoundId) {
      const [round] = await db.select().from(auctionRounds).where(eq(auctionRounds.id, event.activeRoundId));

      if (round) {
        const [material] = await db.select().from(materialTypes).where(eq(materialTypes.id, round.materialTypeId));

        let shock: { title: string; description: string } | null = null;
        if (round.marketShockCardId) {
          const [card] = await db.select().from(marketShockCards).where(eq(marketShockCards.id, round.marketShockCardId));
          if (card) shock = { title: card.title, description: card.description };
        }
        let reservedKitWindowOpen = false;
        if (material?.reservedKitEligible) {
          const [everOpened] = await db
            .select({ id: auctionLots.id })
            .from(auctionLots)
            .where(and(eq(auctionLots.roundId, round.id), sql`${auctionLots.status} != 'pending'`))
            .limit(1);
          reservedKitWindowOpen = !everOpened;
        }

        activeRound = {
          id: round.id,
          sequence: round.sequence,
          materialTypeId: round.materialTypeId,
          materialKey: material?.key,
          materialName: material?.name,
          shock,
          reservedKitEligible: material?.reservedKitEligible ?? false,
          reservedKitWindowOpen,
        };

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

          const [materialLot] = await db.select({ quantity: materialLots.quantity }).from(materialLots).where(eq(materialLots.id, lot.materialLotId));

          liveLot = {
            id: lot.id,
            lotNumber: lot.lotNumber,
            materialKey: material?.key,
            materialName: material?.name,
            quantity: materialLot?.quantity ?? null,
            openingBid: lot.openingBid,
            minimumRaise: lot.minimumRaise,
            closesAt: lot.closesAt,
            currentHighestBid: highest ? { id: highest.id, amount: highest.amount, teamId: highest.teamId } : null,
            nextMinimumBid: highest ? highest.amount + lot.minimumRaise : lot.openingBid,
          };
        }

        // Task 2: dream_team's admin console can force a lot's outcome
        // after the fact (its AssignUnsoldToPlayers). The nearest
        // equivalent here is voidBid (undo the winning bid, effectively
        // forcing the lot unsold) and reopenLot (put a resolved lot back
        // up for bidding) — both already existed as engine functions and
        // API routes but had no UI. Surfacing the last few resolved lots
        // here is what that UI needs to know which bid/lot to act on.
        if (isStaff(ctx)) {
          const resolvedLots = await db
            .select()
            .from(auctionLots)
            .where(and(eq(auctionLots.roundId, round.id), ne(auctionLots.status, "pending"), ne(auctionLots.status, "live")))
            .orderBy(desc(auctionLots.lotNumber))
            .limit(5);
          recentLots = await Promise.all(
            resolvedLots.map(async (rl) => {
              const [winningBid] = rl.winnerTeamId
                ? await db.select().from(bids).where(and(eq(bids.auctionLotId, rl.id), eq(bids.status, "winning")))
                : [];
              const winnerTeam = rl.winnerTeamId ? teamRows.find((t) => t.id === rl.winnerTeamId) : undefined;
              return {
                id: rl.id,
                lotNumber: rl.lotNumber,
                status: rl.status,
                winnerTeamName: winnerTeam?.name ?? null,
                winningBidId: winningBid?.id ?? null,
              };
            }),
          );
        }
      }
    }

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
      recentLots,
      teams: visibleTeams,
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
