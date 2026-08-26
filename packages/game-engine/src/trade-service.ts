import { eq, sql } from "db";
import { events, eventSettings, teams, trades, tradeLines, teamInventoryTransactions } from "db/schema";
import { GameError } from "./errors";
import { recordAudit } from "./audit";
import { runInTransaction, type Tx } from "./tx";
import { getQuantityForMaterial } from "./inventory-service";
import { assertTeamLeaderTx, assertStaffTx } from "./team-service";

// Section 6.4 workflow and rulebook Stage 2 "Trading": swaps are free,
// capped at 4 completed trades per team, and only a moderator-registered
// trade ("pink slip") is binding — a handshake deal is a real-world
// agreement the portal deliberately never represents as system state,
// since nothing here would be there to enforce it anyway. So the flow
// modeled is: a team leader proposes -> a moderator registers (this is the
// point it becomes a "pink slip") -> a moderator completes it (atomic
// ledger movement for both sides) -> or a moderator rejects/cancels it at
// any point before completion.

export interface TradeLineInput {
  fromTeamId: string;
  materialTypeId: string;
  quantity: number;
}

async function assertStage2(tx: Tx, eventId: string) {
  const [event] = await tx.select().from(events).where(eq(events.id, eventId));
  if (!event) throw new GameError("not_found", "Event not found.");
  if (event.status !== "stage_2") {
    throw new GameError("invalid_event_stage", "Trading is only open during Stage 2.");
  }
}

function assertLinesBelongToTrade(lines: TradeLineInput[], proposerTeamId: string, counterpartyTeamId: string) {
  if (lines.length === 0) throw new GameError("conflict", "A trade needs at least one line.");
  for (const line of lines) {
    if (line.fromTeamId !== proposerTeamId && line.fromTeamId !== counterpartyTeamId) {
      throw new GameError("conflict", "Every trade line must come from one of the two teams in the trade.");
    }
    if (line.quantity <= 0) throw new GameError("conflict", "Trade line quantities must be positive.");
  }
}

export async function proposeTrade(params: {
  eventId: string;
  proposerTeamId: string;
  counterpartyTeamId: string;
  proposerParticipantId: string;
  lines: TradeLineInput[];
}) {
  return runInTransaction(async (tx) => {
    await assertStage2(tx, params.eventId);
    await assertTeamLeaderTx(tx, params.eventId, params.proposerTeamId, params.proposerParticipantId);
    if (params.proposerTeamId === params.counterpartyTeamId) {
      throw new GameError("conflict", "A team cannot trade with itself.");
    }
    assertLinesBelongToTrade(params.lines, params.proposerTeamId, params.counterpartyTeamId);

    const [nextNumber] = await tx
      .select({ n: sql<number>`coalesce(max(${trades.tradeNumber}), 0)` })
      .from(trades)
      .where(eq(trades.eventId, params.eventId));

    const [trade] = await tx
      .insert(trades)
      .values({
        eventId: params.eventId,
        proposerTeamId: params.proposerTeamId,
        counterpartyTeamId: params.counterpartyTeamId,
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

    return trade;
  });
}

async function loadTradeForUpdate(tx: Tx, eventId: string, tradeId: string) {
  const [trade] = await tx.select().from(trades).where(eq(trades.id, tradeId)).for("update");
  if (!trade || trade.eventId !== eventId) throw new GameError("not_found", "Trade not found.");
  return trade;
}

export async function registerTrade(params: { eventId: string; tradeId: string; moderatorParticipantId: string }) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStaffTx(tx, params.eventId, params.moderatorParticipantId);
    const trade = await loadTradeForUpdate(tx, params.eventId, params.tradeId);
    if (trade.status !== "submitted") throw new GameError("conflict", "Only a submitted trade can be registered.");

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

export async function rejectTrade(params: { eventId: string; tradeId: string; moderatorParticipantId: string; reason: string }) {
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
    const teamIds = [trade.proposerTeamId, trade.counterpartyTeamId].sort();
    const [teamA] = await tx.select().from(teams).where(eq(teams.id, teamIds[0])).for("update");
    const [teamB] = await tx.select().from(teams).where(eq(teams.id, teamIds[1])).for("update");
    const teamById = new Map([teamA, teamB].map((t) => [t.id, t]));

    for (const teamId of [trade.proposerTeamId, trade.counterpartyTeamId]) {
      const team = teamById.get(teamId);
      if (!team || team.status !== "active") throw new GameError("forbidden", "Both teams must be active to trade.");
    }

    const [settings] = await tx.select().from(eventSettings).where(eq(eventSettings.eventId, params.eventId));
    if (!settings) throw new GameError("not_found", "Event settings not found.");

    for (const teamId of [trade.proposerTeamId, trade.counterpartyTeamId]) {
      const team = teamById.get(teamId)!;
      if (team.tradeCount >= settings.tradeLimit) {
        throw new GameError("trade_limit_reached", `${team.name} has already used its ${settings.tradeLimit} trades.`);
      }
    }

    for (const line of lines) {
      const available = await getQuantityForMaterial(tx, params.eventId, line.fromTeamId, line.materialTypeId);
      if (available < line.quantity) {
        const team = teamById.get(line.fromTeamId)!;
        throw new GameError("conflict", `${team.name} does not have enough of that material to complete this trade.`);
      }
    }

    for (const line of lines) {
      const toTeamId = line.fromTeamId === trade.proposerTeamId ? trade.counterpartyTeamId : trade.proposerTeamId;
      await tx.insert(teamInventoryTransactions).values([
        {
          eventId: params.eventId,
          teamId: line.fromTeamId,
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

    for (const teamId of [trade.proposerTeamId, trade.counterpartyTeamId]) {
      const team = teamById.get(teamId)!;
      await tx.update(teams).set({ tradeCount: team.tradeCount + 1 }).where(eq(teams.id, teamId));
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

export async function cancelTrade(params: { eventId: string; tradeId: string; actorParticipantId: string; reason: string }) {
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
