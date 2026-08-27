import { NextResponse } from "next/server";
import { getParticipantContext } from "game-engine";
import { isStaff } from "common";
import { db, eq, desc } from "db";
import { auditLog, participants } from "db/schema";
import { requireParticipant, apiErrorResponse } from "@/lib/api";
import { toCsv } from "@/lib/csv";

// GET /events/:id/exports/audit-log — Section 7.9 "Exports: ... audit
// log." Every mutation this whole system makes is in here with actor,
// action, reason, and before/after state — the moderator's dispute
// record.
export async function GET(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const ctx = await getParticipantContext(eventId, participant.id);
    if (!isStaff(ctx)) {
      return NextResponse.json({ error: "forbidden", message: "Moderators only." }, { status: 403 });
    }

    const rows = await db
      .select({
        createdAt: auditLog.createdAt,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        reason: auditLog.reason,
        actorName: participants.name,
        beforeJson: auditLog.beforeJson,
        afterJson: auditLog.afterJson,
      })
      .from(auditLog)
      .leftJoin(participants, eq(auditLog.actorParticipantId, participants.id))
      .where(eq(auditLog.eventId, eventId))
      .orderBy(desc(auditLog.createdAt));

    if (new URL(req.url).searchParams.get("format") === "json") {
      return NextResponse.json({ auditLog: rows });
    }

    const csvRows = rows.map((r) => ({
      timestamp: r.createdAt?.toISOString(),
      actor: r.actorName ?? "system",
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      reason: r.reason,
      before: r.beforeJson ? JSON.stringify(r.beforeJson) : "",
      after: r.afterJson ? JSON.stringify(r.afterJson) : "",
    }));

    return new NextResponse(toCsv(csvRows), {
      headers: { "content-type": "text/csv", "content-disposition": `attachment; filename="audit-log-${eventId}.csv"` },
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
