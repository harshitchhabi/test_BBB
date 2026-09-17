import { eq, sql } from "db";
import { events, eventSettings, teams, trades, tradeLines, teamInventoryTransactions } from "db/schema";
import { GameError } from "./errors";
import { recordAudit } from "./audit";
import { runInTransaction, type Tx } from "./tx";
import { getQuantityForMaterial } from "./inventory-service";
import { assertTeamLeaderTx, assertStaffTx, isTeamLeaderTx } from "./team-service";

// Section 6.4 workflow and rulebook Stage 2 "Trading": swaps are free,
// capped at 4 completed trades per team, and only a moderator-registered
// trade ("pink slip") is binding. The flow is: a team leader proposes ->
// the COUNTERPARTY's leader must accept before a moderator can do
// anything with it -> a moderator registers the accepted trade (this is
// the point it becomes a "pink slip") -> a moderator completes it (atomic
// ledger movement for both sides) -> or either side declines/a moderator
// rejects/cancels it at any point before completion.
//
// The counterparty-accept step exists because a trade moves real
// inventory for both teams — without it, a moderator alone could
// register and complete a trade the counterparty never actually agreed
// to, which is a real loophole for a "friendly" moderator to exploit or
// simply a mistake to make under time pressure with many trades in
// flight at once.

export interface TradeLineInput {
  // NULL only ever valid on an open offer (no counterparty yet) - means
  // "whoever accepts this offer provides this line." Resolved to the
  // accepting team's id the moment someone accepts (see acceptTrade).
  fromTeamId: string | null;
  // NULL means this line trades TOKENS instead of a material - leftover
  // Stage 1 tokens are spendable in Stage 2 the same way a material is,
  // so a trade can move credits for materials, materials for credits,
  // or credits for credits, one line at a time. `quantity` is then the
  // token amount.
  materialTypeId: string | null;
  quantity: number;
}

async function assertStage2(tx: Tx, eventId: string) {
  const [event] = await tx.select().from(events).where(eq(events.id, eventId));
  if (!event) throw new GameError("not_found", "Event not found.");
  if (event.status !== "stage_2") {
    throw new GameError("invalid_event_stage", "Trading is only open during Stage 2.");
  }
}

// counterpartyTeamId is null for an open offer (not yet accepted by
// anyone) - every line must then be either the proposer's own id (what
// they're giving) or null (what they want back, to be filled in with
// whoever accepts). Once a counterparty is known (a normal two-party
// trade proposed directly, or an open offer after acceptTrade fills the
// null lines in), every line must be fully specified as one of the two
// real teams - no line is ever allowed to reference some THIRD team.
function assertLinesBelongToTrade(lines: TradeLineInput[], proposerTeamId: string, counterpartyTeamId: string | null) {
  if (lines.length === 0) throw new GameError("conflict", "A trade needs at least one line.");
  for (const line of lines) {
    const valid = counterpartyTeamId
      ? line.fromTeamId === proposerTeamId || line.fromTeamId === counterpartyTeamId
      : line.fromTeamId === proposerTeamId || line.fromTeamId === null;
    if (!valid) {
      throw new GameError(
        "conflict",
        counterpartyTeamId
          ? "Every trade line must come from one of the two teams in the trade."
          : "On an open offer, every line must either be from the proposing team, or left unassigned for whoever accepts to provide.",
      );
    }
    if (line.quantity <= 0) throw new GameError("conflict", "Trade line quantities must be positive.");
  }
}

export async function proposeTrade(params: {
  eventId: string;
  proposerTeamId: string;
  // Omit/null to post an OPEN OFFER instead of a direct two-party
  // proposal - not aimed at any specific team, sitting out there for any
  // other team's leader to accept (first to accept wins).
  counterpartyTeamId?: string | null;
  proposerParticipantId: string;
  lines: TradeLineInput[];
}) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStage2(tx, params.eventId);
    await assertTeamLeaderTx(tx, params.eventId, params.proposerTeamId, params.proposerParticipantId);
    const counterpartyTeamId = params.counterpartyTeamId ?? null;
    if (counterpartyTeamId === params.proposerTeamId) {
      throw new GameError("conflict", "A team cannot trade with itself.");
    }
    assertLinesBelongToTrade(params.lines, params.proposerTeamId, counterpartyTeamId);

    const [nextNumber] = await tx
      .select({ n: sql<number>`coalesce(max(${trades.tradeNumber}), 0)` })
      .from(trades)
      .where(eq(trades.eventId, params.eventId));

    const [trade] = await tx
      .insert(trades)
      .values({
        eventId: params.eventId,
        proposerTeamId: params.proposerTeamId,
        counterpartyTeamId,
        status: "submitted",
        binding: false,
        tradeNumber: (nextNumber?.n ?? 0) + 1,
      })
      .returning();

    await tx.insert(tradeLines).values(
      params.lines.map((line) => ({
        tradeId: trade.id,
        fromTeamId: line.fromTeamId,
        materialTypeId: line.materialTypeId,
        quantity: line.quantity,
      })),
    );

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.proposerParticipantId,
      action: "trade.proposed",
      entityType: "trade",
      entityId: trade.id,
      afterJson: { trade, lines: params.lines },
    });

    // A real, live gap: every OTHER trade transition (accept, decline,
    // register, complete, cancel, reject) broadcasts trade.changed, but
    // proposeTrade - the very first step, creating the trade at all -
    // never did. The moderator's Trade Desk and every other team's
    // screen only ever refresh on a broadcast (or their own next
    // unrelated action), so a brand new proposal was invisible to
    // everyone but the two teams involved until somebody happened to
    // reload the page.
    queueBroadcast({ eventId: params.eventId, type: "trade.changed", data: trade });
    return trade;
  });
}

async function loadTradeForUpdate(tx: Tx, eventId: string, tradeId: string) {
  const [trade] = await tx.select().from(trades).where(eq(trades.id, tradeId)).for("update");
  if (!trade || trade.eventId !== eventId) throw new GameError("not_found", "Trade not found.");
  return trade;
}

// The counterparty's leader agreeing to the exact terms proposed. Only
// they can do this — not the proposer, not staff — since this is the
// step that stands in for the other team's real-world consent.
//
// For an OPEN OFFER (trade.counterpartyTeamId still null), there is no
// fixed "the counterparty" yet - acceptingTeamId says which team is
// claiming it, first-come-first-served. The row lock on `trade` above
// (loadTradeForUpdate) is what makes "first" well-defined: two teams
// accepting the same open offer at the same instant serialize on that
// lock, and the loser's status check below reads the WINNER's already-
// committed "accepted" status and cleanly rejects instead of double-
// accepting the same offer.
export async function acceptTrade(params: { eventId: string; tradeId: string; acceptingParticipantId: string; acceptingTeamId?: string }) {
  return runInTransaction(async (tx, queueBroadcast) => {
    const trade = await loadTradeForUpdate(tx, params.eventId, params.tradeId);
    if (trade.status !== "submitted") throw new GameError("conflict", "This trade is no longer waiting for a response.");

    let counterpartyTeamId = trade.counterpartyTeamId;
    if (counterpartyTeamId) {
      await assertTeamLeaderTx(tx, params.eventId, counterpartyTeamId, params.acceptingParticipantId);
    } else {
      if (!params.acceptingTeamId) throw new GameError("invalid_input", "acceptingTeamId is required to accept an open offer.");
      if (params.acceptingTeamId === trade.proposerTeamId) throw new GameError("conflict", "You cannot accept your own open offer.");
      await assertTeamLeaderTx(tx, params.eventId, params.acceptingTeamId, params.acceptingParticipantId);
      counterpartyTeamId = params.acceptingTeamId;
      // Fill in every line that was left unassigned ("whoever accepts
      // provides this") with the team that just claimed the offer -
      // from here on this is a fully-specified two-party trade like any
      // other, same as if it had been proposed directly to this team.
      await tx.update(tradeLines).set({ fromTeamId: counterpartyTeamId }).where(sql`${tradeLines.tradeId} = ${trade.id} and ${tradeLines.fromTeamId} is null`);
    }

    const [updated] = await tx.update(trades).set({ status: "accepted", counterpartyTeamId }).where(eq(trades.id, trade.id)).returning();

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.acceptingParticipantId,
      action: "trade.accepted",
      entityType: "trade",
      entityId: trade.id,
      afterJson: updated,
    });

    queueBroadcast({ eventId: params.eventId, type: "trade.changed", data: updated });
    return updated;
  });
}

// Either side can decline a trade that's still just a proposal — the
// proposer withdrawing their own offer, or the counterparty turning it
// down. Once accepted, only a moderator's reject/cancel can undo it,
// since by then both teams have already committed to the terms.
export async function declineTrade(params: { eventId: string; tradeId: string; decliningParticipantId: string }) {
  return runInTransaction(async (tx, queueBroadcast) => {
    const trade = await loadTradeForUpdate(tx, params.eventId, params.tradeId);
    if (trade.status !== "submitted") throw new GameError("conflict", "This trade is no longer waiting for a response.");

    const isProposer = await isTeamLeaderTx(tx, params.eventId, trade.proposerTeamId, params.decliningParticipantId);
    // An open offer (counterpartyTeamId still null) has no counterparty
    // to decline yet - only the proposer can withdraw it.
    const isCounterparty = trade.counterpartyTeamId
      ? await isTeamLeaderTx(tx, params.eventId, trade.counterpartyTeamId, params.decliningParticipantId)
      : false;
    if (!isProposer && !isCounterparty) {
      throw new GameError("forbidden", "Only one of the two teams in this trade can decline it.");
    }

    const [updated] = await tx.update(trades).set({ status: "rejected" }).where(eq(trades.id, trade.id)).returning();

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.decliningParticipantId,
      action: "trade.declined",
      entityType: "trade",
      entityId: trade.id,
      afterJson: updated,
    });

    queueBroadcast({ eventId: params.eventId, type: "trade.changed", data: updated });
    return updated;
  });
}

export async function registerTrade(params: { eventId: string; tradeId: string; moderatorParticipantId: string }) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStaffTx(tx, params.eventId, params.moderatorParticipantId);
    const trade = await loadTradeForUpdate(tx, params.eventId, params.tradeId);
    if (trade.status !== "accepted") {
      throw new GameError(
        "conflict",
        trade.status === "submitted"
          ? "The counterparty hasn't accepted this trade yet — it can't be registered until they do."
          : "Only an accepted trade can be registered.",
      );
    }

    const [updated] = await tx
      .update(trades)
      .set({ status: "registered", binding: true, moderatorId: params.moderatorParticipantId, registeredAt: new Date() })
      .where(eq(trades.id, trade.id))
      .returning();

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.moderatorParticipantId,
      action: "trade.registered",
      entityType: "trade",
      entityId: trade.id,
      afterJson: updated,
    });

    queueBroadcast({ eventId: params.eventId, type: "trade.changed", data: updated });
    return updated;
  });
}

export async function rejectTrade(params: { eventId: string; tradeId: string; moderatorParticipantId: string; reason?: string }) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStaffTx(tx, params.eventId, params.moderatorParticipantId);
    const trade = await loadTradeForUpdate(tx, params.eventId, params.tradeId);
    if (trade.status === "completed") throw new GameError("conflict", "A completed trade cannot be rejected.");

    const [updated] = await tx.update(trades).set({ status: "rejected" }).where(eq(trades.id, trade.id)).returning();

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.moderatorParticipantId,
      reason: params.reason,
      isOverride: true,
      action: "trade.rejected",
      entityType: "trade",
      entityId: trade.id,
      afterJson: updated,
    });

    queueBroadcast({ eventId: params.eventId, type: "trade.changed", data: updated });
    return updated;
  });
}

export async function completeTrade(params: { eventId: string; tradeId: string; moderatorParticipantId: string }) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStaffTx(tx, params.eventId, params.moderatorParticipantId);
    const trade = await loadTradeForUpdate(tx, params.eventId, params.tradeId);
    if (trade.status !== "registered") {
      throw new GameError("conflict", "Only a registered (pink slip) trade can be completed.");
    }

    const lines = await tx.select().from(tradeLines).where(eq(tradeLines.tradeId, trade.id));

    // Lock both teams, in a stable order (by id) regardless of which is
    // proposer/counterparty, so completing two different trades that
    // happen to share a team never deadlocks on lock-acquisition order.
    // By "registered" (this function only runs on a registered trade),
    // acceptTrade has already resolved counterpartyTeamId and every
    // line's fromTeamId from an open offer's initial nulls - neither can
    // still be null here.
    const proposerTeamId = trade.proposerTeamId as string;
    const counterpartyTeamId = trade.counterpartyTeamId as string;
    const teamIds = [proposerTeamId, counterpartyTeamId].sort();
    const [teamA] = await tx.select().from(teams).where(eq(teams.id, teamIds[0])).for("update");
    const [teamB] = await tx.select().from(teams).where(eq(teams.id, teamIds[1])).for("update");
    const teamById = new Map([teamA, teamB].map((t) => [t.id, t]));

    for (const teamId of [proposerTeamId, counterpartyTeamId]) {
      const team = teamById.get(teamId);
      if (!team || team.status !== "active") throw new GameError("forbidden", "Both teams must be active to trade.");
    }

    const [settings] = await tx.select().from(eventSettings).where(eq(eventSettings.eventId, params.eventId));
    if (!settings) throw new GameError("not_found", "Event settings not found.");

    for (const teamId of [proposerTeamId, counterpartyTeamId]) {
      const team = teamById.get(teamId)!;
      if (team.tradeCount >= settings.tradeLimit) {
        throw new GameError("trade_limit_reached", `${team.name} has already used its ${settings.tradeLimit} trades.`);
      }
    }

    // Token lines (materialTypeId null) move tokens instead of a
    // material - tracked as a running per-team delta here so multiple
    // token lines in one trade (or a token line alongside material
    // lines) net out correctly before either team's balance is checked
    // or written, rather than reading/writing auctionTokens once per
    // line and risking an intermediate line seeing a stale balance.
    const tokenDeltaByTeam = new Map<string, number>([
      [proposerTeamId, 0],
      [counterpartyTeamId, 0],
    ]);

    for (const line of lines) {
      const fromTeamId = line.fromTeamId as string;
      if (line.materialTypeId === null) {
        tokenDeltaByTeam.set(fromTeamId, (tokenDeltaByTeam.get(fromTeamId) ?? 0) - line.quantity);
        const toTeamId = fromTeamId === proposerTeamId ? counterpartyTeamId : proposerTeamId;
        tokenDeltaByTeam.set(toTeamId, (tokenDeltaByTeam.get(toTeamId) ?? 0) + line.quantity);
        continue;
      }
      const available = await getQuantityForMaterial(tx, params.eventId, fromTeamId, line.materialTypeId);
      if (available < line.quantity) {
        const team = teamById.get(fromTeamId)!;
        throw new GameError("conflict", `${team.name} does not have enough of that material to complete this trade.`);
      }
    }

    for (const teamId of [proposerTeamId, counterpartyTeamId]) {
      const delta = tokenDeltaByTeam.get(teamId) ?? 0;
      if (delta < 0 && teamById.get(teamId)!.auctionTokens + delta < 0) {
        throw new GameError("conflict", `${teamById.get(teamId)!.name} does not have enough tokens to complete this trade.`);
      }
    }

    for (const line of lines) {
      if (line.materialTypeId === null) continue; // handled via tokenDeltaByTeam below
      const fromTeamId = line.fromTeamId as string;
      const toTeamId = fromTeamId === proposerTeamId ? counterpartyTeamId : proposerTeamId;
      await tx.insert(teamInventoryTransactions).values([
        {
          eventId: params.eventId,
          teamId: fromTeamId,
          materialTypeId: line.materialTypeId,
          quantityDelta: -line.quantity,
          reason: "trade_out",
          relatedEntityType: "trade",
          relatedEntityId: trade.id,
          createdBy: params.moderatorParticipantId,
        },
        {
          eventId: params.eventId,
          teamId: toTeamId,
          materialTypeId: line.materialTypeId,
          quantityDelta: line.quantity,
          reason: "trade_in",
          relatedEntityType: "trade",
          relatedEntityId: trade.id,
          createdBy: params.moderatorParticipantId,
        },
      ]);
    }

    for (const teamId of [proposerTeamId, counterpartyTeamId]) {
      const team = teamById.get(teamId)!;
      const tokenDelta = tokenDeltaByTeam.get(teamId) ?? 0;
      await tx.update(teams).set({ tradeCount: team.tradeCount + 1, auctionTokens: team.auctionTokens + tokenDelta }).where(eq(teams.id, teamId));
    }

    const [updated] = await tx
      .update(trades)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(trades.id, trade.id))
      .returning();

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.moderatorParticipantId,
      action: "trade.completed",
      entityType: "trade",
      entityId: trade.id,
      afterJson: { trade: updated, lines },
    });

    queueBroadcast({ eventId: params.eventId, type: "trade.changed", data: updated });
    for (const teamId of [trade.proposerTeamId, trade.counterpartyTeamId]) {
      queueBroadcast({ eventId: params.eventId, type: "inventory.changed", data: { teamId } });
    }

    return updated;
  });
}

export async function cancelTrade(params: { eventId: string; tradeId: string; actorParticipantId: string; reason?: string }) {
  return runInTransaction(async (tx, queueBroadcast) => {
    // Section 7.9 lists cancel alongside register/approve/reject/complete
    // as a moderator control.
    await assertStaffTx(tx, params.eventId, params.actorParticipantId);
    const trade = await loadTradeForUpdate(tx, params.eventId, params.tradeId);
    if (trade.status === "completed") throw new GameError("conflict", "A completed trade cannot be cancelled.");

    const [updated] = await tx.update(trades).set({ status: "cancelled" }).where(eq(trades.id, trade.id)).returning();

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actorParticipantId,
      reason: params.reason,
      isOverride: true,
      action: "trade.cancelled",
      entityType: "trade",
      entityId: trade.id,
      afterJson: updated,
    });

    queueBroadcast({ eventId: params.eventId, type: "trade.changed", data: updated });
    return updated;
  });
}
