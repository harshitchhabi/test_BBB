import { NextResponse } from "next/server";
import { proposeTrade } from "game-engine";
import { requireParticipant, apiErrorResponse, isValidAmount } from "@/lib/api";

// POST /events/:id/trades — Section 8.1, actor: team leader or moderator.
// Leadership is verified inside proposeTrade itself (against
// team_members), not here — this route is a thin pass-through.
//
// counterpartyTeamId is optional: omit it (or send null) to post an
// OPEN OFFER instead of a direct two-party proposal - not aimed at any
// specific team, any other team's leader may accept it. A line's
// fromTeamId may then also be null, meaning "whoever accepts provides
// this" - proposeTrade validates that only the proposer's own id or
// null appears on an open offer's lines.
//
// A line's materialTypeId may also be null/omitted, meaning this line
// trades TOKENS instead of a material - "credits for materials and
// vice versa," per the rulebook's leftover-tokens-are-spendable-
// anywhere model. quantity is then the token amount.
export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const { proposerTeamId, counterpartyTeamId, lines } = await req.json();

    const isOpenOffer = counterpartyTeamId === undefined || counterpartyTeamId === null;
    const linesValid =
      Array.isArray(lines) &&
      lines.length > 0 &&
      lines.every(
        (line) =>
          line &&
          ((typeof line.fromTeamId === "string" && line.fromTeamId.length > 0) || (isOpenOffer && line.fromTeamId == null)) &&
          ((typeof line.materialTypeId === "string" && line.materialTypeId.length > 0) || line.materialTypeId == null) &&
          isValidAmount(line.quantity),
      );
    if (
      typeof proposerTeamId !== "string" ||
      proposerTeamId.length === 0 ||
      (!isOpenOffer && (typeof counterpartyTeamId !== "string" || counterpartyTeamId.length === 0)) ||
      !linesValid
    ) {
      return NextResponse.json(
        {
          error: "invalid_input",
          message:
            "proposerTeamId and valid lines (with positive whole-number quantities) are required; counterpartyTeamId must be a string, or omitted/null for an open offer.",
        },
        { status: 400 },
      );
    }

    const trade = await proposeTrade({
      eventId,
      proposerTeamId,
      counterpartyTeamId: isOpenOffer ? null : counterpartyTeamId,
      proposerParticipantId: participant.id,
      lines: lines.map((l: { fromTeamId: string | null; materialTypeId?: string | null; quantity: number }) => ({
        fromTeamId: l.fromTeamId,
        materialTypeId: l.materialTypeId ?? null,
        quantity: l.quantity,
      })),
    });
    return NextResponse.json(trade);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
