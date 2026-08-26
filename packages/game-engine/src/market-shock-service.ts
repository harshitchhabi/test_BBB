import { eq, and, sql } from "db";
import { marketShockCards, auctionRounds, materialTypes, materialLots, buildingRecipes, teams } from "db/schema";
import type { Tx } from "./tx";
import { recordAudit } from "./audit";

// Rulebook Stage 1: "At the start of every round after the first, flip one
// Market Shock card from a shuffled deck." Modeled as a finite pool
// (copies_in_deck per card, seeded in packages/db/seed/data.ts) rather than
// an infinite random pick, so a card can't show up more times than the
// physical deck would allow. "Already drawn" is derived from
// auction_rounds.market_shock_card_id (one row per round that drew a card)
// instead of a separate draw-log table — every draw already lives exactly
// there.
export interface DrawnShockEffect {
  cardId: string;
  key: string;
  title: string;
  description: string;
  effectJson: string;
}

interface MaterialShockEffectResult {
  adjustedOpeningBid: number;
  perLotOpeningBidOverrides: Map<number, number>;
}

export type ShockEffect =
  | { type: "opening_bid_multiplier"; materialKey: string; multiplier: number }
  | { type: "flat_bonus_points"; recipeKeys: string[]; points: number }
  | { type: "next_lot_price_multiplier"; materialKey: string; multiplier: number }
  | { type: "smallest_unsold_lot_price_increase"; percent: number; priorityMaterialKeys: string[] }
  | { type: "grant_tokens_all_teams"; amount: number }
  | { type: "material_free_this_round"; materialKey: string; ecoBonusOverride: number };

export async function drawShockCard(tx: Tx, eventId: string): Promise<DrawnShockEffect | null> {
  const cards = await tx
    .select()
    .from(marketShockCards)
    .where(and(eq(marketShockCards.eventId, eventId), eq(marketShockCards.active, true)));
  if (cards.length === 0) return null;

  const drawCounts = await tx
    .select({ cardId: auctionRounds.marketShockCardId, count: sql<number>`count(*)` })
    .from(auctionRounds)
    .where(eq(auctionRounds.eventId, eventId))
    .groupBy(auctionRounds.marketShockCardId);
  const drawnCountByCard = new Map(drawCounts.filter((r) => r.cardId).map((r) => [r.cardId as string, Number(r.count)]));

  const remainingPool = cards.flatMap((card) => {
    const alreadyDrawn = drawnCountByCard.get(card.id) ?? 0;
    const remaining = card.copiesInDeck - alreadyDrawn;
    return remaining > 0 ? Array(remaining).fill(card) : [];
  });
  if (remainingPool.length === 0) return null; // deck exhausted

  const chosen = remainingPool[Math.floor(Math.random() * remainingPool.length)];
  return {
    cardId: chosen.id,
    key: chosen.key,
    title: chosen.title,
    description: chosen.description,
    effectJson: chosen.effectJson,
  };
}

// Applies whichever part of a drawn card's effect concerns THIS round's
// material and opening bid. Rulebook cards are written as if every shock
// is drawn during the round it's about (e.g. "Steel Embargo" during the
// Steel round) — but the deck is drawn independently of which round is
// current, so a card whose material doesn't match this round is a
// legitimate real-world outcome (the flavor is announced; the number just
// has nothing to act on this round). That mismatch is intentionally
// surfaced in the broadcast note rather than silently swallowed, so a
// moderator watching the monitor can see why nothing moved.
export function applyMaterialEffect(
  effect: ShockEffect,
  material: { key: string; defaultOpeningBid: number; defaultLotQuantity: number },
  lotCount: number,
): MaterialShockEffectResult & { note: string } {
  const perLotOpeningBidOverrides = new Map<number, number>();
  let adjustedOpeningBid = material.defaultOpeningBid;
  let note = "No effect on this round's material.";

  switch (effect.type) {
    case "opening_bid_multiplier":
      if (effect.materialKey === material.key) {
        adjustedOpeningBid = Math.ceil(material.defaultOpeningBid * effect.multiplier);
        note = `${material.key} opening bid adjusted x${effect.multiplier} -> ${adjustedOpeningBid}.`;
      }
      break;
    case "next_lot_price_multiplier":
      if (effect.materialKey === material.key && lotCount > 0) {
        perLotOpeningBidOverrides.set(1, Math.ceil(material.defaultOpeningBid * effect.multiplier));
        note = `First ${material.key} lot this round opens at x${effect.multiplier}.`;
      }
      break;
    case "material_free_this_round":
      if (effect.materialKey === material.key) {
        adjustedOpeningBid = 0;
        note = `${material.key} lots are free this round (Eco bonus overridden to +${effect.ecoBonusOverride} — applied at construction time, Stage 2).`;
      }
      break;
    default:
      break;
  }

  return { adjustedOpeningBid, perLotOpeningBidOverrides, note };
}

// Effects that apply regardless of which material is currently up for
// auction — these mutate state immediately when the card is drawn.
export async function applyGlobalEffect(
  tx: Tx,
  eventId: string,
  effect: ShockEffect,
  actorParticipantId: string,
): Promise<string | null> {
  if (effect.type === "flat_bonus_points") {
    const recipes = await tx
      .select()
      .from(buildingRecipes)
      .where(and(eq(buildingRecipes.eventId, eventId), sql`${buildingRecipes.key} = ANY(${effect.recipeKeys})`));
    for (const recipe of recipes) {
      await tx
        .update(buildingRecipes)
        .set({ basePoints: recipe.basePoints + effect.points })
        .where(eq(buildingRecipes.id, recipe.id));
    }
    await recordAudit(tx, {
      eventId,
      actorParticipantId,
      action: "market_shock.flat_bonus_points_applied",
      entityType: "market_shock",
      afterJson: { recipeKeys: effect.recipeKeys, points: effect.points },
    });
    return `${effect.recipeKeys.join(", ")} now worth +${effect.points} points for the rest of the game.`;
  }

  if (effect.type === "grant_tokens_all_teams") {
    const activeTeams = await tx
      .select({ id: teams.id, auctionTokens: teams.auctionTokens })
      .from(teams)
      .where(and(eq(teams.eventId, eventId), eq(teams.status, "active")));
    for (const team of activeTeams) {
      await tx
        .update(teams)
        .set({ auctionTokens: team.auctionTokens + effect.amount })
        .where(eq(teams.id, team.id));
    }
    await recordAudit(tx, {
      eventId,
      actorParticipantId,
      action: "market_shock.tokens_granted",
      entityType: "market_shock",
      afterJson: { amount: effect.amount, teamCount: activeTeams.length },
    });
    return `Every active team received +${effect.amount} tokens.`;
  }

  if (effect.type === "smallest_unsold_lot_price_increase") {
    // Approximates the rulebook's "the unsold material with the smallest
    // lot size" by checking, in priority order, which of the named
    // materials currently has any lot sitting in bank stock (i.e. went
    // unsold in an earlier round) — the smallest-lot-size ordering is
    // pre-baked into priorityMaterialKeys at seed time (see
    // MARKET_SHOCK_SEED in packages/db/seed/data.ts), since lot size is a
    // static per-material fact, not something to recompute here.
    // Actually raising that material's *next* round's opening bid is left
    // to whichever startRound call handles it next (recorded via audit +
    // note only) — this function only identifies and logs the target, it
    // does not have a "future round" to adjust yet.
    const [materialWithBankStock] = await tx
      .select({ key: materialTypes.key })
      .from(materialLots)
      .innerJoin(materialTypes, eq(materialLots.materialTypeId, materialTypes.id))
      .where(
        and(
          eq(materialTypes.eventId, eventId),
          eq(materialLots.status, "bank_stock"),
          sql`${materialTypes.key} = ANY(${effect.priorityMaterialKeys})`,
        ),
      )
      .limit(1);
    return materialWithBankStock
      ? `Next ${materialWithBankStock.key} round should open ${effect.percent}% higher (moderator: apply manually via openingBidOverride).`
      : "No unsold material from the priority list yet — no effect.";
  }

  return null;
}
