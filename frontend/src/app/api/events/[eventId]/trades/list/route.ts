import { NextResponse } from "next/server";
import { db, eq, inArray } from "db";
import { trades, tradeLines, teams, materialTypes } from "db/schema";
import { getParticipantContext } from "game-engine";
import { isStaff } from "common";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// GET /events/:id/trades/list — Section 7.5 Trade desk history + Section
// 7.9 moderator Trade desk queue. A separate path from POST
// /events/:id/trades (the command endpoint) since GET and POST on the
// same collection route would otherwise need to share a dynamic segment
// oddly — kept simple as its own route instead.
//
// Every trade in the event is visible to every team here, not just its
// two participants — same reasoning as teams-inventory: a team can't
// size up what's being negotiated around them (who's trading what for
// what) if trades in progress are invisible until they happen to be one
// of the two teams involved. Accepting/declining a trade is still
// restricted to the actual counterparty (enforced in trade-service.ts's
// acceptTrade/declineTrade) — this only widens who can SEE it.
export async function GET(_req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const ctx = await getParticipantContext(eventId, participant.id);
    if (!isStaff(ctx) && !ctx.team) {
      return NextResponse.json({ error: "forbidden", message: "You are not part of this event." }, { status: 403 });
    }

    const eventTrades = await db.select().from(trades).where(eq(trades.eventId, eventId));

    const teamRows = await db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.eventId, eventId));
    const teamNameById = new Map(teamRows.map((t) => [t.id, t.name]));
    const materialRows = await db.select({ id: materialTypes.id, key: materialTypes.key, name: materialTypes.name }).from(materialTypes).where(eq(materialTypes.eventId, eventId));
    const materialById = new Map(materialRows.map((m) => [m.id, m]));

    // One query for every trade's lines instead of one query per trade —
    // matters once an event has built up dozens of trades across 25-30
    // teams, since this route reruns on every trade-related refresh.
    const tradeIds = eventTrades.map((t) => t.id);
    const allLines = tradeIds.length
      ? await db.select().from(tradeLines).where(inArray(tradeLines.tradeId, tradeIds))
      : [];
    const linesByTradeId = new Map<string, typeof allLines>();
    for (const line of allLines) {
      const existing = linesByTradeId.get(line.tradeId);
      if (existing) existing.push(line);
      else linesByTradeId.set(line.tradeId, [line]);
    }

    const result = eventTrades.map((trade) => ({
      ...trade,
      proposerTeamName: teamNameById.get(trade.proposerTeamId),
      // null on an open offer nobody has accepted yet.
      counterpartyTeamName: trade.counterpartyTeamId ? (teamNameById.get(trade.counterpartyTeamId) ?? null) : null,
      lines: (linesByTradeId.get(trade.id) ?? []).map((l) => ({
        ...l,
        // null on an open-offer line nobody has claimed yet ("whoever
        // accepts provides this").
        fromTeamName: l.fromTeamId ? (teamNameById.get(l.fromTeamId) ?? null) : null,
        material: materialById.get(l.materialTypeId),
      })),
    }));

    return NextResponse.json({ trades: result });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
