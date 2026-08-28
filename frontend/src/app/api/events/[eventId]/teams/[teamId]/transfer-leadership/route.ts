import { NextResponse } from "next/server";
import { transferLeadership, resolveParticipantByEmail } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// POST /events/:id/teams/:teamId/transfer-leadership — the current leader
// (or staff, for recovery) hands off to another existing member,
// identified by email the same way addEventStaff identifies its target.
export async function POST(req: Request, { params }: { params: Promise<{ eventId: string; teamId: string }> }) {
  try {
    const { eventId, teamId } = await params;
    const participant = await requireParticipant();
    const { newLeaderEmail } = await req.json();
    if (typeof newLeaderEmail !== "string") {
      return NextResponse.json({ error: "invalid_input", message: "newLeaderEmail is required." }, { status: 400 });
    }
    const newLeader = await resolveParticipantByEmail(newLeaderEmail);
    const result = await transferLeadership({ eventId, teamId, requesterParticipantId: participant.id, newLeaderParticipantId: newLeader.id });
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
