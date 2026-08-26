import { NextResponse } from "next/server";
import { voidBuilding } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

export async function POST(req: Request, { params }: { params: Promise<{ eventId: string; buildingId: string }> }) {
  try {
    const { eventId, buildingId } = await params;
    const participant = await requireParticipant();
    const { reason } = await req.json();
    if (typeof reason !== "string" || reason.trim().length === 0) {
      return NextResponse.json({ error: "invalid_input", message: "A reason is required to void a building." }, { status: 400 });
    }
    const building = await voidBuilding({ eventId, buildingId, moderatorParticipantId: participant.id, reason });
    return NextResponse.json(building);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
