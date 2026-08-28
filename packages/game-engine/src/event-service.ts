import { eq } from "db";
import {
  events,
  teams,
  teamMembers,
  materialLots,
  auctionRounds,
  teamInventoryTransactions,
  trades,
  bankPurchases,
  constructedBuildings,
  inspections,
  cities,
  scoutReports,
  cityAuctions,
  scoreSnapshots,
} from "db/schema";
import { GameError } from "./errors";
import { recordAudit } from "./audit";
import { runInTransaction } from "./tx";
import { assertStaffTx } from "./team-service";

// This was a real gap, not a deliberate omission: nothing anywhere in
// Phases 1-5 ever wrote to `events.status` except revealCitiesAndScore
// (which sets it to "completed" at the very end). Every stage-gated
// action — startRound requires "stage_1", proposeTrade/purchaseFromBank/
// constructBuilding/requestInspection require "stage_2", the whole city
// auction requires "stage_3" — would have failed forever with
// invalid_event_stage, because nothing ever moved the event out of its
// default "setup" status. This is the missing moderator control that
// actually advances the event through the sequence the rulebook and
// Section 5.2's event_status enum both assume exists:
// setup -> lobby -> stage_1 -> stage_2 -> stage_3 -> (scoring ->) completed.
// `paused` is available for an incident that needs everything to stop
// without losing the current stage.
const VALID_TRANSITIONS: Record<string, string[]> = {
  setup: ["lobby", "paused"],
  lobby: ["stage_1", "paused"],
  stage_1: ["stage_2", "paused"],
  stage_2: ["stage_3", "paused"],
  stage_3: ["scoring", "completed", "paused"], // revealCitiesAndScore jumps straight to completed
  scoring: ["completed", "paused"],
  paused: ["setup", "lobby", "stage_1", "stage_2", "stage_3", "scoring"], // resume back to wherever it was
  completed: [],
};

export async function setEventStatus(params: {
  eventId: string;
  status: string;
  actorParticipantId: string;
  reason?: string;
}) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStaffTx(tx, params.eventId, params.actorParticipantId);

    const [event] = await tx.select().from(events).where(eq(events.id, params.eventId)).for("update");
    if (!event) throw new GameError("not_found", "Event not found.");

    const allowedNext = VALID_TRANSITIONS[event.status] ?? [];
    if (!allowedNext.includes(params.status)) {
      throw new GameError(
        "invalid_event_stage",
        `Cannot move from "${event.status}" to "${params.status}". Valid next stages: ${allowedNext.join(", ") || "none"}.`,
      );
    }

    const isOverride = event.status === "paused" || params.status === "paused";
    if (isOverride && !params.reason) {
      throw new GameError("conflict", "A reason is required to pause or resume an event.");
    }

    const updates: Partial<typeof events.$inferInsert> = { status: params.status as (typeof events.$inferSelect)["status"] };
    if (params.status === "stage_1" && !event.startedAt) {
      updates.startedAt = new Date();
    }
    if (params.status === "completed" && !event.completedAt) {
      updates.completedAt = new Date();
    }

    const [updated] = await tx.update(events).set(updates).where(eq(events.id, event.id)).returning();

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actorParticipantId,
      reason: params.reason,
      isOverride,
      action: "event.stage_changed",
      entityType: "event",
      entityId: event.id,
      beforeJson: { status: event.status },
      afterJson: { status: updated.status },
    });

    queueBroadcast({ eventId: params.eventId, type: "event.stage_changed", data: { status: updated.status } });

    return updated;
  });
}

// Running the same event multiple times (a new set of ~20-30 teams each
// round) needs a real "reset" — re-running packages/db/seed/run.ts would
// create a brand-new event with a brand-new id/link, which is exactly
// what you don't want when the same link/QR code needs to keep working
// round after round. This wipes every runtime row (teams, tokens, bids,
// rounds/lots, trades, buildings, inspections, scout reports, city
// auctions/assignments, score snapshots) for THIS event id, while leaving
// its configuration completely untouched: event_settings, material_types,
// building_recipes/recipe_requirements, market_shock_cards, and the
// cities themselves (only their per-round assignment/reveal state resets,
// the cities and their hidden multipliers are not re-shuffled). The
// audit log is deliberately NOT wiped — a reset is itself an audited
// override, and the trail of everything that happened in the previous
// round is worth keeping across resets, not losing with everything else.
//
// Deletes run in the order Postgres' foreign keys require: children
// before the parents they reference. Most of this cascades automatically
// once `teams` is deleted (team_members, team_inventory_transactions),
// but the tables that reference teams.id WITHOUT an ON DELETE CASCADE
// (bids, constructed_buildings, trades, bank_purchases, inspections,
// scout_reports, city_auctions/city_bids, score_snapshots) have to be
// cleared explicitly first, or the final `DELETE FROM teams` would fail
// outright.
export async function resetEventForNewRound(params: { eventId: string; actorParticipantId: string; reason: string }) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStaffTx(tx, params.eventId, params.actorParticipantId);
    if (!params.reason) throw new GameError("conflict", "A reason is required to reset an event.");

    const [event] = await tx.select().from(events).where(eq(events.id, params.eventId)).for("update");
    if (!event) throw new GameError("not_found", "Event not found.");

    const teamRows = await tx.select({ id: teams.id }).from(teams).where(eq(teams.eventId, params.eventId));
    const teamCount = teamRows.length;

    // Children of constructed_buildings / city_auctions / trades that
    // aren't scoped by event_id themselves — deleted via their parent's
    // eventId-scoped delete below, which cascades (building_bonus_uses,
    // city_bids, trade_lines all have ON DELETE CASCADE to their parent).
    await tx.delete(inspections).where(eq(inspections.eventId, params.eventId));
    await tx.delete(constructedBuildings).where(eq(constructedBuildings.eventId, params.eventId));
    await tx.delete(cityAuctions).where(eq(cityAuctions.eventId, params.eventId));
    await tx.delete(trades).where(eq(trades.eventId, params.eventId));
    await tx.delete(bankPurchases).where(eq(bankPurchases.eventId, params.eventId));
    await tx.delete(scoutReports).where(eq(scoutReports.eventId, params.eventId));
    await tx.delete(scoreSnapshots).where(eq(scoreSnapshots.eventId, params.eventId));
    await tx.delete(auctionRounds).where(eq(auctionRounds.eventId, params.eventId)); // cascades auction_lots -> bids
    await tx.delete(materialLots).where(eq(materialLots.eventId, params.eventId));
    await tx.delete(teamInventoryTransactions).where(eq(teamInventoryTransactions.eventId, params.eventId));
    await tx.delete(teamMembers).where(eq(teamMembers.eventId, params.eventId));
    await tx.delete(teams).where(eq(teams.eventId, params.eventId));

    // Cities are config (including the hidden multiplier), not runtime
    // state — reset only what a round actually changes.
    await tx.update(cities).set({ assignedTeamId: null, saleOrder: null, revealState: "hidden" }).where(eq(cities.eventId, params.eventId));

    const [resetEvent] = await tx
      .update(events)
      .set({ status: "setup", activeRoundId: null, activeCityAuctionId: null, startedAt: null, completedAt: null })
      .where(eq(events.id, params.eventId))
      .returning();

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actorParticipantId,
      reason: params.reason,
      isOverride: true,
      action: "event.reset_for_new_round",
      entityType: "event",
      entityId: params.eventId,
      beforeJson: { status: event.status, teamCount },
      afterJson: { status: resetEvent.status },
    });

    queueBroadcast({ eventId: params.eventId, type: "event.stage_changed", data: { status: resetEvent.status, reset: true } });

    return resetEvent;
  });
}
