import { NextResponse } from "next/server";
import { sellCityToTeam } from "game-engine";
import { requireParticipant, apiErrorResponse, isValidAmount } from "@/lib/api";

// POST /events/:id/cities/:cityId/sell — staff-only manual override:
// directly sell this city to a team at a moderator-chosen price, for an
// in-person/paper bid or a correction, without running a live timed
// auction through the app. Still refuses a price the team can't afford
// (city wallet + leftover Stage 1 tokens) - that's the one rule this
// can't override.
export async function POST(req: Request, { params }: { params: Promise<{ eventId: string; cityId: string }> }) {
  try {
    const { eventId, cityId } = await params;
    const participant = await requireParticipant();
    const { teamId, amount, reason } = await req.json();
    if (typeof teamId !== "string" || teamId.length === 0) {
      return NextResponse.json({ error: "invalid_input", message: "teamId is required." }, { status: 400 });
    }
    const amountValid = amount === 0 || isValidAmount(amount);
    if (!amountValid) {
      return NextResponse.json({ error: "invalid_input", message: "amount must be a non-negative whole number." }, { status: 400 });
    }

    const result = await sellCityToTeam({
      eventId,
      cityId,
      teamId,
      amount,
      actorParticipantId: participant.id,
      reason: typeof reason === "string" ? reason : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
