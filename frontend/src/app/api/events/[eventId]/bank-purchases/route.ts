import { NextResponse } from "next/server";
import { purchaseFromBank } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const { teamId, materialTypeId, quantity } = await req.json();

    if (typeof teamId !== "string" || typeof materialTypeId !== "string" || typeof quantity !== "number") {
      return NextResponse.json(
        { error: "invalid_input", message: "teamId, materialTypeId, and quantity are required." },
        { status: 400 },
      );
    }

    const purchase = await purchaseFromBank({ eventId, teamId, materialTypeId, quantity, actingParticipantId: participant.id });
    return NextResponse.json(purchase);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
