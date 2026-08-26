import { NextResponse } from "next/server";
import { joinTeam } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const { code } = await req.json();
    if (typeof code !== "string" || code.trim().length === 0) {
      return NextResponse.json({ error: "invalid_input", message: "Team code is required." }, { status: 400 });
    }

    const team = await joinTeam({ eventId, participantId: participant.id, code: code.trim() });
    return NextResponse.json(team);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
