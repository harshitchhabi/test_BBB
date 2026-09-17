import { db, eq, and, sql } from "db";
import { events, eventSettings, teams, materialTypes, materialLots, bankPurchases, teamInventoryTransactions } from "db/schema";
import { GameError } from "./errors";
import { recordAudit } from "./audit";
import { runInTransaction, type Tx } from "./tx";
import { assertTeamLeaderTx } from "./team-service";

// Rulebook Stage 2 "Trading": "Buying from the bank draws only from unsold
// lots (the bank is finite, never an infinite supply). It costs a 10% tax,
// rising to 20% on the three rare materials... Bank purchases do not count
// against your 4 trades." The finite pool is exactly the material_lots
// left in `bank_stock` status from Stage 1 (unsold lots, or a failed
// inspection's voided materials returned to the bank — Phase 3's
// inspection-service). Purchasing a quantity smaller than a whole leftover
// lot partially consumes it (decrementing material_lots.quantity) rather
// than requiring a team to buy in whole-lot increments.
async function assertStage2(tx: Tx, eventId: string) {
  const [event] = await tx.select().from(events).where(eq(events.id, eventId));
  if (!event) throw new GameError("not_found", "Event not found.");
  if (event.status !== "stage_2") {
    throw new GameError("invalid_event_stage", "Bank purchases are only open during Stage 2.");
  }
}

export async function getBankStock(eventId: string) {
  return db
    .select({
      materialTypeId: materialTypes.id,
      materialKey: materialTypes.key,
      materialName: materialTypes.name,
      isRare: materialTypes.isRare,
      // Not "bank stock" in the Stage 2 sense - these two ride along here
      // because this is already the cheapest endpoint with every
      // material's {id, name} (see moderator/auction/page.tsx's "START A
      // ROUND" material picker) - the moderator needs to see the
      // material's configured defaults before deciding whether to
      // override them via startRound's openingBidOverride/
      // lotQuantityOverride.
      defaultLotQuantity: materialTypes.defaultLotQuantity,
      defaultOpeningBid: materialTypes.defaultOpeningBid,
      // Lets the Inventory screen's "buy from bank" form preview the
      // exact cost (base price + tax) before submitting, using the same
      // formula purchaseFromBank charges below - the server still
      // computes and enforces the real total, this is just so a team
      // isn't buying blind.
      stickerPrice: materialTypes.stickerPrice,
      availableQuantity: sql<number>`coalesce(sum(${materialLots.quantity}), 0)`,
    })
    .from(materialTypes)
    .leftJoin(
      materialLots,
      and(eq(materialLots.materialTypeId, materialTypes.id), eq(materialLots.status, "bank_stock")),
    )
    .where(eq(materialTypes.eventId, eventId))
    .groupBy(materialTypes.id, materialTypes.key, materialTypes.name, materialTypes.isRare, materialTypes.defaultLotQuantity, materialTypes.defaultOpeningBid, materialTypes.stickerPrice);
}

export async function purchaseFromBank(params: {
  eventId: string;
  teamId: string;
  materialTypeId: string;
  quantity: number;
  actingParticipantId: string; // team leader
}) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStage2(tx, params.eventId);
    if (params.quantity <= 0) throw new GameError("conflict", "Quantity must be positive.");

    const [team] = await tx.select().from(teams).where(eq(teams.id, params.teamId)).for("update");
    if (!team || team.eventId !== params.eventId) throw new GameError("not_found", "Team not found.");
    await assertTeamLeaderTx(tx, params.eventId, team.id, params.actingParticipantId);

    const [material] = await tx.select().from(materialTypes).where(eq(materialTypes.id, params.materialTypeId));
    if (!material) throw new GameError("not_found", "Material type not found.");

    const [settings] = await tx.select().from(eventSettings).where(eq(eventSettings.eventId, params.eventId));
    if (!settings) throw new GameError("not_found", "Event settings not found.");

    // Lock every bank_stock lot for this material — oldest first — so two
    // teams buying the same scarce leftover material concurrently can't
    // both "see" the same units as available.
    const availableLots = await tx
      .select()
      .from(materialLots)
      .where(and(eq(materialLots.materialTypeId, material.id), eq(materialLots.status, "bank_stock")))
      .orderBy(materialLots.id)
      .for("update");

    const totalAvailable = availableLots.reduce((sum, lot) => sum + lot.quantity, 0);
    if (totalAvailable < params.quantity) {
      throw new GameError("conflict", `Only ${totalAvailable} ${material.name} left in the bank.`);
    }

    const taxRatePercent = material.isRare ? settings.rareBankTaxPercent : settings.normalBankTaxPercent;
    const basePrice = material.stickerPrice * params.quantity;
    const taxAmount = Math.ceil((basePrice * taxRatePercent) / 100);
    const totalCost = basePrice + taxAmount;

    if (team.auctionTokens < totalCost) {
      throw new GameError("insufficient_tokens", `This purchase costs ${totalCost} tokens; the team only has ${team.auctionTokens}.`);
    }

    let remaining = params.quantity;
    for (const lot of availableLots) {
      if (remaining <= 0) break;
      const consumed = Math.min(remaining, lot.quantity);
      remaining -= consumed;
      const newQuantity = lot.quantity - consumed;
      await tx
        .update(materialLots)
        .set({ quantity: newQuantity, status: newQuantity === 0 ? "consumed" : "bank_stock" })
        .where(eq(materialLots.id, lot.id));
    }

    await tx.update(teams).set({ auctionTokens: team.auctionTokens - totalCost }).where(eq(teams.id, team.id));

    const [purchase] = await tx
      .insert(bankPurchases)
      .values({
        eventId: params.eventId,
        teamId: team.id,
        materialLotId: availableLots[0].id, // representative reference; the full split is in the ledger below
        quantity: params.quantity,
        basePrice,
        taxRatePercent,
        taxAmount,
        totalCost,
        paidFrom: "auction_tokens",
        approvedBy: params.actingParticipantId,
        status: "completed",
      })
      .returning();

    await tx.insert(teamInventoryTransactions).values({
      eventId: params.eventId,
      teamId: team.id,
      materialTypeId: material.id,
      quantityDelta: params.quantity,
      reason: "bank_purchase",
      relatedEntityType: "bank_purchase",
      relatedEntityId: purchase.id,
      createdBy: params.actingParticipantId,
    });

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actingParticipantId,
      action: "bank_purchase.completed",
      entityType: "bank_purchase",
      entityId: purchase.id,
      afterJson: purchase,
    });

    queueBroadcast({ eventId: params.eventId, type: "inventory.changed", data: { teamId: team.id } });

    return purchase;
  });
}
