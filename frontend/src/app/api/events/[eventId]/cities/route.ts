import { NextResponse } from "next/server";
import { listCities } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// GET /events/:id/cities — Section 7.6 city cards. listCities itself
// never selects hidden_multiplier, so there is nothing for this route to
// accidentally leak regardless of caller.
export async function GET(_req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    await requireParticipant();
    const cities = await listCities(eventId);
    return NextResponse.json({ cities });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
