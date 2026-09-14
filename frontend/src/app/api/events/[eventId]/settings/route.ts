import { NextResponse } from "next/server";
import { updateEventSettings } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// PATCH /events/:id/settings — staff-only. Lets an admin actually change
// the numbers/toggles the Rules page (frontend's rules/page.tsx) reads
// out of event_settings, plus a free-text note - there was previously no
// way to do this outside a direct database edit. updateEventSettings
// itself validates every field; this route is a thin pass-through of
// whatever body fields the client sent.
export async function PATCH(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const updates = await req.json();
    const result = await updateEventSettings({ eventId, actorParticipantId: participant.id, updates });
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
