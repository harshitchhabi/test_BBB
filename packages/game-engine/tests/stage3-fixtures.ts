import type { db as DbType } from "db";
import { events, eventSettings, eventStaff, teams, teamMembers, participants, cities } from "db/schema";

export async function createStage3Fixture(db: typeof DbType, opts?: { advancedCityScoringEnabled?: boolean; leftoverScoringEnabled?: boolean }) {
  const [event] = await db.insert(events).values({ name: "Stage 3 Test Event", status: "stage_3" }).returning();
  await db.insert(eventSettings).values({
    eventId: event.id,
    advancedCityScoringEnabled: opts?.advancedCityScoringEnabled ?? false,
    leftoverScoringEnabled: opts?.leftoverScoringEnabled ?? false,
  });

  const [moderator] = await db.insert(participants).values({ name: "Mod", email: `mod-${event.id}@test.local`, username: `mod-${event.id}`, passwordHash: "$2a$10$CwTycUXWue0Thq9StjUM0uJ8oxL/Yjyq6XvXqAtVvjGdiWZOWXQNi" }).returning();
  await db.insert(eventStaff).values({ eventId: event.id, participantId: moderator.id, role: "staff" });

  const [metroCity] = await db
    .insert(cities)
    .values({ eventId: event.id, blockNumber: 1, name: "TestMetro", tier: "metro", openingBid: 400, hiddenMultiplier: "3.50" })
    .returning();
  const [townCity] = await db
    .insert(cities)
    .values({ eventId: event.id, blockNumber: 1, name: "TestTown", tier: "town", openingBid: 100, hiddenMultiplier: "1.50" })
    .returning();

  async function createTeamWithLeader(name: string, auctionTokens: number, cityWalletTokens: number) {
    const [leader] = await db
      .insert(participants)
      .values({ name: `${name} Leader`, email: `${name.toLowerCase()}-${event.id}@test.local`, username: `${name.toLowerCase()}-leader-${event.id}`, passwordHash: "$2a$10$CwTycUXWue0Thq9StjUM0uJ8oxL/Yjyq6XvXqAtVvjGdiWZOWXQNi" })
      .returning();
    const [member] = await db
      .insert(participants)
      .values({ name: `${name} Member`, email: `${name.toLowerCase()}-member-${event.id}@test.local`, username: `${name.toLowerCase()}-member-${event.id}`, passwordHash: "$2a$10$CwTycUXWue0Thq9StjUM0uJ8oxL/Yjyq6XvXqAtVvjGdiWZOWXQNi" })
      .returning();
    const [team] = await db
      .insert(teams)
      .values({ eventId: event.id, name, code: name.toUpperCase().slice(0, 6), ownerParticipantId: leader.id, auctionTokens, cityWalletTokens })
      .returning();
    await db.insert(teamMembers).values({ eventId: event.id, teamId: team.id, participantId: leader.id, role: "leader" });
    await db.insert(teamMembers).values({ eventId: event.id, teamId: team.id, participantId: member.id, role: "member" });
    return { team, leader, member };
  }

  const teamA = await createTeamWithLeader("TeamA", 200, 500);
  const teamB = await createTeamWithLeader("TeamB", 200, 500);

  return { event, moderator, cities: { metroCity, townCity }, teamA, teamB };
}
