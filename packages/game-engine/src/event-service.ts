import { eq, and } from "db";
import {
  events,
  teams,
  teamMembers,
  materialLots,
  auctionRounds,
  auctionLots,
  teamInventoryTransactions,
  trades,
  bankPurchases,
  constructedBuildings,
  inspections,
  cities,
  scoutReports,
  cityAuctions,
  scoreSnapshots,
  participants,
} from "db/schema";
import { GameError } from "./errors";
import { recordAudit } from "./audit";
import { runInTransaction } from "./tx";
import { assertStaffTx } from "./team-service";
import { generatePassword, hashPassword } from "./auth-service";

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

    // A live lot mid-bid has nowhere to go once the event leaves
    // stage_1: placeBid/closeLot both require stage_1, so an orphaned
    // "live" lot could never close through the normal flow again, and
    // event.activeRoundId would dangle indefinitely (only forceEventStage
    // cleans that up). A "pending" (never opened) lot is fine to leave
    // behind — a moderator may deliberately choose to stop auctioning a
    // material early — but a lot actually accepting bids right now must
    // be closed first. This only guards the normal path; forceEventStage
    // exists precisely for the "just get me out of here" override case.
    if (event.activeRoundId) {
      const [liveLot] = await tx
        .select({ id: auctionLots.id })
        .from(auctionLots)
        .where(and(eq(auctionLots.roundId, event.activeRoundId), eq(auctionLots.status, "live")));
      if (liveLot) {
        throw new GameError("conflict", "Close the currently live auction lot before advancing the event's stage.");
      }
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

// Task 3: setEventStatus only allows the mostly-forward moves in
// VALID_TRANSITIONS above — there's no way to jump an event straight to
// an arbitrary stage (e.g. skip straight to stage_3 because Stage 1/2
// were run on paper for a fast-moving group, or jump backward to redo a
// stage after a real mistake) without going through resetEventForNewRound
// (which wipes everything). This is that override: any real stage,
// always requires a reason, always recorded as an isOverride audit entry
// since bypassing the normal sequence is inherently a deliberate
// exception, not routine flow.
//
// "Sane cleanup of any live round/auction when jumping away from it"
// means: whatever is currently live gets voided, never silently
// abandoned. A live auction lot or city auction has a countdown running
// against it — force-jumping the event's stage out from under it would
// otherwise leave that lot "live" forever with nothing left driving it
// (the timer sweep only closes lots whose *own* stage is still current),
// and its opening/highest bid still holding a team's tokens hostage.
// Voiding it returns those tokens/materials to the state before that lot
// existed, same as reopenLot but without settling anything first, and
// clears the event's activeRoundId/activeCityAuctionId pointers.
const REAL_EVENT_STAGES = ["setup", "lobby", "stage_1", "stage_2", "stage_3", "scoring", "completed", "paused"];

export async function forceEventStage(params: {
  eventId: string;
  status: string;
  actorParticipantId: string;
  reason: string;
}) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStaffTx(tx, params.eventId, params.actorParticipantId);
    if (!params.reason?.trim()) throw new GameError("conflict", "A reason is required to force an event's stage.");
    if (!REAL_EVENT_STAGES.includes(params.status)) {
      throw new GameError("invalid_input", `"${params.status}" is not a real event stage.`);
    }

    const [event] = await tx.select().from(events).where(eq(events.id, params.eventId)).for("update");
    if (!event) throw new GameError("not_found", "Event not found.");
    if (event.status === params.status) throw new GameError("conflict", "The event is already at that stage.");

    let voidedLotId: string | null = null;
    let voidedCityAuctionId: string | null = null;

    if (event.activeRoundId) {
      const [liveLot] = await tx
        .select()
        .from(auctionLots)
        .where(and(eq(auctionLots.roundId, event.activeRoundId), eq(auctionLots.status, "live")))
        .for("update");
      if (liveLot) {
        await tx.update(auctionLots).set({ status: "voided" }).where(eq(auctionLots.id, liveLot.id));
        await tx.update(materialLots).set({ status: "bank_stock" }).where(eq(materialLots.id, liveLot.materialLotId));
        voidedLotId = liveLot.id;
      }
      await tx
        .update(auctionRounds)
        .set({ status: "cancelled" })
        .where(and(eq(auctionRounds.id, event.activeRoundId), eq(auctionRounds.status, "active")));
    }

    if (event.activeCityAuctionId) {
      const [liveCityAuction] = await tx
        .select()
        .from(cityAuctions)
        .where(eq(cityAuctions.id, event.activeCityAuctionId))
        .for("update");
      if (liveCityAuction && liveCityAuction.status === "live") {
        await tx.update(cityAuctions).set({ status: "voided" }).where(eq(cityAuctions.id, liveCityAuction.id));
        voidedCityAuctionId = liveCityAuction.id;
      }
    }

    const updates: Partial<typeof events.$inferInsert> = {
      status: params.status as (typeof events.$inferSelect)["status"],
      activeRoundId: null,
      activeCityAuctionId: null,
    };
    if (params.status === "stage_1" && !event.startedAt) updates.startedAt = new Date();
    if (params.status === "completed" && !event.completedAt) updates.completedAt = new Date();

    const [updated] = await tx.update(events).set(updates).where(eq(events.id, event.id)).returning();

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actorParticipantId,
      reason: params.reason,
      isOverride: true,
      action: "event.stage_forced",
      entityType: "event",
      entityId: event.id,
      beforeJson: { status: event.status, activeRoundId: event.activeRoundId, activeCityAuctionId: event.activeCityAuctionId },
      afterJson: { status: updated.status, voidedLotId, voidedCityAuctionId },
    });

    queueBroadcast({ eventId: params.eventId, type: "event.stage_changed", data: { status: updated.status, forced: true } });

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

    const teamRows = await tx.select({ id: teams.id, ownerParticipantId: teams.ownerParticipantId }).from(teams).where(eq(teams.eventId, params.eventId));
    const teamCount = teamRows.length;

    // Same reasoning as deleteTeam's owner-release (incident-service.ts):
    // without this, every deleted team's username stays taken forever
    // (a global unique constraint), which would block reusing the exact
    // same team names for the very next round this reset is meant to
    // set up. The participants row itself survives - only the login
    // credential is released and the row renamed out of the way.
    for (const team of teamRows) {
      const [owner] = await tx.select().from(participants).where(eq(participants.id, team.ownerParticipantId)).for("update");
      if (!owner) continue;
      const releasedUsername = `released-${owner.username}-${owner.id.slice(0, 8)}`;
      const passwordHash = await hashPassword(generatePassword());
      await tx.update(participants).set({ username: releasedUsername, passwordHash, sessionId: null }).where(eq(participants.id, owner.id));
    }

    // Cities are config (including the hidden multiplier), not runtime
    // state — reset only what a round actually changes. This MUST run
    // before the teams delete below: cities.assigned_team_id is a real FK
    // to teams.id with no cascade, so deleting a team any city still
    // points to fails with a foreign-key violation - a crash discovered
    // live, in production, after a completed round (every completed
    // round leaves every city assigned to a team, so this was not a rare
    // edge case - it broke every reset attempted after Stage 3 ever ran).
    await tx.update(cities).set({ assignedTeamId: null, saleOrder: null, revealState: "hidden" }).where(eq(cities.eventId, params.eventId));

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
