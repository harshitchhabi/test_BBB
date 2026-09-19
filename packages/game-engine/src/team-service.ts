import { db, eq, and, sql } from "db";
import { events, eventSettings, eventStaff, eventSpectators, teams, teamMembers, participants } from "db/schema";
import type { ParticipantEventContext } from "common";
import { GameError } from "./errors";
import { recordAudit } from "./audit";
import { runInTransaction, type Tx } from "./tx";
import { createLoginTx, generatePassword, hashPassword } from "./auth-service";

// Shared by every service whose command is leader-only (Section 8.3: "The
// team leader can submit a team bid, trade request, build request, scout
// report, and city bid") — checked inside the same transaction as the
// mutation itself, against team_members, never against anything the
// client asserts about its own role.
export async function assertTeamLeaderTx(tx: Tx, eventId: string, teamId: string, participantId: string) {
  const [membership] = await tx
    .select({ role: teamMembers.role, teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(and(eq(teamMembers.eventId, eventId), eq(teamMembers.participantId, participantId)));
  if (!membership || membership.teamId !== teamId || membership.role !== "leader") {
    throw new GameError("forbidden", "Only the team leader may do this for their team.");
  }
}

// Non-throwing counterpart to assertTeamLeaderTx, for callers that need
// to check "is this one of two possible teams' leader" (e.g. either side
// of a trade declining it) rather than a single required team.
export async function isTeamLeaderTx(tx: Tx, eventId: string, teamId: string, participantId: string) {
  const [membership] = await tx
    .select({ role: teamMembers.role, teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(and(eq(teamMembers.eventId, eventId), eq(teamMembers.participantId, participantId)));
  return Boolean(membership && membership.teamId === teamId && membership.role === "leader");
}

// For moderator-only commands (round/lot control, trade register/reject/
// complete, void building, resolve inspection). Section 4: "all rules are
// evaluated server-side" — this is enforced inside the engine function
// itself, not only by the API route that happens to call it, so a future
// second caller (an admin script, a different surface) can't skip it by
// forgetting to re-check.
export async function assertStaffTx(tx: Tx, eventId: string, participantId: string) {
  const [staffRow] = await tx
    .select({ role: eventStaff.role })
    .from(eventStaff)
    .where(and(eq(eventStaff.eventId, eventId), eq(eventStaff.participantId, participantId)));
  if (!staffRow) throw new GameError("forbidden", "Only event moderators can do this.");
}

// Same idea, but for the handful of commands (construction — Section 8.1:
// "Team leader/moderator, according to selected workflow") that the
// rulebook's own real-world process lets either side submit.
export async function assertTeamLeaderOrStaffTx(tx: Tx, eventId: string, teamId: string, participantId: string) {
  const [staffRow] = await tx
    .select({ role: eventStaff.role })
    .from(eventStaff)
    .where(and(eq(eventStaff.eventId, eventId), eq(eventStaff.participantId, participantId)));
  if (staffRow) return;
  await assertTeamLeaderTx(tx, eventId, teamId, participantId);
}

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

  const [spectatorRow] = await db
    .select({ id: eventSpectators.id })
    .from(eventSpectators)
    .where(and(eq(eventSpectators.eventId, eventId), eq(eventSpectators.participantId, participantId)));

  return {
    participantId,
    eventId,
    staffRole: staffRow?.role ?? null,
    team: memberRow ? { teamId: memberRow.teamId, role: memberRow.role } : null,
    isSpectator: Boolean(spectatorRow),
  };
}

async function createTeamTx(tx: Tx, params: { eventId: string; ownerParticipantId: string; name: string }) {
  const [event] = await tx.select().from(events).where(eq(events.id, params.eventId));
  if (!event) throw new GameError("not_found", "Event not found.");
  if (event.status !== "setup" && event.status !== "lobby") {
    throw new GameError("invalid_event_stage", "Teams can only be created before Stage 1 begins.");
  }

  // Staff accounts stay strictly separate from playing — a staff account
  // ending up as a team's owner meant they'd start seeing the full
  // player nav instead of just auction control, which defeats the point
  // of having a distinct staff role at all. Moot now that only staff can
  // call createTeamLogin (below) and it always mints a brand-new
  // participant, but createTeamTx keeps this check since it's also the
  // one place team creation happens.
  const [staffRow] = await tx
    .select({ id: eventStaff.id })
    .from(eventStaff)
    .where(and(eq(eventStaff.eventId, params.eventId), eq(eventStaff.participantId, params.ownerParticipantId)));
  if (staffRow) {
    throw new GameError("forbidden", "Staff accounts can't create or join a team — sign in with a different account to play.");
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
}

export async function createTeam(params: { eventId: string; ownerParticipantId: string; name: string }) {
  return runInTransaction((tx) => createTeamTx(tx, params));
}

// Task 1: teams are no longer self-serve. Only staff can create a team,
// and creating one now also mints its one shared login credential in the
// same transaction — there's no separate "sign in with Google, then
// create your team" step anymore, so the plaintext password has to be
// handed back here, once, for the admin screen to display.
export async function createTeamLogin(params: {
  eventId: string;
  actorParticipantId: string;
  teamName: string;
  username: string;
  password?: string;
}) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStaffTx(tx, params.eventId, params.actorParticipantId);
    const { participant, password } = await createLoginTx(tx, { name: params.teamName, username: params.username, password: params.password });
    const team = await createTeamTx(tx, { eventId: params.eventId, ownerParticipantId: participant.id, name: params.teamName });
    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actorParticipantId,
      action: "team_login.created",
      entityType: "team",
      entityId: team.id,
      afterJson: { teamName: params.teamName, username: participant.username },
    });
    // A second moderator watching Teams & Incidents live (a real scenario
    // now that multiple staff logins are common) never saw a newly
    // created team appear without a manual reload - this route never
    // broadcast anything.
    queueBroadcast({ eventId: params.eventId, type: "moderator.announcement", data: { createdTeamId: team.id, createdTeamName: team.name } });
    return { team, username: participant.username, password };
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

// Kept working and unit-testable, but deliberately not wired to any API
// route or UI: the app is now one person per team by product decision —
// only the leader can ever take a write action anywhere (bid, trade,
// build, scout, city-bid), so a second "member" login has no functional
// purpose, and letting anyone join a team by its code was also more
// attack surface than benefit. frontend/src/app/api/events/[eventId]/
// teams/join was removed entirely rather than just hidden.
//
// One login per team is enforced here too, not just by the missing
// route — a team is capped at exactly one team_members row (its
// leader, inserted once by createTeamTx when the login is created).
// Even if this function were ever accidentally wired back up, or called
// directly by some future script, it can never actually create a
// second login on a team that already has one.
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

    const [alreadyHasLogin] = await tx.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.teamId, team.id));
    if (alreadyHasLogin) {
      throw new GameError("conflict", "This team already has its one login — a second login per team is not allowed.");
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

// Bootstraps or extends event_staff. Section 7.9's setup checklist
// otherwise required a direct database insert to create the first
// moderator for an event (flagged in docs/phase-5.md). The original fix
// for that (any signed-in participant may claim the first staff slot for
// a fresh event) turned out to itself be a loophole: whoever reaches
// /moderator/setup first — not necessarily the actual organizer — becomes
// moderator, which matters if the event id/link ever leaks or is guessed
// before the real organizer claims it. Fixed by tracking who actually
// created the event (events.created_by, set by packages/db/seed/run.ts):
// when that's set, ONLY that participant may claim the first staff slot.
// It stays nullable, and bootstrap falls back to "anyone" for an event
// seeded without specifying a creator — a deliberate, narrower escape
// hatch for local/dev use, not the recommended path for a real event.
// Task 1: staff are no longer "an already-signed-in participant, added by
// email" — there is no more self-serve sign-in to have happened first.
// Creating a staff login now mints its credential in the same
// transaction as the event_staff row, same shape as createTeamLogin.
// The bootstrap rule is unchanged: the event's first staff slot can only
// be claimed by whoever created the event (events.created_by), or by
// anyone if the event was seeded without a creator; every slot after
// that requires the requester to already be staff.
export async function createStaffLogin(params: {
  eventId: string;
  actorParticipantId: string;
  name: string;
  username: string;
  password?: string;
}) {
  return runInTransaction(async (tx, queueBroadcast) => {
    const [event] = await tx.select().from(events).where(eq(events.id, params.eventId));
    if (!event) throw new GameError("not_found", "Event not found.");

    const existingStaff = await tx.select({ id: eventStaff.id }).from(eventStaff).where(eq(eventStaff.eventId, params.eventId));
    if (existingStaff.length > 0) {
      const [requesterIsStaff] = await tx
        .select({ id: eventStaff.id })
        .from(eventStaff)
        .where(and(eq(eventStaff.eventId, params.eventId), eq(eventStaff.participantId, params.actorParticipantId)));
      if (!requesterIsStaff) throw new GameError("forbidden", "Only existing event staff can add more staff.");
    } else if (event.createdBy && event.createdBy !== params.actorParticipantId) {
      throw new GameError("forbidden", "Only the event's creator can claim the first staff slot for this event.");
    }

    const { participant, password } = await createLoginTx(tx, { name: params.name, username: params.username, password: params.password });

    const [staffRow] = await tx
      .insert(eventStaff)
      .values({ eventId: params.eventId, participantId: participant.id })
      .returning();

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actorParticipantId,
      action: "staff_login.created",
      entityType: "event_staff",
      entityId: staffRow.id,
      afterJson: { name: params.name, username: participant.username },
    });

    // Same reasoning as createTeamLogin: another moderator watching the
    // Setup page's Current Staff list never saw a new staff login appear
    // without a manual reload.
    queueBroadcast({ eventId: params.eventId, type: "moderator.announcement", data: { createdStaffParticipantId: participant.id, createdStaffName: params.name } });
    return { staffRow, username: participant.username, password };
  });
}

// Staff-only: mints a read-only "view desk" login — sees the live
// auction/city-auction status (Section 7.3-style summary) and nothing
// else, no team balances, inventory, or trade activity. Same shape as
// createStaffLogin/createTeamLogin (new participant + role row in one
// transaction), but with no bootstrap special case: staff must already
// exist to create one, since a spectator login is never load-bearing for
// the event to run.
export async function createSpectatorLogin(params: {
  eventId: string;
  actorParticipantId: string;
  name: string;
  username: string;
  password?: string;
}) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStaffTx(tx, params.eventId, params.actorParticipantId);

    const { participant, password } = await createLoginTx(tx, { name: params.name, username: params.username, password: params.password });

    const [spectatorRow] = await tx
      .insert(eventSpectators)
      .values({ eventId: params.eventId, participantId: participant.id })
      .returning();

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actorParticipantId,
      action: "spectator_login.created",
      entityType: "event_spectator",
      entityId: spectatorRow.id,
      afterJson: { name: params.name, username: participant.username },
    });

    queueBroadcast({ eventId: params.eventId, type: "moderator.announcement", data: { createdSpectatorParticipantId: participant.id, createdSpectatorName: params.name } });
    return { spectatorRow, username: participant.username, password };
  });
}

// Staff-only: removes a spectator login's access to this event and frees
// its username for reuse — same released-login pattern as
// deleteStaffLogin, minus the "can't remove the last one" guard, since
// unlike staff, an event with zero spectator logins is completely normal.
export async function deleteSpectatorLogin(params: {
  eventId: string;
  actorParticipantId: string;
  participantId: string;
  reason?: string;
}) {
  return runInTransaction(async (tx) => {
    await assertStaffTx(tx, params.eventId, params.actorParticipantId);

    const [spectatorRow] = await tx
      .select()
      .from(eventSpectators)
      .where(and(eq(eventSpectators.eventId, params.eventId), eq(eventSpectators.participantId, params.participantId)))
      .for("update");
    if (!spectatorRow) throw new GameError("not_found", "Spectator login not found for this event.");

    const [participant] = await tx.select().from(participants).where(eq(participants.id, params.participantId)).for("update");
    if (!participant) throw new GameError("not_found", "Login not found.");

    await tx.delete(eventSpectators).where(eq(eventSpectators.id, spectatorRow.id));

    const releasedUsername = `released-${participant.username}-${participant.id.slice(0, 8)}`;
    const passwordHash = await hashPassword(generatePassword());
    await tx.update(participants).set({ username: releasedUsername, passwordHash, sessionId: null }).where(eq(participants.id, participant.id));

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actorParticipantId,
      reason: params.reason,
      isOverride: true,
      action: "spectator_login.deleted",
      entityType: "event_spectator",
      entityId: spectatorRow.id,
    });

    return { removed: true };
  });
}

// Staff-only: regenerates a login's password (team or staff — either is
// just a participants row) and clears its session, so whoever was
// previously signed in with the old password is forced to sign in again
// with the new one. Mirrors dream_team's ReissueCredentials/SetPassword.
export async function resetLoginPassword(params: {
  eventId: string;
  actorParticipantId: string;
  participantId: string;
  reason?: string;
}) {
  return runInTransaction(async (tx) => {
    await assertStaffTx(tx, params.eventId, params.actorParticipantId);

    const [participant] = await tx.select().from(participants).where(eq(participants.id, params.participantId)).for("update");
    if (!participant) throw new GameError("not_found", "Login not found.");

    // participants is a global table, not scoped to an event — confirm
    // this login is actually a team owner or staff member of THIS event
    // before letting this event's staff reset it, so staff for Event A
    // can't reset a login that only exists in Event B.
    const [ownedTeam] = await tx
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.eventId, params.eventId), eq(teams.ownerParticipantId, params.participantId)));
    const [staffRow] = await tx
      .select({ id: eventStaff.id })
      .from(eventStaff)
      .where(and(eq(eventStaff.eventId, params.eventId), eq(eventStaff.participantId, params.participantId)));
    const [spectatorRow] = await tx
      .select({ id: eventSpectators.id })
      .from(eventSpectators)
      .where(and(eq(eventSpectators.eventId, params.eventId), eq(eventSpectators.participantId, params.participantId)));
    if (!ownedTeam && !staffRow && !spectatorRow) throw new GameError("not_found", "Login not found.");

    const password = generatePassword();
    const passwordHash = await hashPassword(password);
    await tx.update(participants).set({ passwordHash, sessionId: null }).where(eq(participants.id, participant.id));

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actorParticipantId,
      reason: params.reason,
      isOverride: true,
      action: "login.password_reset",
      entityType: "participant",
      entityId: participant.id,
    });

    return { username: participant.username, password };
  });
}

// Staff-only: removes a staff login's access to this event and frees its
// username for reuse. This does NOT delete the underlying participants
// row — audit_log, bank_purchases.approved_by, constructed_buildings
// .verified_by, and others all reference participants.id with no
// cascade, by design (see incident-service.ts's deleteTeam comment: "the
// ledger stays a complete, honest history of what actually happened").
// Deleting the row outright would either violate those foreign keys or
// require nulling out who-did-what across the audit trail, which this
// app deliberately never does. Instead: the event_staff row is removed,
// and the login itself is renamed to a "released-..." form with an
// unusable password and no session, so the exact username string can be
// reused for a brand-new login while the old one's history stays intact
// and unreachable.
export async function deleteStaffLogin(params: {
  eventId: string;
  actorParticipantId: string;
  participantId: string;
  reason?: string;
}) {
  return runInTransaction(async (tx, queueBroadcast) => {
    await assertStaffTx(tx, params.eventId, params.actorParticipantId);

    const [staffRow] = await tx
      .select()
      .from(eventStaff)
      .where(and(eq(eventStaff.eventId, params.eventId), eq(eventStaff.participantId, params.participantId)))
      .for("update");
    if (!staffRow) throw new GameError("not_found", "Staff login not found for this event.");

    // Never let this be the move that locks everyone out of the event -
    // the bootstrap rule in createStaffLogin only reopens the "anyone can
    // claim the first slot" path to the event's original creator, who
    // may not even still have a usable login themselves.
    const allStaff = await tx.select({ id: eventStaff.id }).from(eventStaff).where(eq(eventStaff.eventId, params.eventId));
    if (allStaff.length <= 1) {
      throw new GameError("conflict", "Cannot remove the only remaining staff login for this event.");
    }

    const [participant] = await tx.select().from(participants).where(eq(participants.id, params.participantId)).for("update");
    if (!participant) throw new GameError("not_found", "Login not found.");

    await tx.delete(eventStaff).where(eq(eventStaff.id, staffRow.id));

    const releasedUsername = `released-${participant.username}-${participant.id.slice(0, 8)}`;
    const passwordHash = await hashPassword(generatePassword());
    await tx.update(participants).set({ username: releasedUsername, passwordHash, sessionId: null }).where(eq(participants.id, participant.id));

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.actorParticipantId,
      reason: params.reason,
      isOverride: true,
      action: "staff_login.deleted",
      entityType: "event_staff",
      entityId: staffRow.id,
      beforeJson: { participantId: participant.id, username: participant.username },
    });

    queueBroadcast({ eventId: params.eventId, type: "moderator.announcement", data: { removedStaffParticipantId: participant.id } });

    return { participantId: participant.id };
  });
}

// ---------------------------------------------------------------------
// Leaving a team / transferring leadership
// ---------------------------------------------------------------------
// A real operational gap, not just a security one: there was no way for
// anyone — not even a moderator — to change who leads a team, or for a
// member to leave one. Whoever clicked "Create" first was stuck as leader
// forever, and if that was the wrong person (or they can't make it to the
// event), the only fix was hand-editing the database.

export async function leaveTeam(params: { eventId: string; participantId: string }) {
  return runInTransaction(async (tx) => {
    const [membership] = await tx
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.eventId, params.eventId), eq(teamMembers.participantId, params.participantId)))
      .for("update");
    if (!membership) throw new GameError("not_found", "You are not on a team in this event.");

    if (membership.role === "leader") {
      const [otherMembers] = await tx
        .select({ id: teamMembers.id })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, membership.teamId), sql`${teamMembers.participantId} != ${params.participantId}`));
      if (otherMembers) {
        throw new GameError("conflict", "Transfer leadership to another member before leaving — a team with other members can't be left leaderless.");
      }
    }

    await tx.delete(teamMembers).where(eq(teamMembers.id, membership.id));

    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.participantId,
      action: "team.left",
      entityType: "team",
      entityId: membership.teamId,
      beforeJson: membership,
    });

    return { teamId: membership.teamId };
  });
}

export async function transferLeadership(params: {
  eventId: string;
  teamId: string;
  requesterParticipantId: string;
  newLeaderParticipantId: string;
}) {
  return runInTransaction(async (tx) => {
    // The current leader can hand off on their own; staff can do it too,
    // for exactly the recovery case this function exists for (leader is
    // unreachable, wrong person became leader, etc.).
    await assertTeamLeaderOrStaffTx(tx, params.eventId, params.teamId, params.requesterParticipantId);

    const [currentLeader] = await tx
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, params.teamId), eq(teamMembers.role, "leader")))
      .for("update");
    if (!currentLeader) throw new GameError("not_found", "This team has no current leader on record.");

    const [newLeaderMembership] = await tx
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, params.teamId), eq(teamMembers.participantId, params.newLeaderParticipantId)))
      .for("update");
    if (!newLeaderMembership) throw new GameError("not_found", "The new leader must already be a member of this team.");
    if (newLeaderMembership.id === currentLeader.id) throw new GameError("conflict", "That participant is already the leader.");

    await tx.update(teamMembers).set({ role: "member" }).where(eq(teamMembers.id, currentLeader.id));
    await tx.update(teamMembers).set({ role: "leader" }).where(eq(teamMembers.id, newLeaderMembership.id));

    const isStaffAction = params.requesterParticipantId !== currentLeader.participantId;
    await recordAudit(tx, {
      eventId: params.eventId,
      actorParticipantId: params.requesterParticipantId,
      reason: isStaffAction ? "Moderator-assisted leadership transfer." : undefined,
      isOverride: isStaffAction,
      action: "team.leadership_transferred",
      entityType: "team",
      entityId: params.teamId,
      beforeJson: { leaderParticipantId: currentLeader.participantId },
      afterJson: { leaderParticipantId: newLeaderMembership.participantId },
    });

    return { teamId: params.teamId, newLeaderParticipantId: newLeaderMembership.participantId };
  });
}
