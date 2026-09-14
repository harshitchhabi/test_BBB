import { NextResponse } from "next/server";
import { voidBuilding } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

export async function POST(req: Request, { params }: { params: Promise<{ eventId: string; buildingId: string }> }) {
  try {
    const { eventId, buildingId } = await params;
    const participant = await requireParticipant();
    const { reason } = await req.json().catch(() => ({}));
    const building = await voidBuilding({ eventId, buildingId, moderatorParticipantId: participant.id, reason: typeof reason === "string" ? reason : undefined });
    return NextResponse.json(building);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
