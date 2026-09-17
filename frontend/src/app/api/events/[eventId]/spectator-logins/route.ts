import { NextResponse } from "next/server";
import { createSpectatorLogin, getParticipantContext } from "game-engine";
import { isStaff } from "common";
import { db, eq } from "db";
import { eventSpectators, participants } from "db/schema";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// GET /events/:id/spectator-logins — staff-only roster feeding the
// moderator setup page's spectator list, same shape as GET .../staff.
export async function GET(_req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const ctx = await getParticipantContext(eventId, participant.id);
    if (!isStaff(ctx)) {
      return NextResponse.json({ error: "forbidden", message: "Moderators only." }, { status: 403 });
    }

    const rows = await db
      .select({ participantId: eventSpectators.participantId, name: participants.name, username: participants.username })
      .from(eventSpectators)
      .innerJoin(participants, eq(eventSpectators.participantId, participants.id))
      .where(eq(eventSpectators.eventId, eventId));

    return NextResponse.json({ spectators: rows });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

// POST /events/:id/spectator-logins — mints a brand-new read-only "view
// desk" login for someone who is neither a team nor staff.
export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const { name, username, password } = await req.json();
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "invalid_input", message: "Name is required." }, { status: 400 });
    }
    if (typeof username !== "string" || username.trim().length === 0) {
      return NextResponse.json({ error: "invalid_input", message: "A username is required." }, { status: 400 });
    }
    if (password !== undefined && typeof password !== "string") {
      return NextResponse.json({ error: "invalid_input", message: "Password must be a string." }, { status: 400 });
    }

    const result = await createSpectatorLogin({ eventId, actorParticipantId: participant.id, name: name.trim(), username, password: password || undefined });
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
