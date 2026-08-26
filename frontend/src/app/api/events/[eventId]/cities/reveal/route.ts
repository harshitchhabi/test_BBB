import { NextResponse } from "next/server";
import { revealCitiesAndScore } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// POST /events/:id/cities/reveal — the exact endpoint named in Section
// 8.1. Moderator-only, enforced inside revealCitiesAndScore itself.
export async function POST(_req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const snapshots = await revealCitiesAndScore({ eventId, actorParticipantId: participant.id });
    return NextResponse.json({ snapshots });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
