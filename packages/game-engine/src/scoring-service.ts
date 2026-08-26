import { db, eq, and, sql } from "db";
import {
  events,
  eventSettings,
  teams,
  cities,
  cityPreferences,
  constructedBuildings,
  teamInventoryTransactions,
  scoreSnapshots,
} from "db/schema";
import { GameError } from "./errors";
import { recordAudit } from "./audit";
import { runInTransaction, type Tx } from "./tx";
import { assertStaffTx } from "./team-service";

// Section 6.6 workflow, executed as one atomic transaction rather than
// staged steps, since nothing meaningful happens between "reveal" and
// "compute scores" that a moderator would need to intervene in — see
// docs/phase-4.md for why this collapses the plan's implied multi-step
// sequence into a single command.

interface BuildingTotals {
  buildingPoints: number;
  bonusPoints: number;
  buildingCount: number;
  bestBuildingValue: number;
  preferredBuildingPoints: number; // sum of (base+bonus) for buildings matching the assigned city's preferred types
  otherBuildingPoints: number;
}

async function computeBuildingTotals(
  executor: Tx | typeof db,
  eventId: string,
  teamId: string,
  preferredRecipeIds: Set<string>,
): Promise<BuildingTotals> {
  const rows = await executor
    .select({
      recipeId: constructedBuildings.recipeId,
      basePoints: constructedBuildings.basePoints,
      ecoBonus: constructedBuildings.ecoBonus,
      luxuryBonus: constructedBuildings.luxuryBonus,
      landmarkBonus: constructedBuildings.landmarkBonus,
    })
    .from(constructedBuildings)
    .where(and(eq(constructedBuildings.eventId, eventId), eq(constructedBuildings.teamId, teamId), eq(constructedBuildings.status, "approved")));

  let buildingPoints = 0;
  let bonusPoints = 0;
  let bestBuildingValue = 0;
  let preferredBuildingPoints = 0;
  let otherBuildingPoints = 0;

  for (const row of rows) {
    const bonus = row.ecoBonus + row.luxuryBonus + row.landmarkBonus;
    const total = row.basePoints + bonus;
    buildingPoints += row.basePoints;
    bonusPoints += bonus;
    bestBuildingValue = Math.max(bestBuildingValue, total);
    if (preferredRecipeIds.has(row.recipeId)) preferredBuildingPoints += total;
    else otherBuildingPoints += total;
  }

  return { buildingPoints, bonusPoints, buildingCount: rows.length, bestBuildingValue, preferredBuildingPoints, otherBuildingPoints };
}

async function computeLeftoverPoints(executor: Tx | typeof db, eventId: string, teamId: string, unitsPerPoint: number): Promise<number> {
  const [row] = await executor
    .select({ total: sql<number>`coalesce(sum(${teamInventoryTransactions.quantityDelta}), 0)` })
    .from(teamInventoryTransactions)
    .where(and(eq(teamInventoryTransactions.eventId, eventId), eq(teamInventoryTransactions.teamId, teamId)));
  const total = Math.max(0, Number(row?.total ?? 0));
  return Math.floor(total / unitsPerPoint);
}

// Section 7.7 "Before reveal": pre-multiplier score for a team's own
// Portfolio screen. No city multiplier applied (it isn't known/authorized
// to compute yet before reveal) — just building + bonus + optional
// leftover points, and the team's own city's tier/name without its
// multiplier.
export async function getPreRevealScore(eventId: string, teamId: string) {
  const [settings] = await db.select().from(eventSettings).where(eq(eventSettings.eventId, eventId));
  if (!settings) throw new GameError("not_found", "Event settings not found.");

  const totals = await computeBuildingTotals(db, eventId, teamId, new Set());
  const leftoverPoints = settings.leftoverScoringEnabled
    ? await computeLeftoverPoints(db, eventId, teamId, settings.leftoverUnitsPerPoint)
    : 0;

  const [assignedCity] = await db
    .select({ id: cities.id, name: cities.name, tier: cities.tier })
    .from(cities)
    .where(and(eq(cities.eventId, eventId), eq(cities.assignedTeamId, teamId)));

  return {
    buildingPoints: totals.buildingPoints,
    bonusPoints: totals.bonusPoints,
    leftoverPoints,
    preMultiplierTotal: totals.buildingPoints + totals.bonusPoints + leftoverPoints,
    city: assignedCity ?? null,
  };
}

export async function revealCitiesAndScore(params: { eventId: string; actorParticipantId: string }) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStaffTx(tx, params.eventId, params.actorParticipantId);

    const [event] = await tx.select().from(events).where(eq(events.id, params.eventId));
    if (!event) throw new GameError("not_found", "Event not found.");
    if (event.status !== "stage_3") {
      throw new GameError("invalid_event_stage", "Cities can only be revealed from Stage 3.");
    }

    const allCities = await tx.select().from(cities).where(eq(cities.eventId, params.eventId));
    const activeTeams = await tx.select().from(teams).where(and(eq(teams.eventId, params.eventId), eq(teams.status, "active")));

    const unassignedTeam = activeTeams.find((t) => !allCities.some((c) => c.assignedTeamId === t.id));
    if (unassignedTeam) {
      throw new GameError("conflict", `${unassignedTeam.name} has not won a city yet — every team needs one before reveal.`);
    }

    await tx.update(cities).set({ revealState: "revealed" }).where(eq(cities.eventId, params.eventId));

    const [settings] = await tx.select().from(eventSettings).where(eq(eventSettings.eventId, params.eventId));
    if (!settings) throw new GameError("not_found", "Event settings not found.");

    const cityById = new Map(allCities.map((c) => [c.id, c]));
    const preferencesByCity = new Map<string, Set<string>>();
    if (settings.advancedCityScoringEnabled) {
      const allPreferences = await tx.select().from(cityPreferences);
      for (const pref of allPreferences) {
        if (!preferencesByCity.has(pref.cityId)) preferencesByCity.set(pref.cityId, new Set());
        preferencesByCity.get(pref.cityId)!.add(pref.buildingRecipeId);
      }
    }

    type TeamResult = {
      teamId: string;
      teamName: string;
      buildingPoints: number;
      bonusPoints: number;
      leftoverPoints: number;
      buildingCount: number;
      bestBuildingValue: number;
      cityMultiplier: number;
      finalScore: number;
      remainingTokens: number;
      calculation: Record<string, unknown>;
    };

    const results: TeamResult[] = [];
    for (const team of activeTeams) {
      const assignedCity = allCities.find((c) => c.assignedTeamId === team.id);
      const multiplier = assignedCity ? Number(assignedCity.hiddenMultiplier) : 0;
      const preferredRecipeIds = assignedCity ? preferencesByCity.get(assignedCity.id) ?? new Set<string>() : new Set<string>();

      const totals = await computeBuildingTotals(tx, params.eventId, team.id, preferredRecipeIds);
      const leftoverPoints = settings.leftoverScoringEnabled
        ? await computeLeftoverPoints(tx, params.eventId, team.id, settings.leftoverUnitsPerPoint)
        : 0;

      let finalScore: number;
      let calculation: Record<string, unknown>;
      if (settings.advancedCityScoringEnabled) {
        // "A city's multiplier boosts only the points from the building
        // types it prefers; all other buildings count x1." Leftover
        // points have no building-type home in this mode, so they're
        // added flat, unmultiplied — a deliberate, documented deviation
        // (see docs/phase-4.md).
        finalScore = totals.preferredBuildingPoints * multiplier + totals.otherBuildingPoints * 1 + leftoverPoints;
        calculation = {
          mode: "advanced",
          preferredBuildingPoints: totals.preferredBuildingPoints,
          otherBuildingPoints: totals.otherBuildingPoints,
          leftoverPoints,
          cityMultiplier: multiplier,
          formula: "preferredBuildingPoints * cityMultiplier + otherBuildingPoints * 1 + leftoverPoints",
        };
      } else {
        finalScore = (totals.buildingPoints + totals.bonusPoints + leftoverPoints) * multiplier;
        calculation = {
          mode: "standard",
          buildingPoints: totals.buildingPoints,
          bonusPoints: totals.bonusPoints,
          leftoverPoints,
          cityMultiplier: multiplier,
          formula: "(buildingPoints + bonusPoints + leftoverPoints) * cityMultiplier",
        };
      }

      results.push({
        teamId: team.id,
        teamName: team.name,
        buildingPoints: totals.buildingPoints,
        bonusPoints: totals.bonusPoints,
        leftoverPoints,
        buildingCount: totals.buildingCount,
        bestBuildingValue: totals.bestBuildingValue,
        cityMultiplier: multiplier,
        finalScore,
        remainingTokens: team.auctionTokens + team.cityWalletTokens,
        calculation: { ...calculation, buildingCount: totals.buildingCount, bestBuildingValue: totals.bestBuildingValue, cityName: assignedCity?.name },
      });
    }

    // Section 6.6 tiebreakers, in order: most buildings -> most valuable
    // single building -> most unspent tokens (sealed wallet + leftover).
    const sorted = [...results].sort((a, b) => {
      if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
      if (b.buildingCount !== a.buildingCount) return b.buildingCount - a.buildingCount;
      if (b.bestBuildingValue !== a.bestBuildingValue) return b.bestBuildingValue - a.bestBuildingValue;
      return b.remainingTokens - a.remainingTokens;
    });

    // rank: position by score alone (ties share a rank). tiebreakerRank:
    // the fully resolved unique placement after every tiebreaker above.
    const scoreRank = new Map<number, number>();
    let nextScoreRank = 1;
    for (const r of sorted) {
      if (!scoreRank.has(r.finalScore)) scoreRank.set(r.finalScore, nextScoreRank);
      nextScoreRank++;
    }

    const snapshots = [];
    for (let i = 0; i < sorted.length; i++) {
      const r = sorted[i];
      const [snapshot] = await tx
        .insert(scoreSnapshots)
        .values({
          eventId: params.eventId,
          teamId: r.teamId,
          phase: "final",
          buildingPoints: r.buildingPoints,
          bonusPoints: r.bonusPoints,
          leftoverPoints: r.leftoverPoints,
          cityMultiplier: r.cityMultiplier.toFixed(2),
          finalScore: r.finalScore.toFixed(2),
          rank: scoreRank.get(r.finalScore)!,
          tiebreakerRank: i + 1,
          calculationJson: r.calculation,
        })
        .returning();
      snapshots.push(snapshot);
    }

    await tx.update(events).set({ status: "completed", completedAt: new Date() }).where(eq(events.id, params.eventId));

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actorParticipantId,
      action: "score.revealed",
      entityType: "event",
      entityId: params.eventId,
      afterJson: { standings: sorted.map((r, i) => ({ teamId: r.teamId, teamName: r.teamName, finalScore: r.finalScore, place: i + 1 })) },
    });

    queueBroadcast({
      eventId: params.eventId,
      type: "score.revealed",
      data: sorted.map((r, i) => ({ teamId: r.teamId, teamName: r.teamName, finalScore: r.finalScore, place: i + 1 })),
    });

    return snapshots;
  });
}

export async function getScoreboard(eventId: string) {
  return db
    .select()
    .from(scoreSnapshots)
    .where(and(eq(scoreSnapshots.eventId, eventId), eq(scoreSnapshots.phase, "final")))
    .orderBy(scoreSnapshots.tiebreakerRank);
}
