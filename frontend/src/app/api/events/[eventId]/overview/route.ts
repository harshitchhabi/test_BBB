import { NextResponse } from "next/server";
import { db, eq } from "db";
import { events, eventSettings, teams } from "db/schema";
import { getParticipantContext } from "game-engine";
import { isStaff } from "common";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// GET /events/:id/overview — backs the Event Home / lobby (Section 7.2)
// and Rules (Section 7.1 nav item) screens: event name/stage, the
// caller's own team + role, the active event_settings (so "Rules" always
// reflects the actual configured event, never a hard-coded static page),
// and token summary cards. Staff get every team's balance; a team only
// ever gets its own (same visibility rule as auction-state).
export async function GET(_req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const participant = await requireParticipant();
    const ctx = await getParticipantContext(eventId, participant.id);

    const [event] = await db.select().from(events).where(eq(events.id, eventId));
    if (!event) return NextResponse.json({ error: "not_found", message: "Event not found." }, { status: 404 });

    const [settings] = await db.select().from(eventSettings).where(eq(eventSettings.eventId, eventId));

    const teamRows = await db
      .select({
        id: teams.id,
        name: teams.name,
        code: teams.code,
        auctionTokens: teams.auctionTokens,
        cityWalletTokens: teams.cityWalletTokens,
        tradeCount: teams.tradeCount,
        status: teams.status,
        ownerParticipantId: teams.ownerParticipantId,
      })
      .from(teams)
      .where(eq(teams.eventId, eventId));

    const staff = isStaff(ctx);
    const visibleTeams = staff
      ? teamRows
      : teamRows.map((t) =>
          t.id === ctx.team?.teamId
            ? t
            : { id: t.id, name: t.name, status: t.status, code: null, auctionTokens: null, cityWalletTokens: null, tradeCount: null, ownerParticipantId: null },
        );

    const myTeam = teamRows.find((t) => t.id === ctx.team?.teamId) ?? null;

    return NextResponse.json({
      event: { id: event.id, name: event.name, status: event.status, rulesVersion: event.rulesVersion },
      settings,
      isStaff: staff,
      myRole: ctx.team?.role ?? null,
      myTeam: myTeam && !staff ? myTeam : myTeam ?? null,
      teams: visibleTeams,
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
