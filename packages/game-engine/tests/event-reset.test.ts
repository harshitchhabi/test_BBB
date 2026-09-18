import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { startTestDatabase, type TestDb } from "./test-db";

let testDb: TestDb;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let engine: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let dbModule: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let schema: any;

beforeAll(async () => {
  testDb = await startTestDatabase();
  process.env.DATABASE_URL = testDb.databaseUrl;
  process.env.DB_POOL_MAX = "1";
  delete process.env.INTERNAL_BROADCAST_SECRET;

  dbModule = await import("db");
  schema = await import("db/schema");
  engine = await import("../src/index");
});

afterAll(async () => {
  await dbModule.pool.end();
  await testDb.stop();
});

describe("resetEventForNewRound", () => {
  it("wipes all runtime state but keeps materials/recipes/cities config, and a fresh round can start clean", async () => {
    const [event] = await dbModule.db.insert(schema.events).values({ name: "Reset Test", status: "lobby" }).returning();
    await dbModule.db.insert(schema.eventSettings).values({ eventId: event.id });
    const [moderator] = await dbModule.db.insert(schema.participants).values({ name: "Mod", email: `mod-${event.id}@test.local`, username: `mod-${event.id}`, passwordHash: "$2a$10$CwTycUXWue0Thq9StjUM0uJ8oxL/Yjyq6XvXqAtVvjGdiWZOWXQNi" }).returning();
    await dbModule.db.insert(schema.eventStaff).values({ eventId: event.id, participantId: moderator.id, role: "staff" });

    const [material] = await dbModule.db
      .insert(schema.materialTypes)
      .values({ eventId: event.id, key: "bricks", name: "Bricks", unitLabel: "units", stickerPrice: 1, isRare: false, isBonusOnly: false, sortOrder: 1, defaultLotQuantity: 100, defaultOpeningBid: 100 })
      .returning();
    const [recipe] = await dbModule.db.insert(schema.buildingRecipes).values({ eventId: event.id, key: "park", name: "Park", basePoints: 10 }).returning();
    const [city] = await dbModule.db.insert(schema.cities).values({ eventId: event.id, blockNumber: 1, name: "TestCity", tier: "town", openingBid: 100, hiddenMultiplier: "2.00" }).returning();

    // Play round 1: a team registers, wins a lot, builds nothing fancy —
    // just enough runtime state across enough tables to prove the wipe
    // actually reaches all of them.
    await engine.setEventStatus({ eventId: event.id, status: "stage_1", actorParticipantId: moderator.id });
    const [leader1] = await dbModule.db.insert(schema.participants).values({ name: "Leader1", email: `leader1-${event.id}@test.local`, username: `leader1-${event.id}`, passwordHash: "$2a$10$CwTycUXWue0Thq9StjUM0uJ8oxL/Yjyq6XvXqAtVvjGdiWZOWXQNi" }).returning();
    const [team1] = await dbModule.db.insert(schema.teams).values({ eventId: event.id, name: "Round1Team", code: "R1TEAM", ownerParticipantId: leader1.id }).returning();
    await dbModule.db.insert(schema.teamMembers).values({ eventId: event.id, teamId: team1.id, participantId: leader1.id, role: "leader" });

    const round = await engine.startRound({ eventId: event.id, materialTypeId: material.id, actorParticipantId: moderator.id });
    const lot = await engine.openNextLot({ eventId: event.id, roundId: round.id, actorParticipantId: moderator.id });
    await engine.placeBid({ eventId: event.id, auctionLotId: lot.id, teamId: team1.id, actingParticipantId: leader1.id, amount: 500 });
    await engine.closeLot({ eventId: event.id, auctionLotId: lot.id, actorParticipantId: moderator.id, reason: "close" });

    // Sanity: round 1 really did leave rows behind.
    expect((await dbModule.db.select().from(schema.teams).where(dbModule.eq(schema.teams.eventId, event.id))).length).toBe(1);
    expect((await dbModule.db.select().from(schema.auctionRounds).where(dbModule.eq(schema.auctionRounds.eventId, event.id))).length).toBe(1);
    expect((await dbModule.db.select().from(schema.materialLots).where(dbModule.eq(schema.materialLots.eventId, event.id))).length).toBe(1);
    expect((await dbModule.db.select().from(schema.teamInventoryTransactions).where(dbModule.eq(schema.teamInventoryTransactions.eventId, event.id))).length).toBeGreaterThan(0);

    // Simulates what every real completed round leaves behind: a city
    // actually assigned to a team. This is the exact scenario that
    // crashed in production before the fix - cities.assigned_team_id is
    // a real FK to teams.id with no cascade, so deleting a team any city
    // still points to fails outright unless the city's pointer is
    // cleared FIRST. A test that never assigns a city (as this one
    // didn't, before this line) can't catch that ordering bug at all.
    await dbModule.db.update(schema.cities).set({ assignedTeamId: team1.id, saleOrder: 1, revealState: "revealed" }).where(dbModule.eq(schema.cities.id, city.id));

    const before = await dbModule.db.select().from(schema.auditLog).where(dbModule.eq(schema.auditLog.eventId, event.id));

    const reset = await engine.resetEventForNewRound({ eventId: event.id, actorParticipantId: moderator.id, reason: "End of round 1." });
    expect(reset.status).toBe("setup");

    // Runtime tables, scoped by event_id: empty.
    for (const table of [
      schema.teams,
      schema.teamMembers,
      schema.auctionRounds,
      schema.auctionLots,
      schema.materialLots,
      schema.teamInventoryTransactions,
      schema.trades,
      schema.constructedBuildings,
    ]) {
      const rows = await dbModule.db.select().from(table).where(dbModule.eq(table.eventId, event.id));
      expect(rows.length).toBe(0);
    }
    // bids has no event_id column of its own — it cascaded from
    // auction_rounds (already confirmed empty above), and this test's
    // only source of bids was round 1's single bid, so a global count is
    // an honest check here.
    expect((await dbModule.db.select().from(schema.bids)).length).toBe(0);

    // Config: untouched.
    const [materialStill] = await dbModule.db.select().from(schema.materialTypes).where(dbModule.eq(schema.materialTypes.id, material.id));
    expect(materialStill).toBeDefined();
    const [recipeStill] = await dbModule.db.select().from(schema.buildingRecipes).where(dbModule.eq(schema.buildingRecipes.id, recipe.id));
    expect(recipeStill).toBeDefined();
    const [cityStill] = await dbModule.db.select().from(schema.cities).where(dbModule.eq(schema.cities.id, city.id));
    expect(cityStill).toBeDefined();
    expect(cityStill.assignedTeamId).toBeNull();
    expect(cityStill.hiddenMultiplier).toBe("2.00"); // not re-shuffled

    // Audit log: preserved, plus the reset itself is now on record.
    const after = await dbModule.db.select().from(schema.auditLog).where(dbModule.eq(schema.auditLog.eventId, event.id));
    expect(after.length).toBe(before.length + 1);

    // Round 1's team owner login is released, not left permanently taken -
    // same reasoning as deleteTeam's owner-release. Without this, a
    // moderator running back-to-back rounds could never reuse the exact
    // same team usernames for the next round, which defeats the whole
    // point of resetting on the same event id instead of creating a new
    // event.
    const [releasedLeader1] = await dbModule.db.select().from(schema.participants).where(dbModule.eq(schema.participants.id, leader1.id));
    expect(releasedLeader1).toBeDefined();
    expect(releasedLeader1.username).toMatch(/^released-/);
    expect(releasedLeader1.sessionId).toBeNull();

    // Round 2 can now start completely clean: a new team, using the same
    // event id/link, same material config, and even the EXACT SAME
    // username round 1's team used (proving it was really released, not
    // just renamed to something that merely looks free).
    await engine.setEventStatus({ eventId: event.id, status: "lobby", actorParticipantId: moderator.id });
    const round1Username = leader1.username;
    const [leader2] = await dbModule.db.insert(schema.participants).values({ name: "Leader2", email: `leader2-${event.id}@test.local`, username: round1Username, passwordHash: "$2a$10$CwTycUXWue0Thq9StjUM0uJ8oxL/Yjyq6XvXqAtVvjGdiWZOWXQNi" }).returning();
    const team2 = await engine.createTeam({ eventId: event.id, ownerParticipantId: leader2.id, name: "Round2Team" });
    const [settingsRow] = await dbModule.db.select().from(schema.eventSettings).where(dbModule.eq(schema.eventSettings.eventId, event.id));
    expect(team2.auctionTokens).toBe(settingsRow.stage1StartingTokens); // fresh starting balance, not round 1's leftover

    await engine.setEventStatus({ eventId: event.id, status: "stage_1", actorParticipantId: moderator.id });
    const round2 = await engine.startRound({ eventId: event.id, materialTypeId: material.id, actorParticipantId: moderator.id });
    expect(round2.sequence).toBe(1); // sequence restarted, not continuing from round 1's rounds
  });

  it("requires staff status, but no longer requires a typed reason", async () => {
    const [event] = await dbModule.db.insert(schema.events).values({ name: "Reset Auth Test" }).returning();
    const [moderator] = await dbModule.db.insert(schema.participants).values({ name: "Mod", email: `mod2-${event.id}@test.local`, username: `mod2-${event.id}`, passwordHash: "$2a$10$CwTycUXWue0Thq9StjUM0uJ8oxL/Yjyq6XvXqAtVvjGdiWZOWXQNi" }).returning();
    await dbModule.db.insert(schema.eventStaff).values({ eventId: event.id, participantId: moderator.id, role: "staff" });
    const [randomPerson] = await dbModule.db.insert(schema.participants).values({ name: "Random", email: `random-${event.id}@test.local`, username: `random-${event.id}`, passwordHash: "$2a$10$CwTycUXWue0Thq9StjUM0uJ8oxL/Yjyq6XvXqAtVvjGdiWZOWXQNi" }).returning();

    await expect(
      engine.resetEventForNewRound({ eventId: event.id, actorParticipantId: randomPerson.id, reason: "test" }),
    ).rejects.toMatchObject({ code: "forbidden" });

    // A blank reason no longer blocks the reset - just logged with a
    // clear placeholder.
    const reset = await engine.resetEventForNewRound({ eventId: event.id, actorParticipantId: moderator.id, reason: "" });
    expect(reset.status).toBe("setup");
    const [entry] = await dbModule.db
      .select()
      .from(schema.auditLog)
      .where(dbModule.and(dbModule.eq(schema.auditLog.eventId, event.id), dbModule.eq(schema.auditLog.action, "event.reset_for_new_round")));
    expect(entry.reason).toBe("No reason given");
  });
});
