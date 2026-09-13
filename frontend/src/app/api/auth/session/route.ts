import { NextResponse } from "next/server";
import { getSessionParticipant } from "@/lib/session";

// GET /api/auth/session — same purpose as next-auth's own endpoint of
// the same name: the client useSession() hook (lib/use-session.tsx)
// polls this once on mount to know who's signed in, mirroring next-auth's
// {user} | null shape so the 16 screens that already call useSession()
// didn't need their logic rewritten, just their import swapped.
export async function GET() {
  const participant = await getSessionParticipant();
  if (!participant) return NextResponse.json(null);
  return NextResponse.json({ user: { id: participant.id, name: participant.name, username: participant.username } });
}
