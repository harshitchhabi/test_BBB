import { NextResponse } from "next/server";
import { addEventStaff } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// POST /events/:id/staff — self-serve moderator bootstrap (Section 7.9
// setup checklist). Anyone can add the first staff member for an event;
// after that, only existing staff can add more — enforced inside
// addEventStaff itself.
export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const { targetEmail, role } = await req.json();
    if (typeof targetEmail !== "string" || (role !== "moderator" && role !== "admin")) {
      return NextResponse.json({ error: "invalid_input", message: 'targetEmail and role ("moderator"|"admin") are required.' }, { status: 400 });
    }
    const staffRow = await addEventStaff({ eventId, requesterParticipantId: participant.id, targetEmail, role });
    return NextResponse.json(staffRow);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
