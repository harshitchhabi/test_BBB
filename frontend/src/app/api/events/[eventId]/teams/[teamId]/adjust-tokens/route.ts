import { NextResponse } from "next/server";
import { adjustTeamTokens } from "game-engine";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

export async function POST(req: Request, { params }: { params: Promise<{ eventId: string; teamId: string }> }) {
  try {
    const { eventId, teamId } = await params;
    const participant = await requireParticipant();
    const { auctionTokensDelta, cityWalletTokensDelta, reason } = await req.json().catch(() => ({}));
    const team = await adjustTeamTokens({
      eventId,
      teamId,
      auctionTokensDelta: typeof auctionTokensDelta === "number" ? auctionTokensDelta : undefined,
      cityWalletTokensDelta: typeof cityWalletTokensDelta === "number" ? cityWalletTokensDelta : undefined,
      actorParticipantId: participant.id,
      reason: typeof reason === "string" ? reason : undefined,
    });
    return NextResponse.json(team);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
