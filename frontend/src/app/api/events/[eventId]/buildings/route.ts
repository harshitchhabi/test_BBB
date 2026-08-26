import { NextResponse } from "next/server";
import { constructBuilding } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// POST /events/:id/buildings — Section 8.1: "Team leader/moderator,
// according to selected workflow." Which of the two the caller is gets
// verified inside constructBuilding itself.
export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const { teamId, recipeId, bonuses } = await req.json();

    if (typeof teamId !== "string" || typeof recipeId !== "string") {
      return NextResponse.json({ error: "invalid_input", message: "teamId and recipeId are required." }, { status: 400 });
    }

    const building = await constructBuilding({ eventId, teamId, recipeId, bonuses, actorParticipantId: participant.id });
    return NextResponse.json(building);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
