import { NextResponse } from "next/server";
import { db, eq, or, inArray } from "db";
import { trades, tradeLines, teams, materialTypes } from "db/schema";
import { getParticipantContext } from "game-engine";
import { isStaff } from "common";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// GET /events/:id/trades/list — Section 7.5 Trade desk history + Section
// 7.9 moderator Trade desk queue. A separate path from POST
// /events/:id/trades (the command endpoint) since GET and POST on the
// same collection route would otherwise need to share a dynamic segment
// oddly — kept simple as its own route instead.
export async function GET(_req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const ctx = await getParticipantContext(eventId, participant.id);

    const eventTrades = isStaff(ctx)
      ? await db.select().from(trades).where(eq(trades.eventId, eventId))
      : ctx.team
        ? await db
            .select()
            .from(trades)
            .where(or(eq(trades.proposerTeamId, ctx.team.teamId), eq(trades.counterpartyTeamId, ctx.team.teamId)))
        : [];

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
      counterpartyTeamName: teamNameById.get(trade.counterpartyTeamId),
      lines: (linesByTradeId.get(trade.id) ?? []).map((l) => ({
        ...l,
        fromTeamName: teamNameById.get(l.fromTeamId),
        material: materialById.get(l.materialTypeId),
      })),
    }));

    return NextResponse.json({ trades: result });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
