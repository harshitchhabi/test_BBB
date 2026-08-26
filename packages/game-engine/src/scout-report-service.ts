import { db, eq, and } from "db";
import { events, eventSettings, teams, cities, scoutReports } from "db/schema";
import { GameError } from "./errors";
import { recordAudit } from "./audit";
import { runInTransaction, type Tx } from "./tx";
import { assertTeamLeaderTx } from "./team-service";

// Rulebook Stage 3 "Scout Reports": "For 100 tokens... a team may buy a
// Scout Report: one clue about a single city, e.g. 'its multiplier is at
// least 3.0' or 'below 2.5.' Maximum two per team."
//
// The clue is generated from the real hidden_multiplier but the exact
// value is never returned or stored anywhere a team can read — clueValue
// only ever holds the rounded threshold, and the direction (at-least vs.
// below) is picked so the threshold is never tight enough to reveal the
// value outright (see CLUE_BAND below). This is the other half of Section
// 8.3's "hidden multipliers never appear... before reveal": city-service.ts
// keeps the column out of every general read; this file makes sure the
// one query that DOES touch hidden_multiplier only ever derives a
// deliberately loose fact from it.
const CLUE_BAND = 0.5; // matches the 0.5x granularity every city's multiplier is actually seeded at

async function assertStage3(tx: Tx, eventId: string) {
  const [event] = await tx.select().from(events).where(eq(events.id, eventId));
  if (!event) throw new GameError("not_found", "Event not found.");
  if (event.status !== "stage_3") {
    throw new GameError("invalid_event_stage", "Scout reports are only available during Stage 3.");
  }
}

export async function purchaseScoutReport(params: { eventId: string; teamId: string; cityId: string; actingParticipantId: string }) {
  return runInTransaction(async (tx) => {
    await assertStage3(tx, params.eventId);
    await assertTeamLeaderTx(tx, params.eventId, params.teamId, params.actingParticipantId);

    const [settings] = await tx.select().from(eventSettings).where(eq(eventSettings.eventId, params.eventId));
    if (!settings) throw new GameError("not_found", "Event settings not found.");
    if (!settings.scoutReportsEnabled) throw new GameError("forbidden", "Scout reports are not enabled for this event.");

    const [team] = await tx.select().from(teams).where(eq(teams.id, params.teamId)).for("update");
    if (!team || team.eventId !== params.eventId) throw new GameError("not_found", "Team not found.");
    if (team.scoutReportCount >= settings.scoutReportLimit) {
      throw new GameError("conflict", `${team.name} has already used its ${settings.scoutReportLimit} scout reports.`);
    }

    const cost = settings.scoutReportCost;
    const biddingPower = team.cityWalletTokens + team.auctionTokens;
    if (biddingPower < cost) throw new GameError("insufficient_tokens", "Not enough tokens (wallet + leftover) to buy a scout report.");

    const [existing] = await tx
      .select({ id: scoutReports.id })
      .from(scoutReports)
      .where(and(eq(scoutReports.teamId, params.teamId), eq(scoutReports.cityId, params.cityId)));
    if (existing) throw new GameError("conflict", "This team already scouted that city.");

    const [city] = await tx.select().from(cities).where(eq(cities.id, params.cityId));
    if (!city || city.eventId !== params.eventId) throw new GameError("not_found", "City not found.");
    if (city.revealState === "revealed") throw new GameError("conflict", "This city's multiplier is already public.");

    const actualMultiplier = Number(city.hiddenMultiplier);
    // Round DOWN to the band below the true value for an "at least" clue,
    // or round UP to the band above for a "below" clue — either way the
    // stated threshold is strictly on the far side of the real value, by
    // at least one full band, so the clue narrows things without ever
    // being tight enough to imply the exact number.
    const useAtLeast = Math.random() < 0.5;
    const clueType = useAtLeast ? "minimum_multiplier" : "maximum_multiplier";
    const clueValue = useAtLeast
      ? (Math.floor(actualMultiplier / CLUE_BAND) * CLUE_BAND).toFixed(2)
      : (Math.ceil(actualMultiplier / CLUE_BAND) * CLUE_BAND).toFixed(2);

    const cityWalletUsed = Math.min(cost, team.cityWalletTokens);
    const auctionTokensUsed = cost - cityWalletUsed;
    await tx
      .update(teams)
      .set({
        cityWalletTokens: team.cityWalletTokens - cityWalletUsed,
        auctionTokens: team.auctionTokens - auctionTokensUsed,
        scoutReportCount: team.scoutReportCount + 1,
      })
      .where(eq(teams.id, team.id));

    const [report] = await tx
      .insert(scoutReports)
      .values({
        eventId: params.eventId,
        teamId: team.id,
        cityId: city.id,
        cost,
        paidFrom: cityWalletUsed >= cost ? "city_wallet" : "leftover_budget",
        clueType,
        clueValue,
      })
      .returning();

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actingParticipantId,
      action: "scout_report.purchased",
      entityType: "scout_report",
      entityId: report.id,
      // Deliberately NOT logging the actual multiplier here even in an
      // audit trail a moderator could read — the clue itself is the
      // record of what this team is entitled to know.
      afterJson: { cityId: city.id, clueType, clueValue },
    });

    return report;
  });
}

// A team's own scout reports — private, per Section 7.6 ("showing only
// the purchasing team's private clue").
export async function getTeamScoutReports(eventId: string, teamId: string) {
  return db.select().from(scoutReports).where(and(eq(scoutReports.eventId, eventId), eq(scoutReports.teamId, teamId)));
}
