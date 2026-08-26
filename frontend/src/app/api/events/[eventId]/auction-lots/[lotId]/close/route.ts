import { NextResponse } from "next/server";
import { closeLot, getParticipantContext, GameError } from "game-engine";
import { isStaff } from "common";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// POST /events/:id/auction-lots/:id/close — Section 8.1, moderator only.
// Phase 5 (timer expiry) will call closeLot directly from a server-side
// scheduler with actorParticipantId: null instead of going through this
// route — this endpoint is only the moderator's manual "close now" button.
export async function POST(req: Request, { params }: { params: Promise<{ eventId: string; lotId: string }> }) {
  try {
    const { eventId, lotId } = await params;
    const participant = await requireParticipant();
    const ctx = await getParticipantContext(eventId, participant.id);
    if (!isStaff(ctx)) {
      throw new GameError("forbidden", "Only event moderators can close a lot.");
    }

    const { reason } = await req.json().catch(() => ({ reason: undefined }));
    const result = await closeLot({ eventId, auctionLotId: lotId, actorParticipantId: participant.id, reason });
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
