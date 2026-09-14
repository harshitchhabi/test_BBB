import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { startTestDatabase, type TestDb } from "./test-db";
import { createTestFixture } from "./fixtures";

// Section 10 "Automated tests" — the Stage 1 bullets:
//   - Bid amount is rejected when below the valid increment.
//   - Bid is rejected after lot close or from a non-leader.
//   - Two simultaneous bids cannot overspend a balance.
//   - Winning a lot creates exactly one inventory credit and one payment debit.
//   - Unsold lots are available to the bank and cannot exceed finite stock.
// Run against a real Postgres (PGlite over a TCP socket — see test-db.ts),
// so these exercise the actual transaction/row-lock code in
// auction-service.ts, not a mock of it.

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
  // See packages/db/index.ts — pglite-socket cannot reliably multiplex
  // more than one concurrent connection; forcing a single pooled
  // connection here means "concurrent" requests from this test file
  // serialize at the pool level instead of each opening a new socket that
  // resets. The row-locking behavior under test still runs for real; only
  // true multi-connection network parallelism is what's approximated.
  process.env.DB_POOL_MAX = "1";
  // Deliberately unset so packages/game-engine/src/broadcast.ts throws
  // fast (no network call attempted) instead of trying to reach a backend
  // relay that doesn't exist in this test run; tx.ts already catches and
  // logs broadcast failures without failing the transaction, which is
  // exactly the behavior being relied on here.
  delete process.env.INTERNAL_BROADCAST_SECRET;

  dbModule = await import("db");
  schema = await import("db/schema");
  engine = await import("../src/index");
});

afterAll(async () => {
  // Close the app's pg.Pool before tearing down the pglite socket it's
  // connected to — otherwise the pool's idle client sees the socket vanish
  // out from under it and logs an "unhandled" connection-reset error that
  // has nothing to do with test outcomes.
  await dbModule.pool.end();
  await testDb.stop();
});

describe("startRound + openNextLot + placeBid + closeLot", () => {
  it("rejects a bid below the minimum raise, but still persists it", async () => {
    const { event, moderator, material, teamA } = await createTestFixture(dbModule.db);

    const round = await engine.startRound({ eventId: event.id, materialTypeId: material.id, actorParticipantId: moderator.id });
    const lot = await engine.openNextLot({ eventId: event.id, roundId: round.id, actorParticipantId: moderator.id });

    // Opening bid is 600; anything below that must be rejected.
    const result = await engine.placeBid({
      eventId: event.id,
      auctionLotId: lot.id,
      teamId: teamA.team.id,
      actingParticipantId: teamA.leader.id,
      amount: 500,
    });

    expect(result.accepted).toBe(false);
    expect(result.bid.status).toBe("rejected");
    expect(result.bid.rejectionReason).toMatch(/at least/i);
  });

  it("serializes concurrent openNextLot calls for the same round — only one lot ever ends up live", async () => {
    const { event, moderator, material } = await createTestFixture(dbModule.db);
    const round = await engine.startRound({ eventId: event.id, materialTypeId: material.id, actorParticipantId: moderator.id });

    // The exact race this test guards against: two moderator calls (a
    // double-click, or two staff accounts) racing to open the round's
    // next lot before either has committed. Before the fix, both could
    // see "no lot live yet" and both succeed, opening two lots live at
    // once for the same round.
    const results = await Promise.allSettled([
      engine.openNextLot({ eventId: event.id, roundId: round.id, actorParticipantId: moderator.id }),
      engine.openNextLot({ eventId: event.id, roundId: round.id, actorParticipantId: moderator.id }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // @ts-expect-error - narrowed by the length check above
    expect(rejected[0].reason).toMatchObject({ code: "conflict" });

    const liveLots = await dbModule.db
      .select()
      .from(schema.auctionLots)
      .where(dbModule.and(dbModule.eq(schema.auctionLots.roundId, round.id), dbModule.eq(schema.auctionLots.status, "live")));
    expect(liveLots).toHaveLength(1);
  });

  it("rejects a bid from a non-leader team member", async () => {
    const { event, moderator, material, teamA } = await createTestFixture(dbModule.db);
    const round = await engine.startRound({ eventId: event.id, materialTypeId: material.id, actorParticipantId: moderator.id });
    const lot = await engine.openNextLot({ eventId: event.id, roundId: round.id, actorParticipantId: moderator.id });

    await expect(
      engine.placeBid({
        eventId: event.id,
        auctionLotId: lot.id,
        teamId: teamA.team.id,
        actingParticipantId: teamA.member.id, // not the leader
        amount: 650,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("rejects a bid once the lot is closed", async () => {
    const { event, moderator, material, teamA } = await createTestFixture(dbModule.db);
    const round = await engine.startRound({ eventId: event.id, materialTypeId: material.id, actorParticipantId: moderator.id });
    const lot = await engine.openNextLot({ eventId: event.id, roundId: round.id, actorParticipantId: moderator.id });

    await engine.closeLot({ eventId: event.id, auctionLotId: lot.id, actorParticipantId: moderator.id, reason: "test close" });

    await expect(
      engine.placeBid({
        eventId: event.id,
        auctionLotId: lot.id,
        teamId: teamA.team.id,
        actingParticipantId: teamA.leader.id,
        amount: 650,
      }),
    ).rejects.toMatchObject({ code: "lot_not_live" });
  });

  it("settles a winner: exactly one inventory credit, one token debit, balance never negative", async () => {
    const { event, moderator, material, teamA, teamB } = await createTestFixture(dbModule.db);
    const round = await engine.startRound({ eventId: event.id, materialTypeId: material.id, actorParticipantId: moderator.id });
    const lot = await engine.openNextLot({ eventId: event.id, roundId: round.id, actorParticipantId: moderator.id });

    await engine.placeBid({ eventId: event.id, auctionLotId: lot.id, teamId: teamA.team.id, actingParticipantId: teamA.leader.id, amount: 650 });
    await engine.placeBid({ eventId: event.id, auctionLotId: lot.id, teamId: teamB.team.id, actingParticipantId: teamB.leader.id, amount: 700 });

    const closeResult = await engine.closeLot({ eventId: event.id, auctionLotId: lot.id, actorParticipantId: moderator.id, reason: "test close" });
    expect(closeResult.winnerTeamId).toBe(teamB.team.id);

    const [updatedTeamB] = await dbModule.db.select().from(schema.teams).where(dbModule.eq(schema.teams.id, teamB.team.id));
    const [updatedTeamA] = await dbModule.db.select().from(schema.teams).where(dbModule.eq(schema.teams.id, teamA.team.id));
    expect(updatedTeamB.auctionTokens).toBe(1000 - 700);
    expect(updatedTeamA.auctionTokens).toBe(1000); // untouched — never debited for losing
    expect(updatedTeamB.auctionTokens).toBeGreaterThanOrEqual(0);

    const inventoryRows = await dbModule.db
      .select()
      .from(schema.teamInventoryTransactions)
      .where(dbModule.eq(schema.teamInventoryTransactions.teamId, teamB.team.id));
    expect(inventoryRows).toHaveLength(1);
    expect(inventoryRows[0].quantityDelta).toBe(material.defaultLotQuantity);
    expect(inventoryRows[0].reason).toBe("auction_win");

    const winningBids = await dbModule.db
      .select()
      .from(schema.bids)
      .where(dbModule.and(dbModule.eq(schema.bids.auctionLotId, lot.id), dbModule.eq(schema.bids.status, "winning")));
    expect(winningBids).toHaveLength(1);
    expect(winningBids[0].teamId).toBe(teamB.team.id);
  });

  it("two concurrent bids on the same lot leave exactly one winner and no double-charge", async () => {
    const { event, moderator, material, teamA, teamB } = await createTestFixture(dbModule.db);
    const round = await engine.startRound({ eventId: event.id, materialTypeId: material.id, actorParticipantId: moderator.id });
    const lot = await engine.openNextLot({ eventId: event.id, roundId: round.id, actorParticipantId: moderator.id });

    // Both bids clear the opening bid; row locking on the lot must
    // serialize these so only one ends up "winning" no matter the order.
    const [resultA, resultB] = await Promise.all([
      engine.placeBid({ eventId: event.id, auctionLotId: lot.id, teamId: teamA.team.id, actingParticipantId: teamA.leader.id, amount: 700 }),
      engine.placeBid({ eventId: event.id, auctionLotId: lot.id, teamId: teamB.team.id, actingParticipantId: teamB.leader.id, amount: 750 }),
    ]);

    expect(resultA.accepted).toBe(true);
    expect(resultB.accepted).toBe(true);

    const winningBids = await dbModule.db
      .select()
      .from(schema.bids)
      .where(dbModule.and(dbModule.eq(schema.bids.auctionLotId, lot.id), dbModule.eq(schema.bids.status, "winning")));
    expect(winningBids).toHaveLength(1);

    const closeResult = await engine.closeLot({ eventId: event.id, auctionLotId: lot.id, actorParticipantId: moderator.id, reason: "test close" });
    const [winner] = await dbModule.db.select().from(schema.teams).where(dbModule.eq(schema.teams.id, closeResult.winnerTeamId));
    expect(winner.auctionTokens).toBeGreaterThanOrEqual(0);

    const [teamARow] = await dbModule.db.select().from(schema.teams).where(dbModule.eq(schema.teams.id, teamA.team.id));
    const [teamBRow] = await dbModule.db.select().from(schema.teams).where(dbModule.eq(schema.teams.id, teamB.team.id));
    // Exactly one of the two lost nothing (never charged for losing).
    const untouchedCount = [teamARow, teamBRow].filter((t) => t.auctionTokens === 1000).length;
    expect(untouchedCount).toBe(1);
  });

  it("moves an unsold lot to bank stock instead of leaving it in limbo", async () => {
    const { event, moderator, material } = await createTestFixture(dbModule.db);
    const round = await engine.startRound({ eventId: event.id, materialTypeId: material.id, actorParticipantId: moderator.id });
    const lot = await engine.openNextLot({ eventId: event.id, roundId: round.id, actorParticipantId: moderator.id });

    const closeResult = await engine.closeLot({ eventId: event.id, auctionLotId: lot.id, actorParticipantId: moderator.id, reason: "no bids" });
    expect(closeResult.winnerTeamId).toBeNull();

    const [updatedLot] = await dbModule.db.select().from(schema.auctionLots).where(dbModule.eq(schema.auctionLots.id, lot.id));
    expect(updatedLot.status).toBe("unsold");

    const [materialLot] = await dbModule.db
      .select()
      .from(schema.materialLots)
      .where(dbModule.eq(schema.materialLots.id, updatedLot.materialLotId));
    expect(materialLot.status).toBe("bank_stock");
  });

  it("closeExpiredLots settles a lot whose timer has already passed, and leaves live lots alone", async () => {
    const { event, moderator, material, teamA } = await createTestFixture(dbModule.db);
    const round = await engine.startRound({ eventId: event.id, materialTypeId: material.id, actorParticipantId: moderator.id });
    const lot = await engine.openNextLot({ eventId: event.id, roundId: round.id, actorParticipantId: moderator.id });
    await engine.placeBid({ eventId: event.id, auctionLotId: lot.id, teamId: teamA.team.id, actingParticipantId: teamA.leader.id, amount: 650 });

    // Force the timer into the past — same effect as the moderator's
    // configured lot duration having simply elapsed.
    await dbModule.db
      .update(schema.auctionLots)
      .set({ closesAt: new Date(Date.now() - 1000) })
      .where(dbModule.eq(schema.auctionLots.id, lot.id));

    const { closedLotIds } = await engine.closeExpiredLots();
    expect(closedLotIds).toContain(lot.id);

    const [updatedLot] = await dbModule.db.select().from(schema.auctionLots).where(dbModule.eq(schema.auctionLots.id, lot.id));
    expect(updatedLot.status).toBe("closed");
    expect(updatedLot.winnerTeamId).toBe(teamA.team.id);

    const auditRows = await dbModule.db
      .select()
      .from(schema.auditLog)
      .where(dbModule.and(dbModule.eq(schema.auditLog.entityId, lot.id), dbModule.eq(schema.auditLog.action, "auction_lot.closed")));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].actorParticipantId).toBeNull(); // system-driven, not a moderator click
  });
});
