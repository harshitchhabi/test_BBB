import { db, eq, and, sql } from "db";
import {
  events,
  eventSettings,
  teams,
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
import { drawShockCard, applyMaterialEffect, applyGlobalEffect, type ShockEffect } from "./market-shock-service";
import { assertTeamLeaderTx, assertStaffTx } from "./team-service";

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

// Once every lot in a round has left "pending"/"live" (closed, unsold, or
// voided), the round itself is done — nothing in Section 5.3 ever flips
// auction_rounds.status away from "active" on its own, so without this a
// round would stay "active" forever and startRound's "only one active
// round at a time" guard would permanently block the next material.
async function completeRoundIfFinished(tx: Tx, eventId: string, roundId: string) {
  const [stillOpen] = await tx
    .select({ id: auctionLots.id })
    .from(auctionLots)
    .where(and(eq(auctionLots.roundId, roundId), sql`${auctionLots.status} in ('pending', 'live')`));
  if (stillOpen) return;

  await tx
    .update(auctionRounds)
    .set({ status: "completed", closedAt: new Date() })
    .where(eq(auctionRounds.id, roundId));
  await tx
    .update(events)
    .set({ activeRoundId: null })
    .where(and(eq(events.id, eventId), eq(events.activeRoundId, roundId)));
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
    await assertStaffTx(tx, params.eventId, params.actorParticipantId);

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

    const sequence = (nextSequence?.maxSequence ?? 0) + 1;

    // Rulebook: "At the start of every round after the first, flip one
    // Market Shock card." A card whose effect doesn't concern this round's
    // material still gets revealed (moderator sees it, teams see it) —
    // see market-shock-service.ts's applyMaterialEffect comment for why
    // that's the intended behavior, not a bug.
    const drawnShock = sequence > 1 ? await drawShockCard(tx, params.eventId) : null;

    const [round] = await tx
      .insert(auctionRounds)
      .values({
        eventId: params.eventId,
        materialTypeId: params.materialTypeId,
        sequence,
        status: "active",
        marketShockCardId: drawnShock?.cardId,
        startedAt: new Date(),
      })
      .returning();

    const [settings] = await tx.select().from(eventSettings).where(eq(eventSettings.eventId, params.eventId));
    if (!settings) throw new GameError("not_found", "Event settings not found.");

    let openingBid = params.openingBidOverride ?? material.defaultOpeningBid;
    let perLotOpeningBidOverrides = new Map<number, number>();
    let shockNote: string | null = null;

    if (drawnShock && !params.openingBidOverride) {
      const effect: ShockEffect = JSON.parse(drawnShock.effectJson);
      const materialResult = applyMaterialEffect(effect, material, activeTeams.length);
      openingBid = materialResult.adjustedOpeningBid;
      perLotOpeningBidOverrides = materialResult.perLotOpeningBidOverrides;
      const globalNote = await applyGlobalEffect(tx, params.eventId, effect, params.actorParticipantId);
      shockNote = globalNote ?? materialResult.note;
    }

    const minimumRaise = computeMinimumRaise(openingBid, settings);

    let lotNumber = 1;
    for (const team of activeTeams) {
      const thisLotOpeningBid = perLotOpeningBidOverrides.get(lotNumber) ?? openingBid;
      const [materialLot] = await tx
        .insert(materialLots)
        .values({
          eventId: params.eventId,
          materialTypeId: material.id,
          quantity: material.defaultLotQuantity,
          openingBid: thisLotOpeningBid,
          source: "auction",
          status: "auctioning",
        })
        .returning();

      await tx.insert(auctionLots).values({
        eventId: params.eventId,
        roundId: round.id,
        materialLotId: materialLot.id,
        lotNumber: lotNumber++,
        openingBid: thisLotOpeningBid,
        minimumRaise: computeMinimumRaise(thisLotOpeningBid, settings),
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
      afterJson: { round, materialKey: material.key, lotCount: activeTeams.length, shock: drawnShock },
    });

    queueBroadcast({
      eventId: params.eventId,
      type: "auction.round_started",
      data: {
        roundId: round.id,
        materialKey: material.key,
        materialName: material.name,
        lotCount: activeTeams.length,
        shock: drawnShock ? { title: drawnShock.title, description: drawnShock.description, appliedNote: shockNote } : null,
      },
    });

    return round;
  });
}

export async function openNextLot(params: { eventId: string; roundId: string; actorParticipantId: string }) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStage1(tx, params.eventId);
    await assertStaffTx(tx, params.eventId, params.actorParticipantId);

    const [settings] = await tx.select().from(eventSettings).where(eq(eventSettings.eventId, params.eventId));
    if (!settings) throw new GameError("not_found", "Event settings not found.");

    // Known gap since docs/phase-1.md, never fixed until now: this
    // function used to check "is another lot already live" with a plain
    // SELECT and no lock, so two concurrent open-next-lot calls for the
    // same round (a moderator double-clicking, or two staff accounts
    // acting at once) could both see no live lot and both proceed,
    // opening two lots live at once. Locking the round row first
    // serializes any second concurrent call behind the first's commit,
    // same pattern already used for team/lot rows elsewhere in this file.
    await tx.select().from(auctionRounds).where(eq(auctionRounds.id, params.roundId)).for("update");

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
    await assertTeamLeaderTx(tx, params.eventId, params.teamId, params.actingParticipantId);

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
    // null means the timer sweep closed it, not a person — see
    // closeExpiredLots below. Anyone else must be staff.
    if (params.actorParticipantId !== null) {
      await assertStaffTx(tx, params.eventId, params.actorParticipantId);
    }

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

      await completeRoundIfFinished(tx, params.eventId, lot.roundId);
      return { winnerTeamId: null as string | null };
    }

    const [team] = await tx.select().from(teams).where(eq(teams.id, winningBid.teamId)).for("update");
    if (!team) throw new GameError("not_found", "Winning team not found.");
    if (team.auctionTokens < winningBid.amount || team.status !== "active") {
      // Rulebook contingencies: "A team can't pay its bid: void the bid,
      // re-offer the lot immediately" AND "A team drops out mid-game:
      // remove its unsold materials" — both land here, since a withdrawn/
      // disqualified team's in-flight winning bid must never settle just
      // because it happened to be leading when the lot closed. Re-offer
      // itself is a moderator action (incident-service.ts's reopenLot);
      // this only guarantees the lot never settles to an invalid winner.
      await tx.update(bids).set({ status: "voided" }).where(eq(bids.id, winningBid.id));
      await tx.update(auctionLots).set({ status: "unsold" }).where(eq(auctionLots.id, lot.id));
      await tx.update(materialLots).set({ status: "bank_stock" }).where(eq(materialLots.id, materialLot.id));

      await recordAudit(tx, {
        eventId: params.eventId,
        actorParticipantId: params.actorParticipantId,
        reason:
          team.status !== "active"
            ? `Winning team is no longer active (${team.status}).`
            : "Winning team could not cover its bid at close.",
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

      await completeRoundIfFinished(tx, params.eventId, lot.roundId);
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

    await completeRoundIfFinished(tx, params.eventId, lot.roundId);
    return { winnerTeamId: team.id as string | null };
  });
}

// Section 5.3: "opens_at, closes_at — The authoritative timer." Nothing
// client-side is trusted to decide a lot is over; something server-side
// has to actually notice closesAt has passed and call closeLot. This sweep
// is that "something" — see backend/src/index.ts, which is the one
// long-running process able to poll it on an interval (Section 9 Phase
// 2's "moderator round and lot control" implicitly needs this for lots
// the moderator doesn't manually close in time).
export async function closeExpiredLots(): Promise<{ closedLotIds: string[] }> {
  const expired = await db
    .select({ id: auctionLots.id, eventId: auctionLots.eventId })
    .from(auctionLots)
    .where(and(eq(auctionLots.status, "live"), sql`${auctionLots.closesAt} < now()`));

  const closedLotIds: string[] = [];
  for (const lot of expired) {
    try {
      await closeLot({ eventId: lot.eventId, auctionLotId: lot.id, actorParticipantId: null });
      closedLotIds.push(lot.id);
    } catch (err) {
      // One lot's sweep failing (e.g. it was just closed manually a
      // moment ago and no longer matches) must never stop the others from
      // being checked.
      console.error("closeExpiredLots: failed to close lot", lot.id, err);
    }
  }
  return { closedLotIds };
}
