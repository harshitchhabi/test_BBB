import { eq, and, sql } from "db";
import {
  events,
  eventSettings,
  teams,
  teamMembers,
  materialTypes,
  materialLots,
  auctionRounds,
  auctionLots,
  bids,
  teamInventoryTransactions,
} from "db/schema";
import { GameError } from "./errors";
import { recordAudit } from "./audit";
import { runInTransaction, type Tx } from "./tx";

// Section 6.2/6.3 workflows, Section 3.1 issues #1-4, made concrete:
//   - one service, no in-memory session state (contrast with the legacy
//     backend/lib/bidding-manager.ts + backend/websocket-server.ts, which
//     duplicated this logic in memory in two places and lost it on
//     restart);
//   - every mutation happens inside runInTransaction, which takes out
//     row locks (`.for("update")`) on the team and the lot before
//     validating anything, so two concurrent bids on the same lot (or two
//     bids draining the same team's balance at once) serialize instead of
//     racing;
//   - a bid that fails a rule is still persisted as a rejected row
//     (Section 3.1 #5 / Section 5.3 "never silently discard a rejected
//     bid") rather than just bouncing an error back to the client.

function computeMinimumRaise(
  openingBid: number,
  settings: { minimumRaiseStandard: number; minimumRaiseLowOpening: number; lowOpeningThreshold: number },
): number {
  return openingBid < settings.lowOpeningThreshold ? settings.minimumRaiseLowOpening : settings.minimumRaiseStandard;
}

async function assertStage1(tx: Tx, eventId: string) {
  const [event] = await tx.select().from(events).where(eq(events.id, eventId));
  if (!event) throw new GameError("not_found", "Event not found.");
  if (event.status !== "stage_1") {
    throw new GameError("invalid_event_stage", "The material auction is only open during Stage 1.");
  }
  return event;
}

async function assertTeamLeader(tx: Tx, eventId: string, teamId: string, participantId: string) {
  const [membership] = await tx
    .select({ role: teamMembers.role, teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(and(eq(teamMembers.eventId, eventId), eq(teamMembers.participantId, participantId)));
  if (!membership || membership.teamId !== teamId || membership.role !== "leader") {
    throw new GameError("forbidden", "Only the team leader may bid for this team.");
  }
}

// Instantiates one auction lot per active team for a material round —
// rulebook: "For each team in the room, the moderator adds one of each lot
// below." Each lot gets its own material_lot (the finite, real unit being
// sold) plus an auction_lot (the live-sale record), sequenced by team
// join order. Market-shock price adjustment is applied by the caller
// (Phase 2 concern) before this runs, by passing an already-adjusted
// openingBid.
export async function startRound(params: {
  eventId: string;
  materialTypeId: string;
  actorParticipantId: string;
  openingBidOverride?: number;
}) {
  return runInTransaction(async (tx, queueBroadcast) => {
    const event = await assertStage1(tx, params.eventId);

    const [material] = await tx.select().from(materialTypes).where(eq(materialTypes.id, params.materialTypeId));
    if (!material) throw new GameError("not_found", "Material type not found.");

    const [existingActiveRound] = await tx
      .select()
      .from(auctionRounds)
      .where(and(eq(auctionRounds.eventId, params.eventId), eq(auctionRounds.status, "active")));
    if (existingActiveRound) {
      throw new GameError("conflict", "Another round is already active — close it before starting a new one.");
    }

    const activeTeams = await tx
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.eventId, params.eventId), eq(teams.status, "active")));
    if (activeTeams.length === 0) {
      throw new GameError("conflict", "No active teams to auction to.");
    }

    const [nextSequence] = await tx
      .select({ maxSequence: sql<number>`coalesce(max(${auctionRounds.sequence}), 0)` })
      .from(auctionRounds)
      .where(eq(auctionRounds.eventId, params.eventId));

    const [round] = await tx
      .insert(auctionRounds)
      .values({
        eventId: params.eventId,
        materialTypeId: params.materialTypeId,
        sequence: (nextSequence?.maxSequence ?? 0) + 1,
        status: "active",
        startedAt: new Date(),
      })
      .returning();

    const [settings] = await tx.select().from(eventSettings).where(eq(eventSettings.eventId, params.eventId));
    if (!settings) throw new GameError("not_found", "Event settings not found.");

    const openingBid = params.openingBidOverride ?? material.defaultOpeningBid;
    const minimumRaise = computeMinimumRaise(openingBid, settings);

    let lotNumber = 1;
    for (const team of activeTeams) {
      const [materialLot] = await tx
        .insert(materialLots)
        .values({
          eventId: params.eventId,
          materialTypeId: material.id,
          quantity: material.defaultLotQuantity,
          openingBid,
          source: "auction",
          status: "auctioning",
        })
        .returning();

      await tx.insert(auctionLots).values({
        eventId: params.eventId,
        roundId: round.id,
        materialLotId: materialLot.id,
        lotNumber: lotNumber++,
        openingBid,
        minimumRaise,
        status: "pending",
      });
    }

    await tx.update(events).set({ activeRoundId: round.id }).where(eq(events.id, event.id));

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actorParticipantId,
      action: "auction_round.started",
      entityType: "auction_round",
      entityId: round.id,
      afterJson: { round, materialKey: material.key, lotCount: activeTeams.length },
    });

    queueBroadcast({
      eventId: params.eventId,
      type: "auction.round_started",
      data: { roundId: round.id, materialKey: material.key, materialName: material.name, lotCount: activeTeams.length },
    });

    return round;
  });
}

export async function openNextLot(params: { eventId: string; roundId: string; actorParticipantId: string }) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStage1(tx, params.eventId);

    const [settings] = await tx.select().from(eventSettings).where(eq(eventSettings.eventId, params.eventId));
    if (!settings) throw new GameError("not_found", "Event settings not found.");

    const [stillLive] = await tx
      .select({ id: auctionLots.id })
      .from(auctionLots)
      .where(and(eq(auctionLots.roundId, params.roundId), eq(auctionLots.status, "live")));
    if (stillLive) {
      throw new GameError("conflict", "Close the current lot before opening the next one.");
    }

    const [nextLot] = await tx
      .select()
      .from(auctionLots)
      .where(and(eq(auctionLots.roundId, params.roundId), eq(auctionLots.status, "pending")))
      .orderBy(auctionLots.lotNumber)
      .limit(1);
    if (!nextLot) throw new GameError("not_found", "No pending lots left in this round.");

    const opensAt = new Date();
    const closesAt = new Date(opensAt.getTime() + settings.auctionLotDurationSeconds * 1000);

    const [updated] = await tx
      .update(auctionLots)
      .set({ status: "live", opensAt, closesAt })
      .where(eq(auctionLots.id, nextLot.id))
      .returning();

    await tx
      .update(materialLots)
      .set({ status: "auctioning" })
      .where(eq(materialLots.id, nextLot.materialLotId));

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actorParticipantId,
      action: "auction_lot.opened",
      entityType: "auction_lot",
      entityId: updated.id,
      afterJson: updated,
    });

    queueBroadcast({
      eventId: params.eventId,
      type: "auction.lot_opened",
      data: updated,
    });

    return updated;
  });
}

export async function placeBid(params: {
  eventId: string;
  auctionLotId: string;
  teamId: string;
  actingParticipantId: string;
  amount: number;
}) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStage1(tx, params.eventId);
    await assertTeamLeader(tx, params.eventId, params.teamId, params.actingParticipantId);

    // Lock the team row first, then the lot row, in a fixed order —
    // always team-then-lot — so two concurrent bids from the same team on
    // different lots (or a bid and a moderator close on the same lot)
    // can't deadlock each other by acquiring these two locks in reverse
    // order.
    const [team] = await tx.select().from(teams).where(eq(teams.id, params.teamId)).for("update");
    if (!team || team.eventId !== params.eventId) throw new GameError("not_found", "Team not found.");
    if (team.status !== "active") throw new GameError("forbidden", "This team is not active.");

    const [lot] = await tx.select().from(auctionLots).where(eq(auctionLots.id, params.auctionLotId)).for("update");
    if (!lot || lot.eventId !== params.eventId) throw new GameError("not_found", "Auction lot not found.");
    if (lot.status !== "live") throw new GameError("lot_not_live", "This lot is not open for bidding.");
    if (lot.closesAt && lot.closesAt.getTime() < Date.now()) {
      throw new GameError("lot_not_live", "This lot's timer has already expired.");
    }

    const [currentWinning] = await tx
      .select()
      .from(bids)
      .where(and(eq(bids.auctionLotId, lot.id), eq(bids.status, "winning")));

    const minimumBid = currentWinning ? currentWinning.amount + lot.minimumRaise : lot.openingBid;

    if (params.amount < minimumBid) {
      const [rejected] = await tx
        .insert(bids)
        .values({
          auctionLotId: lot.id,
          teamId: team.id,
          amount: params.amount,
          status: "rejected",
          rejectionReason: `Bid must be at least ${minimumBid} tokens.`,
        })
        .returning();
      return { accepted: false as const, bid: rejected };
    }

    if (params.amount > team.auctionTokens) {
      const [rejected] = await tx
        .insert(bids)
        .values({
          auctionLotId: lot.id,
          teamId: team.id,
          amount: params.amount,
          status: "rejected",
          rejectionReason: "Insufficient auction tokens.",
        })
        .returning();
      return { accepted: false as const, bid: rejected };
    }

    if (currentWinning) {
      await tx.update(bids).set({ status: "outbid" }).where(eq(bids.id, currentWinning.id));
    }

    const [accepted] = await tx
      .insert(bids)
      .values({ auctionLotId: lot.id, teamId: team.id, amount: params.amount, status: "winning" })
      .returning();

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actingParticipantId,
      action: "bid.accepted",
      entityType: "bid",
      entityId: accepted.id,
      afterJson: accepted,
    });

    queueBroadcast({
      eventId: params.eventId,
      type: "auction.bid_accepted",
      data: { auctionLotId: lot.id, teamId: team.id, amount: params.amount },
    });

    return { accepted: true as const, bid: accepted };
  });
}

// Section 6.3. `actorParticipantId: null` means the timer closed it, not a
// moderator click — recordAudit only requires a reason when there IS an
// actor, so a timer-driven close doesn't need to invent one.
export async function closeLot(params: {
  eventId: string;
  auctionLotId: string;
  actorParticipantId: string | null;
  reason?: string;
}) {
  return runInTransaction(async (tx, queueBroadcast) => {
    const [lot] = await tx.select().from(auctionLots).where(eq(auctionLots.id, params.auctionLotId)).for("update");
    if (!lot || lot.eventId !== params.eventId) throw new GameError("not_found", "Auction lot not found.");
    if (lot.status !== "live") throw new GameError("conflict", "Only a live lot can be closed.");

    const [winningBid] = await tx
      .select()
      .from(bids)
      .where(and(eq(bids.auctionLotId, lot.id), eq(bids.status, "winning")));

    const [materialLot] = await tx.select().from(materialLots).where(eq(materialLots.id, lot.materialLotId));
    if (!materialLot) throw new GameError("not_found", "Material lot not found.");

    if (!winningBid) {
      await tx.update(auctionLots).set({ status: "unsold" }).where(eq(auctionLots.id, lot.id));
      await tx.update(materialLots).set({ status: "bank_stock" }).where(eq(materialLots.id, materialLot.id));

      await recordAudit(tx, {
        eventId: params.eventId,
        actorParticipantId: params.actorParticipantId,
        reason: params.reason ?? "Lot closed with no bids.",
        isOverride: Boolean(params.actorParticipantId),
        action: "auction_lot.unsold",
        entityType: "auction_lot",
        entityId: lot.id,
      });

      queueBroadcast({
        eventId: params.eventId,
        type: "auction.lot_closed",
        data: { auctionLotId: lot.id, winnerTeamId: null },
      });

      return { winnerTeamId: null as string | null };
    }

    const [team] = await tx.select().from(teams).where(eq(teams.id, winningBid.teamId)).for("update");
    if (!team) throw new GameError("not_found", "Winning team not found.");
    if (team.auctionTokens < winningBid.amount) {
      // Rulebook contingency: "A team can't pay its bid: void the bid,
      // re-offer the lot immediately." That re-offer is a moderator action
      // (Phase 5); here we only guarantee we never let the balance go
      // negative — we void the bid and the lot goes unsold instead of
      // silently under-charging the team.
      await tx.update(bids).set({ status: "voided" }).where(eq(bids.id, winningBid.id));
      await tx.update(auctionLots).set({ status: "unsold" }).where(eq(auctionLots.id, lot.id));
      await tx.update(materialLots).set({ status: "bank_stock" }).where(eq(materialLots.id, materialLot.id));

      await recordAudit(tx, {
        eventId: params.eventId,
        actorParticipantId: params.actorParticipantId,
        reason: "Winning team could not cover its bid at close.",
        isOverride: true,
        action: "bid.voided_insufficient_funds",
        entityType: "bid",
        entityId: winningBid.id,
      });

      queueBroadcast({
        eventId: params.eventId,
        type: "auction.lot_closed",
        data: { auctionLotId: lot.id, winnerTeamId: null, voidedForNonPayment: true },
      });

      return { winnerTeamId: null as string | null };
    }

    await tx
      .update(teams)
      .set({ auctionTokens: team.auctionTokens - winningBid.amount })
      .where(eq(teams.id, team.id));

    await tx.update(materialLots).set({ status: "sold", ownerTeamId: team.id }).where(eq(materialLots.id, materialLot.id));

    await tx.insert(teamInventoryTransactions).values({
      eventId: params.eventId,
      teamId: team.id,
      materialTypeId: materialLot.materialTypeId,
      quantityDelta: materialLot.quantity,
      reason: "auction_win",
      relatedEntityType: "auction_lot",
      relatedEntityId: lot.id,
      createdBy: params.actorParticipantId,
    });

    await tx
      .update(auctionLots)
      .set({ status: "closed", winningBidId: winningBid.id, winnerTeamId: team.id })
      .where(eq(auctionLots.id, lot.id));

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actorParticipantId,
      reason: params.reason,
      action: "auction_lot.closed",
      entityType: "auction_lot",
      entityId: lot.id,
      afterJson: { winnerTeamId: team.id, amount: winningBid.amount },
    });

    queueBroadcast({
      eventId: params.eventId,
      type: "auction.lot_closed",
      data: { auctionLotId: lot.id, winnerTeamId: team.id, amount: winningBid.amount },
    });

    return { winnerTeamId: team.id as string | null };
  });
}
