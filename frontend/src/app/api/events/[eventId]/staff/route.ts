import { NextResponse } from "next/server";
import { createStaffLogin } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// POST /events/:id/staff — Task 1: staff are no longer "an
// already-signed-in participant, added by email." This now mints a
// brand-new login credential and the event_staff row together. Bootstrap
// rule unchanged: the first staff slot can only be claimed by whoever
// created the event (or anyone, if it was seeded without a creator);
// every slot after that requires the requester to already be staff.
export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const { name, username } = await req.json();
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "invalid_input", message: "Name is required." }, { status: 400 });
    }
    if (typeof username !== "string" || username.trim().length === 0) {
      return NextResponse.json({ error: "invalid_input", message: "A username is required." }, { status: 400 });
    }

    const result = await createStaffLogin({ eventId, actorParticipantId: participant.id, name: name.trim(), username });
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
