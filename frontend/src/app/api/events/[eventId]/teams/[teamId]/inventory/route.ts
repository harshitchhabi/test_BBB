import { NextResponse } from "next/server";
import { getTeamInventory, getParticipantContext } from "game-engine";
import { isStaff } from "common";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// GET /events/:id/teams/:teamId/inventory — Section 7.4 Inventory screen.
// A team can see its own stock; staff can see anyone's; another team
// cannot see this team's stock (Section 8.3: "clients receive their own
// private balance, inventory...").
export async function GET(_req: Request, { params }: { params: Promise<{ eventId: string; teamId: string }> }) {
  try {
    const { eventId, teamId } = await params;
    const participant = await requireParticipant();
    const ctx = await getParticipantContext(eventId, participant.id);

    if (!isStaff(ctx) && ctx.team?.teamId !== teamId) {
      return NextResponse.json({ error: "forbidden", message: "You can only view your own team's inventory." }, { status: 403 });
    }

    const inventory = await getTeamInventory(eventId, teamId);
    return NextResponse.json({ teamId, inventory });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
