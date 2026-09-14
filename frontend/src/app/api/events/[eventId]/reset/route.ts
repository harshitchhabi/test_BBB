import { NextResponse } from "next/server";
import { resetEventForNewRound } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// POST /events/:id/reset — wipes all runtime state (teams, tokens, bids,
// rounds/lots, trades, buildings, cities/auctions, scores) for a fresh
// round on the SAME event id/link, keeping materials/recipes/cities/
// settings configuration untouched. Staff-only. A reason is optional —
// resetEventForNewRound records a clear placeholder in the audit log if
// none is given — the confirmation checkbox on the UI is the actual
// safety gate, not a typed reason.
export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const { reason } = await req.json().catch(() => ({}));
    const event = await resetEventForNewRound({ eventId, actorParticipantId: participant.id, reason: typeof reason === "string" ? reason : undefined });
    return NextResponse.json(event);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
