// Minimal game-state fixture for the auction-service tests — deliberately
// NOT the full rulebook seed from packages/db/seed/run.ts (that's Phase 0's
// event-configuration content and isn't meant to be imported as a library:
// it calls process.exit). This creates just enough state — one event in
// Stage 1, one material type, a moderator, and two teams with leaders — to
// exercise the auction mechanics in isolation.
import type { db as DbType } from "db";
import { events, eventSettings, eventStaff, teams, teamMembers, participants, materialTypes } from "db/schema";

export async function createTestFixture(db: typeof DbType) {
  const [event] = await db.insert(events).values({ name: "Test Event", status: "stage_1" }).returning();
  await db.insert(eventSettings).values({ eventId: event.id });

  const [moderator] = await db
    .insert(participants)
    .values({ name: "Mod", email: `mod-${event.id}@test.local` })
    .returning();
  await db.insert(eventStaff).values({ eventId: event.id, participantId: moderator.id, role: "moderator" });

  const [material] = await db
    .insert(materialTypes)
    .values({
      eventId: event.id,
      key: "bricks",
      name: "Bricks",
      unitLabel: "units",
      stickerPrice: 1,
      isRare: false,
      isBonusOnly: false,
      sortOrder: 1,
      defaultLotQuantity: 600,
      defaultOpeningBid: 600,
    })
    .returning();

  async function createTeamWithLeader(name: string, auctionTokens: number) {
    const [leader] = await db
      .insert(participants)
      .values({ name: `${name} Leader`, email: `${name.toLowerCase()}-${event.id}@test.local` })
      .returning();
    const [member] = await db
      .insert(participants)
      .values({ name: `${name} Member`, email: `${name.toLowerCase()}-member-${event.id}@test.local` })
      .returning();
    const [team] = await db
      .insert(teams)
      .values({ eventId: event.id, name, code: name.toUpperCase().slice(0, 6), ownerParticipantId: leader.id, auctionTokens, cityWalletTokens: 500 })
      .returning();
    await db.insert(teamMembers).values({ eventId: event.id, teamId: team.id, participantId: leader.id, role: "leader" });
    await db.insert(teamMembers).values({ eventId: event.id, teamId: team.id, participantId: member.id, role: "member" });
    return { team, leader, member };
  }

  const teamA = await createTeamWithLeader("TeamA", 1000);
  const teamB = await createTeamWithLeader("TeamB", 1000);

  return { event, moderator, material, teamA, teamB };
}
