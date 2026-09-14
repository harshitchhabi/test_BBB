import { NextResponse } from "next/server";
import { changeOwnPassword } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// POST /api/auth/change-password — self-service: any signed-in
// participant (team or staff) changes their own password by proving
// they know the current one. Unlike a staff-issued reset
// (/events/:id/logins/:participantId/reset-password), this does not
// clear the session — the person doing this IS the one currently
// signed in, so there's no "someone else's old session" to kick out.
export async function POST(req: Request) {
  try {
    const participant = await requireParticipant();
    const { currentPassword, newPassword } = await req.json().catch(() => ({}));
    if (typeof currentPassword !== "string" || typeof newPassword !== "string" || !currentPassword || !newPassword) {
      return NextResponse.json({ error: "invalid_input", message: "Current and new password are required." }, { status: 400 });
    }
    await changeOwnPassword({ participantId: participant.id, currentPassword, newPassword });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
