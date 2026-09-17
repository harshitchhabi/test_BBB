import { NextResponse } from "next/server";
import { adjustTeamInventory } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// POST /events/:id/teams/:teamId/adjust-inventory — staff-only manual
// correction of one material's quantity for one team, e.g. fixing a
// miscount or backfilling something handed out off-system. Same
// override shape as adjust-tokens: a signed +/- whole-number delta, an
// optional reason, recorded as its own "manual_adjustment" ledger row
// rather than overwriting anything (there's no mutable stock column to
// overwrite - see inventory-service.ts).
export async function POST(req: Request, { params }: { params: Promise<{ eventId: string; teamId: string }> }) {
  try {
    const { eventId, teamId } = await params;
    const participant = await requireParticipant();
    const { materialTypeId, quantityDelta, reason } = await req.json().catch(() => ({}));
    if (typeof materialTypeId !== "string" || materialTypeId.length === 0) {
      return NextResponse.json({ error: "invalid_input", message: "materialTypeId is required." }, { status: 400 });
    }
    if (typeof quantityDelta !== "number" || !Number.isInteger(quantityDelta) || quantityDelta === 0) {
      return NextResponse.json({ error: "invalid_input", message: "quantityDelta must be a non-zero whole number." }, { status: 400 });
    }

    const result = await adjustTeamInventory({
      eventId,
      teamId,
      materialTypeId,
      quantityDelta,
      actorParticipantId: participant.id,
      reason: typeof reason === "string" ? reason : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
