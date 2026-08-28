import { NextResponse } from "next/server";
import { leaveTeam } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// POST /events/:id/teams/leave — always acts on the caller's own
// membership; there's no "leave someone else's team" concept, so this
// takes no body at all.
export async function POST(_req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const result = await leaveTeam({ eventId, participantId: participant.id });
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
