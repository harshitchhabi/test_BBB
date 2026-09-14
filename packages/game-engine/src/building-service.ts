import { eq, and, sql } from "db";
import {
  events,
  teams,
  materialTypes,
  buildingRecipes,
  recipeRequirements,
  constructedBuildings,
  buildingBonusUses,
  teamInventoryTransactions,
} from "db/schema";
import { GameError } from "./errors";
import { recordAudit } from "./audit";
import { runInTransaction, type Tx } from "./tx";
import { getQuantityForMaterial } from "./inventory-service";
import { assertTeamLeaderOrStaffTx, assertStaffTx } from "./team-service";

// Section 6.5 workflow and rulebook Stage 2 "Building": "hand the
// moderator exactly the materials on its Recipe Card... the materials
// either match the card or they do not." Every consumed unit — base
// recipe and bonus materials alike — is its own negative
// team_inventory_transactions row tagged with this building's id as
// related_entity_id, which is what makes Phase 3's acceptance check
// ("every building's consumed materials can be traced to inventory
// sources") true by construction rather than by convention: querying
// those rows back IS the trace.
//
// The "Eco Incentive" Market Shock's +15-instead-of-+10 override is
// automated via teams.eco_eligible_solar_units (auction-service.ts's
// closeLot credits it whenever a team wins a lot in a round where the
// shock was active for that round's material — see
// auction_rounds.eco_bonus_override) rather than a true per-physical-unit
// trace: it's a capped counter, not a FIFO ledger of which exact Solar
// units are "free-round" ones. Capping it at usage time by the team's
// CURRENT Solar holdings (not just the stored counter) means trading the
// physical Solar away can't be used to bank the credit and cash it in on
// unrelated Solar acquired later — a good-faith approximation of the
// rulebook's intent, not a claim of exact physical-unit provenance.

const BONUS_POINTS = { eco: 10, ecoIncentive: 15, luxury: 5, landmark: 20 } as const;
const LUXURY_ELIGIBLE_RECIPE_KEYS = ["mall", "university", "office"];

export interface BonusRequest {
  eco?: boolean; // consumes 4 Solar
  luxury?: boolean; // consumes 1 extra Marble or Tiles beyond the recipe requirement — caller picks which
  luxuryMaterialKey?: "marble" | "tiles";
  landmark?: boolean; // consumes 1 Blueprint
}

async function assertStage2(tx: Tx, eventId: string) {
  const [event] = await tx.select().from(events).where(eq(events.id, eventId));
  if (!event) throw new GameError("not_found", "Event not found.");
  if (event.status !== "stage_2") {
    throw new GameError("invalid_event_stage", "Construction only happens during Stage 2.");
  }
}

async function nextDeedNumber(tx: Tx, eventId: string): Promise<string> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)` })
    .from(constructedBuildings)
    .where(eq(constructedBuildings.eventId, eventId));
  const sequence = Number(row?.count ?? 0) + 1;
  return `DEED-${sequence.toString().padStart(4, "0")}`;
}

async function findMaterialByKey(tx: Tx, eventId: string, key: string) {
  const [material] = await tx.select().from(materialTypes).where(and(eq(materialTypes.eventId, eventId), eq(materialTypes.key, key)));
  if (!material) throw new GameError("not_found", `Material "${key}" is not configured for this event.`);
  return material;
}

export async function constructBuilding(params: {
  eventId: string;
  teamId: string;
  recipeId: string;
  bonuses?: BonusRequest;
  actorParticipantId: string;
}) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStage2(tx, params.eventId);

    const [team] = await tx.select().from(teams).where(eq(teams.id, params.teamId)).for("update");
    if (!team || team.eventId !== params.eventId) throw new GameError("not_found", "Team not found.");
    // Section 8.1: "Team leader/moderator, according to selected
    // workflow" — the rulebook's real construction desk is the moderator
    // physically checking materials, so either the team leader or event
    // staff may submit this, unlike bids/trades/bank purchases which are
    // leader-only.
    await assertTeamLeaderOrStaffTx(tx, params.eventId, team.id, params.actorParticipantId);

    const [recipe] = await tx.select().from(buildingRecipes).where(eq(buildingRecipes.id, params.recipeId));
    if (!recipe || !recipe.active) throw new GameError("not_found", "Recipe not found or inactive.");

    const requirements = await tx.select().from(recipeRequirements).where(eq(recipeRequirements.recipeId, recipe.id));

    // Recipe check first, entirely — no partial consumption ever begins
    // until every single requirement (and any requested bonus material) is
    // confirmed available. Rulebook: "Construction fails when even one
    // required unit is missing."
    const consumptionPlan: Array<{ materialTypeId: string; quantity: number; note: string }> = [];
    for (const req of requirements) {
      const available = await getQuantityForMaterial(tx, params.eventId, team.id, req.materialTypeId);
      if (available < req.requiredQuantity) {
        throw new GameError("recipe_incomplete", `Missing required materials for ${recipe.name}.`);
      }
      consumptionPlan.push({ materialTypeId: req.materialTypeId, quantity: req.requiredQuantity, note: "recipe" });
    }

    let ecoBonus = 0;
    let luxuryBonus = 0;
    let landmarkBonus = 0;
    const bonusUses: Array<{ bonusType: "eco" | "luxury" | "landmark"; sourceMaterialTypeId: string; points: number }> = [];

    let ecoIncentiveUnitsSpent = 0;

    if (params.bonuses?.eco) {
      const solar = await findMaterialByKey(tx, params.eventId, "solar");
      const available = await getQuantityForMaterial(tx, params.eventId, team.id, solar.id);
      if (available < 4) throw new GameError("recipe_incomplete", "Eco bonus requires 4 Solar panels.");
      consumptionPlan.push({ materialTypeId: solar.id, quantity: 4, note: "eco bonus" });

      // Eco Incentive automation: only as many banked eco-eligible units
      // as the team ACTUALLY still holds count (see the module comment
      // above for why) — if that covers all 4 being consumed, this
      // bonus is the Market Shock's +15 instead of the standard +10.
      const ecoEligible = Math.min(team.ecoEligibleSolarUnits, available);
      if (ecoEligible >= 4) {
        ecoBonus = BONUS_POINTS.ecoIncentive;
        ecoIncentiveUnitsSpent = 4;
      } else {
        ecoBonus = BONUS_POINTS.eco;
      }
      bonusUses.push({ bonusType: "eco", sourceMaterialTypeId: solar.id, points: ecoBonus });
    }

    if (params.bonuses?.luxury) {
      if (!LUXURY_ELIGIBLE_RECIPE_KEYS.includes(recipe.key)) {
        throw new GameError("conflict", "Luxury bonus only applies to Mall, University, or Office.");
      }
      const key = params.bonuses.luxuryMaterialKey ?? "marble";
      const material = await findMaterialByKey(tx, params.eventId, key);
      // +1 beyond whatever the recipe itself already required of this
      // same material (rulebook: "add ONE EXTRA Marble or Tiles lot").
      const alreadyRequiredByRecipe = requirements.find((r) => r.materialTypeId === material.id)?.requiredQuantity ?? 0;
      const available = await getQuantityForMaterial(tx, params.eventId, team.id, material.id);
      if (available < alreadyRequiredByRecipe + 1) {
        throw new GameError("recipe_incomplete", `Luxury bonus requires one extra ${material.name} beyond the recipe.`);
      }
      consumptionPlan.push({ materialTypeId: material.id, quantity: 1, note: "luxury bonus" });
      luxuryBonus = BONUS_POINTS.luxury;
      bonusUses.push({ bonusType: "luxury", sourceMaterialTypeId: material.id, points: luxuryBonus });
    }

    if (params.bonuses?.landmark) {
      const blueprint = await findMaterialByKey(tx, params.eventId, "blueprint");
      const available = await getQuantityForMaterial(tx, params.eventId, team.id, blueprint.id);
      if (available < 1) throw new GameError("recipe_incomplete", "Landmark bonus requires 1 Blueprint.");
      consumptionPlan.push({ materialTypeId: blueprint.id, quantity: 1, note: "landmark bonus" });
      landmarkBonus = BONUS_POINTS.landmark;
      bonusUses.push({ bonusType: "landmark", sourceMaterialTypeId: blueprint.id, points: landmarkBonus });
    }

    if (ecoIncentiveUnitsSpent > 0) {
      await tx
        .update(teams)
        .set({ ecoEligibleSolarUnits: team.ecoEligibleSolarUnits - ecoIncentiveUnitsSpent })
        .where(eq(teams.id, team.id));
    }

    const deedNumber = await nextDeedNumber(tx, params.eventId);
    const [building] = await tx
      .insert(constructedBuildings)
      .values({
        eventId: params.eventId,
        teamId: team.id,
        recipeId: recipe.id,
        deedNumber,
        basePoints: recipe.basePoints,
        ecoBonus,
        luxuryBonus,
        landmarkBonus,
        verifiedBy: params.actorParticipantId,
      })
      .returning();

    // Aggregate the plan by material (a bonus can target the same
    // material the recipe already needed, e.g. Luxury on Marble) into one
    // ledger row per material so the trace back to this building is a
    // single clean number per material, not multiple partial rows.
    const totalsByMaterial = new Map<string, number>();
    for (const item of consumptionPlan) {
      totalsByMaterial.set(item.materialTypeId, (totalsByMaterial.get(item.materialTypeId) ?? 0) + item.quantity);
    }
    await tx.insert(teamInventoryTransactions).values(
      Array.from(totalsByMaterial.entries()).map(([materialTypeId, quantity]) => ({
        eventId: params.eventId,
        teamId: team.id,
        materialTypeId,
        quantityDelta: -quantity,
        reason: "construction" as const,
        relatedEntityType: "constructed_building",
        relatedEntityId: building.id,
        createdBy: params.actorParticipantId,
      })),
    );

    if (bonusUses.length > 0) {
      await tx.insert(buildingBonusUses).values(
        bonusUses.map((b) => ({
          constructedBuildingId: building.id,
          bonusType: b.bonusType,
          sourceMaterialTypeId: b.sourceMaterialTypeId,
          points: b.points,
        })),
      );
    }

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actorParticipantId,
      action: "building.constructed",
      entityType: "constructed_building",
      entityId: building.id,
      afterJson: { building, bonusUses, consumed: Array.from(totalsByMaterial.entries()) },
    });

    queueBroadcast({ eventId: params.eventId, type: "building.constructed", data: building });
    queueBroadcast({ eventId: params.eventId, type: "inventory.changed", data: { teamId: team.id } });

    return building;
  });
}

export async function voidBuilding(params: { eventId: string; buildingId: string; moderatorParticipantId: string; reason?: string }) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStaffTx(tx, params.eventId, params.moderatorParticipantId);
    const [building] = await tx.select().from(constructedBuildings).where(eq(constructedBuildings.id, params.buildingId)).for("update");
    if (!building || building.eventId !== params.eventId) throw new GameError("not_found", "Building not found.");
    if (building.status === "voided") throw new GameError("conflict", "Building is already voided.");

    const [updated] = await tx
      .update(constructedBuildings)
      .set({ status: "voided", voidedAt: new Date(), voidedReason: params.reason })
      .where(eq(constructedBuildings.id, building.id))
      .returning();

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.moderatorParticipantId,
      reason: params.reason,
      isOverride: true,
      action: "building.voided",
      entityType: "constructed_building",
      entityId: building.id,
      beforeJson: building,
      afterJson: updated,
    });

    queueBroadcast({ eventId: params.eventId, type: "building.constructed", data: updated });
    return updated;
  });
}
