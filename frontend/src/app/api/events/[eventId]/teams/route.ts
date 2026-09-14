import { NextResponse } from "next/server";
import { createTeamLogin } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// POST /events/:id/teams — Task 1: teams are no longer self-serve.
// Staff-only, creates the team AND its one shared login credential in
// the same request; the plaintext password is returned once for the
// admin screen to display (and never stored anywhere but its hash).
export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const { name, username, password } = await req.json();
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "invalid_input", message: "Team name is required." }, { status: 400 });
    }
    if (typeof username !== "string" || username.trim().length === 0) {
      return NextResponse.json({ error: "invalid_input", message: "A username is required." }, { status: 400 });
    }
    if (password !== undefined && typeof password !== "string") {
      return NextResponse.json({ error: "invalid_input", message: "Password must be a string." }, { status: 400 });
    }

    const result = await createTeamLogin({
      eventId,
      actorParticipantId: participant.id,
      teamName: name.trim(),
      username,
      password: password || undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
