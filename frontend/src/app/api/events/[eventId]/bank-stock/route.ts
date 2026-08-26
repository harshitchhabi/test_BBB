import { NextResponse } from "next/server";
import { getBankStock } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// GET /events/:id/bank-stock — Section 7.4: "Available bank stock and tax
// rates during Stage 2." Not team-private data (every team can see what's
// left to buy), so no per-team filtering here — just requires being
// signed in and a participant of some kind for this event.
export async function GET(_req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    await requireParticipant();
    const stock = await getBankStock(eventId);
    return NextResponse.json({ stock });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
