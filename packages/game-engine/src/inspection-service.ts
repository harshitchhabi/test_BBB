import { eq, and } from "db";
import { events, eventSettings, teams, constructedBuildings, inspections, teamInventoryTransactions, materialLots } from "db/schema";
import { GameError } from "./errors";
import { recordAudit } from "./audit";
import { runInTransaction, type Tx } from "./tx";
import { assertTeamLeaderTx, assertStaffTx } from "./team-service";

// Rulebook Stage 2 "Inspections (optional)": "A team may pay 150 tokens
// to have the moderator re-check one rival's building. If the rival cannot
// show every required material, that building is voided (0 points) and
// its materials go to the bank. If the rival passes, the challenger
// forfeits the 150 tokens... One inspection per team." The 150-token cost
// is charged up front regardless of outcome — that's what "forfeits"
// means when the rival passes. "Materials go to the bank," not back to
// the rival team, so a failed inspection does not credit the target
// team's inventory; it recreates the exact consumed quantities (read back
// from the construction's own team_inventory_transactions rows, tagged by
// related_entity_id when building-service.ts consumed them) as fresh
// bank_stock material_lots.

async function assertStage2(tx: Tx, eventId: string) {
  const [event] = await tx.select().from(events).where(eq(events.id, eventId));
  if (!event) throw new GameError("not_found", "Event not found.");
  if (event.status !== "stage_2") throw new GameError("invalid_event_stage", "Inspections only happen during Stage 2.");
}

export async function requestInspection(params: {
  eventId: string;
  challengerTeamId: string;
  targetBuildingId: string;
  actingParticipantId: string;
}) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStage2(tx, params.eventId);

    const [settings] = await tx.select().from(eventSettings).where(eq(eventSettings.eventId, params.eventId));
    if (!settings) throw new GameError("not_found", "Event settings not found.");
    if (!settings.inspectionsEnabled) throw new GameError("forbidden", "Inspections are not enabled for this event.");

    const [challenger] = await tx.select().from(teams).where(eq(teams.id, params.challengerTeamId)).for("update");
    if (!challenger || challenger.eventId !== params.eventId) throw new GameError("not_found", "Challenger team not found.");
    await assertTeamLeaderTx(tx, params.eventId, challenger.id, params.actingParticipantId);
    if (challenger.inspectionCount >= settings.inspectionLimitPerTeam) {
      throw new GameError("conflict", `${challenger.name} has already used its inspection.`);
    }
    if (challenger.auctionTokens < settings.inspectionCost) {
      throw new GameError("insufficient_tokens", "Not enough tokens to request an inspection.");
    }

    const [target] = await tx.select().from(constructedBuildings).where(eq(constructedBuildings.id, params.targetBuildingId));
    if (!target || target.eventId !== params.eventId) throw new GameError("not_found", "Target building not found.");
    if (target.status === "voided") throw new GameError("conflict", "That building is already voided.");
    if (target.teamId === params.challengerTeamId) throw new GameError("conflict", "You cannot inspect your own building.");

    // Cost is charged the moment the inspection is requested — "the
    // challenger forfeits the 150 tokens" on a pass, so there is no
    // refund path; it's simplest and most correct to just never credit it
    // back rather than debit-then-maybe-refund.
    await tx.update(teams).set({ auctionTokens: challenger.auctionTokens - settings.inspectionCost, inspectionCount: challenger.inspectionCount + 1 }).where(eq(teams.id, challenger.id));

    const [inspection] = await tx
      .insert(inspections)
      .values({
        eventId: params.eventId,
        challengerTeamId: challenger.id,
        targetBuildingId: target.id,
        cost: settings.inspectionCost,
        paidFrom: "auction_tokens",
        result: "cancelled", // pending moderator resolution
      })
      .returning();

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actingParticipantId,
      action: "inspection.requested",
      entityType: "inspection",
      entityId: inspection.id,
      afterJson: inspection,
    });

    queueBroadcast({ eventId: params.eventId, type: "inspection.resolved", data: { ...inspection, result: "pending" } });
    return inspection;
  });
}

export async function resolveInspection(params: {
  eventId: string;
  inspectionId: string;
  result: "passed" | "failed";
  moderatorParticipantId: string;
}) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStaffTx(tx, params.eventId, params.moderatorParticipantId);
    const [inspection] = await tx.select().from(inspections).where(eq(inspections.id, params.inspectionId)).for("update");
    if (!inspection || inspection.eventId !== params.eventId) throw new GameError("not_found", "Inspection not found.");
    if (inspection.result !== "cancelled") throw new GameError("conflict", "Inspection already resolved.");

    const [building] = await tx.select().from(constructedBuildings).where(eq(constructedBuildings.id, inspection.targetBuildingId)).for("update");
    if (!building) throw new GameError("not_found", "Target building not found.");

    if (params.result === "failed") {
      // Read back exactly what this building consumed at construction —
      // this is the trace the acceptance check depends on.
      const consumedRows = await tx
        .select()
        .from(teamInventoryTransactions)
        .where(
          and(
            eq(teamInventoryTransactions.relatedEntityType, "constructed_building"),
            eq(teamInventoryTransactions.relatedEntityId, building.id),
            eq(teamInventoryTransactions.reason, "construction"),
          ),
        );

      await tx
        .update(constructedBuildings)
        .set({ status: "voided", voidedAt: new Date(), voidedReason: "Failed inspection." })
        .where(eq(constructedBuildings.id, building.id));

      for (const row of consumedRows) {
        await tx.insert(materialLots).values({
          eventId: params.eventId,
          materialTypeId: row.materialTypeId,
          quantity: Math.abs(row.quantityDelta),
          openingBid: 0, // returned via a voided building, not sold at auction — nothing to re-bid
          source: "manual",
          status: "bank_stock",
        });
      }
    }

    const [updated] = await tx
      .update(inspections)
      .set({ result: params.result, resolvedBy: params.moderatorParticipantId, resolvedAt: new Date() })
      .where(eq(inspections.id, inspection.id))
      .returning();

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.moderatorParticipantId,
      reason: `Inspection ${params.result}.`,
      isOverride: true,
      action: "inspection.resolved",
      entityType: "inspection",
      entityId: inspection.id,
      afterJson: updated,
    });

    queueBroadcast({ eventId: params.eventId, type: "inspection.resolved", data: updated });
    if (params.result === "failed") {
      queueBroadcast({ eventId: params.eventId, type: "building.constructed", data: { id: building.id, status: "voided" } });
    }

    return updated;
  });
}
