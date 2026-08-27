import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { startTestDatabase, type TestDb } from "./test-db";
import { createTestFixture } from "./fixtures";
import { createStage3Fixture } from "./stage3-fixtures";

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

describe("Manual correction rehearsal scenarios (Section 10 / CONTINGENCIES)", () => {
  it("voids a bidder who can't pay, then reopens the same lot for a fresh sale", async () => {
    const { event, moderator, material, teamA, teamB } = await createTestFixture(dbModule.db);
    const round = await engine.startRound({ eventId: event.id, materialTypeId: material.id, actorParticipantId: moderator.id });
    const lot = await engine.openNextLot({ eventId: event.id, roundId: round.id, actorParticipantId: moderator.id });
    await engine.placeBid({ eventId: event.id, auctionLotId: lot.id, teamId: teamA.team.id, actingParticipantId: teamA.leader.id, amount: 650 });

    // Simulate "can't actually pay": drain the team's tokens below the
    // bid amount before close, exactly like a moderator discovering a
    // payment problem.
    await dbModule.db.update(schema.teams).set({ auctionTokens: 0 }).where(dbModule.eq(schema.teams.id, teamA.team.id));

    const closeResult = await engine.closeLot({ eventId: event.id, auctionLotId: lot.id, actorParticipantId: moderator.id, reason: "close" });
    expect(closeResult.winnerTeamId).toBeNull();

    const [unsoldLot] = await dbModule.db.select().from(schema.auctionLots).where(dbModule.eq(schema.auctionLots.id, lot.id));
    expect(unsoldLot.status).toBe("unsold");

    // Moderator re-offers the lot immediately.
    const reopened = await engine.reopenLot({ eventId: event.id, auctionLotId: lot.id, actorParticipantId: moderator.id, reason: "Re-offering after non-payment." });
    expect(reopened.status).toBe("live");

    // teamB can now win it cleanly.
    await engine.placeBid({ eventId: event.id, auctionLotId: lot.id, teamId: teamB.team.id, actingParticipantId: teamB.leader.id, amount: 650 });
    const secondClose = await engine.closeLot({ eventId: event.id, auctionLotId: lot.id, actorParticipantId: moderator.id, reason: "close" });
    expect(secondClose.winnerTeamId).toBe(teamB.team.id);
  });

  it("reverses a fully-settled sale when reopened: refunds tokens and reverses the inventory credit", async () => {
    const { event, moderator, material, teamA, teamB } = await createTestFixture(dbModule.db);
    const round = await engine.startRound({ eventId: event.id, materialTypeId: material.id, actorParticipantId: moderator.id });
    const lot = await engine.openNextLot({ eventId: event.id, roundId: round.id, actorParticipantId: moderator.id });
    await engine.placeBid({ eventId: event.id, auctionLotId: lot.id, teamId: teamA.team.id, actingParticipantId: teamA.leader.id, amount: 650 });
    await engine.closeLot({ eventId: event.id, auctionLotId: lot.id, actorParticipantId: moderator.id, reason: "close" });

    const [teamAAfterWin] = await dbModule.db.select().from(schema.teams).where(dbModule.eq(schema.teams.id, teamA.team.id));
    expect(teamAAfterWin.auctionTokens).toBe(1000 - 650);

    await engine.reopenLot({ eventId: event.id, auctionLotId: lot.id, actorParticipantId: moderator.id, reason: "Discovered a scoring dispute; re-running this lot." });

    const [teamARefunded] = await dbModule.db.select().from(schema.teams).where(dbModule.eq(schema.teams.id, teamA.team.id));
    expect(teamARefunded.auctionTokens).toBe(1000); // fully refunded

    const inventoryRows = await dbModule.db
      .select()
      .from(schema.teamInventoryTransactions)
      .where(dbModule.and(dbModule.eq(schema.teamInventoryTransactions.teamId, teamA.team.id), dbModule.eq(schema.teamInventoryTransactions.materialTypeId, material.id)));
    const netQuantity = inventoryRows.reduce((sum: number, r: any) => sum + r.quantityDelta, 0);
    expect(netQuantity).toBe(0); // the original credit and its reversal cancel out, both still on record
    expect(inventoryRows).toHaveLength(2);

    const [materialLotRow] = await dbModule.db.select().from(schema.materialLots).where(dbModule.eq(schema.materialLots.id, lot.materialLotId));
    expect(materialLotRow.status).toBe("auctioning");
    expect(materialLotRow.ownerTeamId).toBeNull();
  });

  it("withdrawing a team mid-auction voids its in-flight winning bid instead of letting it settle", async () => {
    const { event, moderator, material, teamA, teamB } = await createTestFixture(dbModule.db);
    const round = await engine.startRound({ eventId: event.id, materialTypeId: material.id, actorParticipantId: moderator.id });
    const lot = await engine.openNextLot({ eventId: event.id, roundId: round.id, actorParticipantId: moderator.id });
    await engine.placeBid({ eventId: event.id, auctionLotId: lot.id, teamId: teamA.team.id, actingParticipantId: teamA.leader.id, amount: 650 });

    await engine.setTeamStatus({ eventId: event.id, teamId: teamA.team.id, status: "withdrawn", actorParticipantId: moderator.id, reason: "Team left the event." });

    const closeResult = await engine.closeLot({ eventId: event.id, auctionLotId: lot.id, actorParticipantId: moderator.id, reason: "close" });
    expect(closeResult.winnerTeamId).toBeNull(); // withdrawn team's bid never settles

    const [teamARow] = await dbModule.db.select().from(schema.teams).where(dbModule.eq(schema.teams.id, teamA.team.id));
    expect(teamARow.status).toBe("withdrawn");
    expect(teamARow.auctionTokens).toBe(1000); // never charged
  });

  it("releases a withdrawn team's city so scoring only counts remaining teams", async () => {
    const { event, moderator, cities, teamA } = await createStage3Fixture(dbModule.db);
    await dbModule.db.update(schema.cities).set({ assignedTeamId: teamA.team.id, saleOrder: 1 }).where(dbModule.eq(schema.cities.id, cities.metroCity.id));

    const result = await engine.setTeamStatus({ eventId: event.id, teamId: teamA.team.id, status: "withdrawn", actorParticipantId: moderator.id, reason: "Dropped out." });
    expect(result.releasedCityId).toBe(cities.metroCity.id);

    const [releasedCity] = await dbModule.db.select().from(schema.cities).where(dbModule.eq(schema.cities.id, cities.metroCity.id));
    expect(releasedCity.assignedTeamId).toBeNull();
  });

  it("adjusts a team's balance with a mandatory reason, and refuses to push it negative", async () => {
    const { event, moderator, teamA } = await createTestFixture(dbModule.db);

    const adjusted = await engine.adjustTeamTokens({ eventId: event.id, teamId: teamA.team.id, auctionTokensDelta: -50, actorParticipantId: moderator.id, reason: "Correcting a bank overpayment dispute." });
    expect(adjusted.auctionTokens).toBe(950);

    await expect(
      engine.adjustTeamTokens({ eventId: event.id, teamId: teamA.team.id, auctionTokensDelta: -100000, actorParticipantId: moderator.id, reason: "test" }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("rejects every incident action from a non-staff participant", async () => {
    const { event, teamA } = await createTestFixture(dbModule.db);
    await expect(
      engine.setTeamStatus({ eventId: event.id, teamId: teamA.team.id, status: "withdrawn", actorParticipantId: teamA.member.id, reason: "x" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      engine.adjustTeamTokens({ eventId: event.id, teamId: teamA.team.id, auctionTokensDelta: 1, actorParticipantId: teamA.member.id, reason: "x" }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("Event staff bootstrap", () => {
  it("lets anyone add the FIRST staff member, then requires existing staff for every one after", async () => {
    const [event] = await dbModule.db.insert(schema.events).values({ name: "Bootstrap Test" }).returning();
    const [organizer] = await dbModule.db.insert(schema.participants).values({ name: "Organizer", email: `organizer-${event.id}@test.local` }).returning();
    const [randomPerson] = await dbModule.db.insert(schema.participants).values({ name: "Random", email: `random-${event.id}@test.local` }).returning();
    const [secondMod] = await dbModule.db.insert(schema.participants).values({ name: "SecondMod", email: `secondmod-${event.id}@test.local` }).returning();

    // Nobody is staff yet — the very first add succeeds for anyone.
    const first = await engine.addEventStaff({ eventId: event.id, requesterParticipantId: randomPerson.id, targetEmail: organizer.email, role: "moderator" });
    expect(first.participantId).toBe(organizer.id);

    // Now that staff exists, a non-staff requester is refused...
    await expect(
      engine.addEventStaff({ eventId: event.id, requesterParticipantId: randomPerson.id, targetEmail: secondMod.email, role: "moderator" }),
    ).rejects.toMatchObject({ code: "forbidden" });

    // ...but the organizer (now staff) can add someone else.
    const second = await engine.addEventStaff({ eventId: event.id, requesterParticipantId: organizer.id, targetEmail: secondMod.email, role: "moderator" });
    expect(second.participantId).toBe(secondMod.id);
  });
});
