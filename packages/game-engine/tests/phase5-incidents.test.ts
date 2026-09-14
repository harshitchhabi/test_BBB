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

describe("voidBid cross-event authorization", () => {
  it("refuses to void a bid that belongs to a different event, even for valid staff of the caller's own event", async () => {
    const eventA = await createTestFixture(dbModule.db);
    const eventB = await createTestFixture(dbModule.db);

    const round = await engine.startRound({ eventId: eventB.event.id, materialTypeId: eventB.material.id, actorParticipantId: eventB.moderator.id });
    const lot = await engine.openNextLot({ eventId: eventB.event.id, roundId: round.id, actorParticipantId: eventB.moderator.id });
    const bid = await engine.placeBid({ eventId: eventB.event.id, auctionLotId: lot.id, teamId: eventB.teamA.team.id, actingParticipantId: eventB.teamA.leader.id, amount: 650 });

    // eventA's own moderator is legitimately staff — just not of eventB.
    // The bid it's trying to void has no eventId column of its own (only
    // auctionLotId), so this only stays safe if voidBid actually joins
    // through to the lot and checks its event.
    await expect(
      engine.voidBid({ eventId: eventA.event.id, bidId: bid.bid.id, actorParticipantId: eventA.moderator.id, reason: "cross-event probe" }),
    ).rejects.toMatchObject({ code: "not_found" });

    // The bid is untouched — voiding through the CORRECT event still works.
    const stillWinning = await engine.voidBid({ eventId: eventB.event.id, bidId: bid.bid.id, actorParticipantId: eventB.moderator.id, reason: "legitimate void" });
    expect(stillWinning.status).toBe("voided");
  });

  it("refuses to reset a login that belongs to a different event", async () => {
    const eventA = await createTestFixture(dbModule.db);
    const eventB = await createTestFixture(dbModule.db);

    // eventA's own staff is legitimate staff — just not of eventB, whose
    // team leader (teamA.leader, a global `participants` row) it's
    // trying to reset the password for.
    await expect(
      engine.resetLoginPassword({ eventId: eventA.event.id, actorParticipantId: eventA.moderator.id, participantId: eventB.teamA.leader.id, reason: "cross-event probe" }),
    ).rejects.toMatchObject({ code: "not_found" });

    // The correct event's own staff can still reset it.
    const reset = await engine.resetLoginPassword({ eventId: eventB.event.id, actorParticipantId: eventB.moderator.id, participantId: eventB.teamA.leader.id, reason: "legitimate reset" });
    expect(reset.username).toBe(eventB.teamA.leader.username);
  });
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
  const testPasswordHash = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8oxL/Yjyq6XvXqAtVvjGdiWZOWXQNi";

  it("when created_by is set, only that participant can claim the first staff slot", async () => {
    const [organizer] = await dbModule.db
      .insert(schema.participants)
      .values({ name: "Organizer", username: `organizer-${Date.now()}`, passwordHash: testPasswordHash })
      .returning();
    const [randomPerson] = await dbModule.db
      .insert(schema.participants)
      .values({ name: "Random", username: `random-${Date.now()}`, passwordHash: testPasswordHash })
      .returning();
    const [event] = await dbModule.db.insert(schema.events).values({ name: "Bootstrap Test (locked)", createdBy: organizer.id }).returning();

    // A random participant can no longer grab the first slot just by
    // getting there first — this is the loophole being closed.
    await expect(
      engine.createStaffLogin({ eventId: event.id, actorParticipantId: randomPerson.id, name: "Should fail", username: `nope-${Date.now()}` }),
    ).rejects.toMatchObject({ code: "forbidden" });

    // The actual creator can claim it — this mints the first staff login
    // (a brand-new participant; createStaffLogin never promotes the
    // caller's own identity, it always creates one).
    const first = await engine.createStaffLogin({ eventId: event.id, actorParticipantId: organizer.id, name: "First Mod", username: `firstmod-${Date.now()}` });
    expect(first.staffRow.eventId).toBe(event.id);

    // Now that staff exists, a non-staff requester is refused, including
    // the organizer themselves — created_by only ever gates the FIRST
    // claim; organizer.id itself was never added to event_staff.
    await expect(
      engine.createStaffLogin({ eventId: event.id, actorParticipantId: randomPerson.id, name: "Second Mod", username: `secondmod-a-${Date.now()}` }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      engine.createStaffLogin({ eventId: event.id, actorParticipantId: organizer.id, name: "Second Mod", username: `secondmod-b-${Date.now()}` }),
    ).rejects.toMatchObject({ code: "forbidden" });

    // ...but the first staff login (now signed in as itself) can add
    // someone else.
    const second = await engine.createStaffLogin({
      eventId: event.id,
      actorParticipantId: first.staffRow.participantId,
      name: "Second Mod",
      username: `secondmod-c-${Date.now()}`,
    });
    expect(second.staffRow.eventId).toBe(event.id);
    expect(second.staffRow.participantId).not.toBe(first.staffRow.participantId);
  });

  it("without created_by, falls back to first-come-first-served (the documented dev-only escape hatch)", async () => {
    const [event] = await dbModule.db.insert(schema.events).values({ name: "Bootstrap Test (open)" }).returning();
    const [randomPerson] = await dbModule.db
      .insert(schema.participants)
      .values({ name: "Random", username: `random2-${Date.now()}`, passwordHash: testPasswordHash })
      .returning();

    const first = await engine.createStaffLogin({ eventId: event.id, actorParticipantId: randomPerson.id, name: "First Mod", username: `openmod-${Date.now()}` });
    expect(first.staffRow.eventId).toBe(event.id);
  });
});

describe("deleteStaffLogin", () => {
  it("removes the event_staff row and releases the username, but keeps the participant/audit trail", async () => {
    const { event, moderator } = await createTestFixture(dbModule.db);
    const second = await engine.createStaffLogin({ eventId: event.id, actorParticipantId: moderator.id, name: "Second Mod", username: `second-${event.id.slice(0, 8)}` });

    const removed = await engine.deleteStaffLogin({ eventId: event.id, actorParticipantId: moderator.id, participantId: second.staffRow.participantId, reason: "No longer needed" });
    expect(removed.participantId).toBe(second.staffRow.participantId);

    // event_staff row is gone - this login is no longer staff.
    const [staffRowAfter] = await dbModule.db.select().from(schema.eventStaff).where(dbModule.eq(schema.eventStaff.id, second.staffRow.id));
    expect(staffRowAfter).toBeUndefined();

    // The username is released (renamed + unusable), but the participant
    // row itself still exists - same reasoning as deleteTeam's owner
    // release.
    const [participantAfter] = await dbModule.db.select().from(schema.participants).where(dbModule.eq(schema.participants.id, second.staffRow.participantId));
    expect(participantAfter).toBeDefined();
    expect(participantAfter.username).toMatch(/^released-/);
    expect(participantAfter.sessionId).toBeNull();

    // The freed username can now be reused by a brand-new login.
    const reused = await engine.createStaffLogin({ eventId: event.id, actorParticipantId: moderator.id, name: "Reused Name", username: `second-${event.id.slice(0, 8)}` });
    expect(reused.username).toBe(`second-${event.id.slice(0, 8)}`);
  });

  it("refuses to remove the only remaining staff login for an event", async () => {
    const { event, moderator } = await createTestFixture(dbModule.db);
    await expect(
      engine.deleteStaffLogin({ eventId: event.id, actorParticipantId: moderator.id, participantId: moderator.id, reason: "trying to self-lockout" }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("requires staff status, but no longer requires a typed reason", async () => {
    const { event, moderator, teamA } = await createTestFixture(dbModule.db);
    const second = await engine.createStaffLogin({ eventId: event.id, actorParticipantId: moderator.id, name: "Second Mod", username: `second2-${event.id.slice(0, 8)}` });

    await expect(
      engine.deleteStaffLogin({ eventId: event.id, actorParticipantId: teamA.member.id, participantId: second.staffRow.participantId, reason: "x" }),
    ).rejects.toMatchObject({ code: "forbidden" });

    const removed = await engine.deleteStaffLogin({ eventId: event.id, actorParticipantId: moderator.id, participantId: second.staffRow.participantId, reason: "" });
    expect(removed.participantId).toBe(second.staffRow.participantId);
  });
});
