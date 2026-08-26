import { auditLog } from "db/schema";
import type { Tx } from "./tx";

// Section 4 principle: "Moderator override with reason: emergencies happen;
// every manual override must be recorded with actor, reason, before state,
// and after state." Section 3.1 #5: "Add an audit log."
//
// `reason` is mandatory only when `isOverride` is true — that's the
// "moderator override" case the plan means (voiding a bid, adjusting a
// balance, disqualifying a team, reopening a lot): those must always say
// why. Routine actor-attributed actions (placing a bid, opening a lot,
// creating a team) are still fully audited via actorParticipantId + before/
// after state, but don't force an artificial "reason" string on an
// ordinary action nobody is overriding anything with.
interface AuditEntry {
  eventId: string;
  actorParticipantId: string | null;
  reason?: string;
  isOverride?: boolean;
  action: string;
  entityType: string;
  entityId?: string;
  beforeJson?: unknown;
  afterJson?: unknown;
}

export async function recordAudit(tx: Tx, entry: AuditEntry) {
  if (entry.isOverride && !entry.reason) {
    throw new Error(
      `recordAudit: override action "${entry.action}" is missing a reason. ` +
        `Every moderator override must be logged with why it happened.`,
    );
  }

  await tx.insert(auditLog).values({
    eventId: entry.eventId,
    actorParticipantId: entry.actorParticipantId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    reason: entry.reason ?? null,
    beforeJson: entry.beforeJson ?? null,
    afterJson: entry.afterJson ?? null,
  });
}
