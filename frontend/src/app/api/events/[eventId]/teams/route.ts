import { NextResponse } from "next/server";
import { createTeam } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// POST /events/:id/teams — create a team (Section 8.1 doesn't enumerate
// this one explicitly, but Section 7's team creation/joining flow needs a
// command endpoint same as every other write).
export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const { name } = await req.json();
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "invalid_input", message: "Team name is required." }, { status: 400 });
    }

    const team = await createTeam({ eventId, ownerParticipantId: participant.id, name: name.trim() });
    return NextResponse.json(team);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
