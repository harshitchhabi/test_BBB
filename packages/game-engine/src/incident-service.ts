import { eq, and } from "db";
import { eventSettings, teams, cities, auctionLots, bids, materialLots, teamInventoryTransactions } from "db/schema";
import { GameError } from "./errors";
import { recordAudit } from "./audit";
import { runInTransaction, type Tx } from "./tx";
import { assertStaffTx } from "./team-service";

// Section 7.9 "Incidents" (Team withdrawal, balance adjustment, dispute
// note, manual correction) and the CONTINGENCIES chapter's "Bidding and
// payment problems" / "If the number of teams changes" sections. Every
// function here is a moderator override by definition — all four require
// a reason and are logged with isOverride: true, matching Section 4's
// "moderator override with reason: before state, and after state."

// ---------------------------------------------------------------------
// Team status: withdrawal / disqualification / reactivation
// ---------------------------------------------------------------------

// Rulebook: "A team drops out mid-game: remove its unsold materials and
// any city it holds; final standings are taken among the remaining
// teams." "Remove its unsold materials" is handled by simply excluding
// non-active teams from scoring (scoring-service.ts already filters
// teams.status = 'active') rather than deleting inventory rows — the
// ledger stays a complete, honest history of what actually happened,
// it just stops counting toward anything once the team is inactive.
// Any city already assigned to the team IS explicitly released here
// (unlike inventory, an assigned city is a scarce single resource other
// teams may still need to win).
export async function setTeamStatus(params: {
  eventId: string;
  teamId: string;
  status: "active" | "withdrawn" | "disqualified";
  actorParticipantId: string;
  reason: string;
}) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStaffTx(tx, params.eventId, params.actorParticipantId);

    const [team] = await tx.select().from(teams).where(eq(teams.id, params.teamId)).for("update");
    if (!team || team.eventId !== params.eventId) throw new GameError("not_found", "Team not found.");
    if (team.status === params.status) throw new GameError("conflict", `Team is already ${params.status}.`);

    const [updated] = await tx.update(teams).set({ status: params.status }).where(eq(teams.id, team.id)).returning();

    let releasedCityId: string | null = null;
    if (params.status !== "active") {
      const [heldCity] = await tx.select().from(cities).where(and(eq(cities.eventId, params.eventId), eq(cities.assignedTeamId, team.id))).for("update");
      if (heldCity) {
        await tx.update(cities).set({ assignedTeamId: null, saleOrder: null }).where(eq(cities.id, heldCity.id));
        releasedCityId = heldCity.id;
      }
    }

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actorParticipantId,
      reason: params.reason,
      isOverride: true,
      action: "team.status_changed",
      entityType: "team",
      entityId: team.id,
      beforeJson: { status: team.status },
      afterJson: { status: updated.status, releasedCityId },
    });

    queueBroadcast({ eventId: params.eventId, type: "moderator.announcement", data: { teamId: team.id, status: updated.status, reason: params.reason } });

    return { team: updated, releasedCityId };
  });
}

// ---------------------------------------------------------------------
// Manual balance adjustment
// ---------------------------------------------------------------------

export async function adjustTeamTokens(params: {
  eventId: string;
  teamId: string;
  auctionTokensDelta?: number;
  cityWalletTokensDelta?: number;
  actorParticipantId: string;
  reason: string;
}) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStaffTx(tx, params.eventId, params.actorParticipantId);

    const [team] = await tx.select().from(teams).where(eq(teams.id, params.teamId)).for("update");
    if (!team || team.eventId !== params.eventId) throw new GameError("not_found", "Team not found.");

    const auctionDelta = params.auctionTokensDelta ?? 0;
    const cityWalletDelta = params.cityWalletTokensDelta ?? 0;
    const newAuctionTokens = team.auctionTokens + auctionDelta;
    const newCityWalletTokens = team.cityWalletTokens + cityWalletDelta;
    if (newAuctionTokens < 0 || newCityWalletTokens < 0) {
      throw new GameError("conflict", "This adjustment would take a balance negative.");
    }

    const [updated] = await tx
      .update(teams)
      .set({ auctionTokens: newAuctionTokens, cityWalletTokens: newCityWalletTokens })
      .where(eq(teams.id, team.id))
      .returning();

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actorParticipantId,
      reason: params.reason,
      isOverride: true,
      action: "team.balance_adjusted",
      entityType: "team",
      entityId: team.id,
      beforeJson: { auctionTokens: team.auctionTokens, cityWalletTokens: team.cityWalletTokens },
      afterJson: { auctionTokens: updated.auctionTokens, cityWalletTokens: updated.cityWalletTokens },
    });

    queueBroadcast({ eventId: params.eventId, type: "moderator.announcement", data: { teamId: team.id, reason: params.reason } });
    return updated;
  });
}

// ---------------------------------------------------------------------
// Void / reopen an auction lot
// ---------------------------------------------------------------------

// A dispute or cheating discovery on a bid that hasn't settled yet (lot
// still "live"): void just that bid, leave the lot open for the remaining
// valid bids. Does NOT try to auto-promote a previously-outbid bid back
// to "winning" — per the rulebook, "the moderator's call is final," and
// silently resurrecting an old bid is a bigger judgment call than this
// function should make on its own; the moderator re-solicits bids or
// reopens the lot instead.
export async function voidBid(params: { eventId: string; bidId: string; actorParticipantId: string; reason: string }) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStaffTx(tx, params.eventId, params.actorParticipantId);

    const [bid] = await tx.select().from(bids).where(eq(bids.id, params.bidId)).for("update");
    if (!bid) throw new GameError("not_found", "Bid not found.");
    if (bid.status === "voided") throw new GameError("conflict", "Bid is already voided.");

    const [updated] = await tx.update(bids).set({ status: "voided" }).where(eq(bids.id, bid.id)).returning();

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actorParticipantId,
      reason: params.reason,
      isOverride: true,
      action: "bid.voided",
      entityType: "bid",
      entityId: bid.id,
      beforeJson: bid,
      afterJson: updated,
    });

    queueBroadcast({ eventId: params.eventId, type: "auction.bid_accepted", data: { auctionLotId: bid.auctionLotId, voided: true } });
    return updated;
  });
}

// Reopens a lot that already closed (sold, unsold, or previously voided)
// for a fresh round of bidding — rulebook: "void the bid, re-offer the lot
// immediately." If the lot had actually sold, every effect of that sale is
// reversed first: the winner's tokens are refunded, the inventory credit
// is reversed via an equal-and-opposite ledger entry (never edited/deleted
// — the original grant and its reversal both stay in the ledger, honest
// and traceable), and the material lot goes back up for auction.
export async function reopenLot(params: { eventId: string; auctionLotId: string; actorParticipantId: string; reason: string }) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStaffTx(tx, params.eventId, params.actorParticipantId);

    const [lot] = await tx.select().from(auctionLots).where(eq(auctionLots.id, params.auctionLotId)).for("update");
    if (!lot || lot.eventId !== params.eventId) throw new GameError("not_found", "Auction lot not found.");
    if (lot.status !== "closed" && lot.status !== "unsold" && lot.status !== "voided") {
      throw new GameError("conflict", "Only a closed, unsold, or voided lot can be reopened.");
    }

    const [otherLive] = await tx
      .select({ id: auctionLots.id })
      .from(auctionLots)
      .where(and(eq(auctionLots.roundId, lot.roundId), eq(auctionLots.status, "live")));
    if (otherLive) throw new GameError("conflict", "Close the currently live lot before reopening another one.");

    const [materialLot] = await tx.select().from(materialLots).where(eq(materialLots.id, lot.materialLotId)).for("update");
    if (!materialLot) throw new GameError("not_found", "Material lot not found.");

    if (lot.status === "closed" && lot.winningBidId) {
      const [winningBid] = await tx.select().from(bids).where(eq(bids.id, lot.winningBidId));
      if (winningBid) {
        const [winnerTeam] = await tx.select().from(teams).where(eq(teams.id, winningBid.teamId)).for("update");
        if (winnerTeam) {
          await tx.update(teams).set({ auctionTokens: winnerTeam.auctionTokens + winningBid.amount }).where(eq(teams.id, winnerTeam.id));
        }
        await tx.update(bids).set({ status: "voided" }).where(eq(bids.id, winningBid.id));

        const [originalCredit] = await tx
          .select()
          .from(teamInventoryTransactions)
          .where(and(eq(teamInventoryTransactions.relatedEntityType, "auction_lot"), eq(teamInventoryTransactions.relatedEntityId, lot.id), eq(teamInventoryTransactions.reason, "auction_win")));
        if (originalCredit) {
          await tx.insert(teamInventoryTransactions).values({
            eventId: params.eventId,
            teamId: originalCredit.teamId,
            materialTypeId: originalCredit.materialTypeId,
            quantityDelta: -originalCredit.quantityDelta,
            reason: "manual_adjustment",
            relatedEntityType: "auction_lot",
            relatedEntityId: lot.id,
            createdBy: params.actorParticipantId,
          });
        }
      }
    }

    const [settings] = await tx.select().from(eventSettings).where(eq(eventSettings.eventId, params.eventId));
    const durationSeconds = settings?.auctionLotDurationSeconds ?? 60;

    const opensAt = new Date();
    const closesAt = new Date(opensAt.getTime() + durationSeconds * 1000);

    await tx.update(materialLots).set({ status: "auctioning", ownerTeamId: null }).where(eq(materialLots.id, materialLot.id));
    const [reopened] = await tx
      .update(auctionLots)
      .set({ status: "live", opensAt, closesAt, winningBidId: null, winnerTeamId: null })
      .where(eq(auctionLots.id, lot.id))
      .returning();

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actorParticipantId,
      reason: params.reason,
      isOverride: true,
      action: "auction_lot.reopened",
      entityType: "auction_lot",
      entityId: lot.id,
      beforeJson: lot,
      afterJson: reopened,
    });

    queueBroadcast({ eventId: params.eventId, type: "auction.lot_opened", data: reopened });
    return reopened;
  });
}
