import { eq } from "db";
import { events } from "db/schema";
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
