import { db, eq, and } from "db";
import { events, eventSettings, eventStaff, teams, teamMembers, participants } from "db/schema";
import type { ParticipantEventContext } from "common";
import { GameError } from "./errors";
import { recordAudit } from "./audit";
import { runInTransaction, type Tx } from "./tx";

function randomTeamCode(): string {
  // Short, spoken-aloud-friendly code for the "join by code" flow — same
  // idea as the legacy repo's randomUUID().slice(0, 6), but restricted to
  // an unambiguous alphabet (no 0/O/1/I) since teams read these out loud
  // in a noisy room.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

// Resolves who a participant is *for this event*: are they staff, are they
// on a team, and in what role. Every command handler calls this first and
// authorizes off the result — never off a client-asserted role.
export async function getParticipantContext(
  eventId: string,
  participantId: string,
): Promise<ParticipantEventContext> {
  const [staffRow] = await db
    .select({ role: eventStaff.role })
    .from(eventStaff)
    .where(and(eq(eventStaff.eventId, eventId), eq(eventStaff.participantId, participantId)));

  const [memberRow] = await db
    .select({ teamId: teamMembers.teamId, role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.eventId, eventId), eq(teamMembers.participantId, participantId)));

  return {
    participantId,
    eventId,
    staffRole: staffRow?.role ?? null,
    team: memberRow ? { teamId: memberRow.teamId, role: memberRow.role } : null,
  };
}

export async function resolveParticipantByEmail(email: string) {
  const [participant] = await db.select().from(participants).where(eq(participants.email, email));
  if (!participant) throw new GameError("not_found", "Participant not found — sign in again.");
  return participant;
}

export async function createTeam(params: { eventId: string; ownerParticipantId: string; name: string }) {
  return runInTransaction(async (tx) => {
    const [event] = await tx.select().from(events).where(eq(events.id, params.eventId));
    if (!event) throw new GameError("not_found", "Event not found.");
    if (event.status !== "setup" && event.status !== "lobby") {
      throw new GameError("invalid_event_stage", "Teams can only be created before Stage 1 begins.");
    }

    const [existingMembership] = await tx
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(and(eq(teamMembers.eventId, params.eventId), eq(teamMembers.participantId, params.ownerParticipantId)));
    if (existingMembership) {
      throw new GameError("conflict", "You are already on a team in this event.");
    }

    const [settings] = await tx.select().from(eventSettings).where(eq(eventSettings.eventId, params.eventId));
    if (!settings) throw new GameError("not_found", "Event settings not found.");

    const team = await insertTeamWithUniqueCode(tx, {
      eventId: params.eventId,
      name: params.name,
      ownerParticipantId: params.ownerParticipantId,
      auctionTokens: settings.stage1StartingTokens,
      cityWalletTokens: settings.cityWalletTokens,
    });

    await tx.insert(teamMembers).values({
      eventId: params.eventId,
      teamId: team.id,
      participantId: params.ownerParticipantId,
      role: "leader",
    });

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.ownerParticipantId,
      action: "team.created",
      entityType: "team",
      entityId: team.id,
      afterJson: team,
    });

    return team;
  });
}

async function insertTeamWithUniqueCode(
  tx: Tx,
  values: { eventId: string; name: string; ownerParticipantId: string; auctionTokens: number; cityWalletTokens: number },
) {
  // The (event_id, code) unique index is the real guarantee; this loop just
  // avoids surfacing a raw constraint-violation error to the moderator on
  // the rare code collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [team] = await tx
        .insert(teams)
        .values({ ...values, code: randomTeamCode() })
        .returning();
      return team;
    } catch (err) {
      if (attempt === 4) throw err;
    }
  }
  throw new Error("unreachable");
}

export async function joinTeam(params: { eventId: string; participantId: string; code: string }) {
  return runInTransaction(async (tx) => {
    const [team] = await tx
      .select()
      .from(teams)
      .where(and(eq(teams.eventId, params.eventId), eq(teams.code, params.code.toUpperCase())));
    if (!team) throw new GameError("not_found", "No team with that code in this event.");
    if (team.status !== "active") throw new GameError("conflict", "That team is no longer active.");

    const [existingMembership] = await tx
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(and(eq(teamMembers.eventId, params.eventId), eq(teamMembers.participantId, params.participantId)));
    if (existingMembership) {
      throw new GameError("conflict", "You are already on a team in this event.");
    }

    const [member] = await tx
      .insert(teamMembers)
      .values({ eventId: params.eventId, teamId: team.id, participantId: params.participantId, role: "member" })
      .returning();

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.participantId,
      action: "team.joined",
      entityType: "team",
      entityId: team.id,
      afterJson: member,
    });

    return team;
  });
}
