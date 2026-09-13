import { NextResponse } from "next/server";
import { logout } from "game-engine";
import { getSessionParticipant, clearSessionCookie } from "@/lib/session";

// POST /api/auth/logout — clears the server-side session_id (so the old
// cookie is refused even if somehow replayed) and the cookie itself.
export async function POST() {
  const participant = await getSessionParticipant();
  if (participant) await logout(participant.id);
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
