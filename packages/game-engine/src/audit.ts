import { auditLog } from "db/schema";
import type { Tx } from "./tx";

// Section 4 principle: "Moderator override with reason: emergencies happen;
// every manual override must be recorded with actor, reason, before state,
// and after state." Section 3.1 #5: "Add an audit log."
//
// Every override still gets a reason recorded — that requirement isn't
// dropped — but a moderator is no longer FORCED to type one before the
// action goes through: leaving it blank records a clear placeholder
// ("No reason given") instead of blocking the button. The audit log
// still says who did what and when either way; the free-text "why" is a
// courtesy for later review, not a gate on doing the thing. This was
// previously a hard throw here, which is what made the "reset"/"remove"
// buttons on several moderator screens stay disabled until a reason was
// typed into a native browser prompt.
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

const DEFAULT_OVERRIDE_REASON = "No reason given";

export async function recordAudit(tx: Tx, entry: AuditEntry) {
  const reason = entry.isOverride ? (entry.reason?.trim() || DEFAULT_OVERRIDE_REASON) : (entry.reason ?? null);

  await tx.insert(auditLog).values({
    eventId: entry.eventId,
    actorParticipantId: entry.actorParticipantId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    reason,
    beforeJson: entry.beforeJson ?? null,
    afterJson: entry.afterJson ?? null,
  });
}
