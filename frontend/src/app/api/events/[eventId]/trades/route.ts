import { NextResponse } from "next/server";
import { proposeTrade } from "game-engine";
import { requireParticipant, apiErrorResponse, isValidAmount } from "@/lib/api";

// POST /events/:id/trades — Section 8.1, actor: team leader or moderator.
// Leadership is verified inside proposeTrade itself (against
// team_members), not here — this route is a thin pass-through.
export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const { proposerTeamId, counterpartyTeamId, lines } = await req.json();

    const linesValid =
      Array.isArray(lines) &&
      lines.length > 0 &&
      lines.every(
        (line) =>
          line && typeof line.fromTeamId === "string" && typeof line.materialTypeId === "string" && isValidAmount(line.quantity),
      );
    if (typeof proposerTeamId !== "string" || typeof counterpartyTeamId !== "string" || !linesValid) {
      return NextResponse.json(
        { error: "invalid_input", message: "proposerTeamId, counterpartyTeamId, and valid lines (with positive whole-number quantities) are required." },
        { status: 400 },
      );
    }

    const trade = await proposeTrade({
      eventId,
      proposerTeamId,
      counterpartyTeamId,
      proposerParticipantId: participant.id,
      lines,
    });
    return NextResponse.json(trade);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
