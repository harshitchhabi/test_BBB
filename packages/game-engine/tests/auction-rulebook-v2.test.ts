import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { startTestDatabase, type TestDb } from "./test-db";
import { createTestFixture } from "./fixtures";

// Rulebook v2 ("balance-audited edition") additions: the split-lot
// table + team-count scaling, the Lot Cap, the Reserved Kit, and
// multi-round pause/resume (start another material's round without
// finishing the current one, come back to it later). Run against a real
// Postgres, same as auction-service.test.ts.

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

// createTestFixture's own `material` (Bricks) has splitLots/
// reservedKitEligible defaulted false — these tests need materials with
// those flags actually set, so each inserts its own on top of the
// shared event/teams fixture.
async function insertMaterial(eventId: string, overrides: Partial<typeof schema.materialTypes.$inferInsert> = {}) {
  const [material] = await dbModule.db
    .insert(schema.materialTypes)
    .values({
      eventId,
      key: overrides.key ?? "steel",
      name: overrides.name ?? "Steel",
      unitLabel: "units",
      stickerPrice: 8,
      isRare: true,
      isBonusOnly: false,
      sortOrder: 3,
      defaultLotQuantity: 40,
      defaultOpeningBid: 320,
      splitLots: true,
      reservedKitEligible: true,
      ...overrides,
    })
    .returning();
  return material;
}

describe("Split-lot table + team-count scaling", () => {
  it("creates round(activeTeamCount * 2.5) lots for a split material, but one lot per team for a non-split material", async () => {
    const { event, moderator, material: nonSplit, teamA, teamB } = await createTestFixture(dbModule.db);
    const split = await insertMaterial(event.id);

    // 2 active teams (teamA, teamB) — round(2 * 2.5) = 5 lots for the
    // split material.
    const splitRound = await engine.startRound({ eventId: event.id, materialTypeId: split.id, actorParticipantId: moderator.id });
    const splitLots = await dbModule.db.select().from(schema.auctionLots).where(dbModule.eq(schema.auctionLots.roundId, splitRound.id));
    expect(splitLots).toHaveLength(5);
    expect(splitLots.every((l: any) => l.minimumRaise === 50)).toBe(true);
    expect(splitLots.every((l: any) => l.openingBid === 320)).toBe(true);

    // Drain the split round's lots (close each with no bids) so the
    // non-split round below isn't blocked by a still-live lot.
    for (const lot of splitLots) {
      const opened = await engine.openNextLot({ eventId: event.id, roundId: splitRound.id, actorParticipantId: moderator.id });
      await engine.closeLot({ eventId: event.id, auctionLotId: opened.id, actorParticipantId: moderator.id, reason: "test drain" });
    }

    const nonSplitRound = await engine.startRound({ eventId: event.id, materialTypeId: nonSplit.id, actorParticipantId: moderator.id });
    const nonSplitLots = await dbModule.db.select().from(schema.auctionLots).where(dbModule.eq(schema.auctionLots.roundId, nonSplitRound.id));
    expect(nonSplitLots).toHaveLength(2); // one lot per active team
    expect(nonSplitLots.every((l: any) => l.minimumRaise === 25)).toBe(true);
  });
});

describe("Lot Cap", () => {
  it("refuses a bid outright (no bid row at all) once a team already holds the cap's worth of lots", async () => {
    const { event, moderator, teamA } = await createTestFixture(dbModule.db);
    const material = await insertMaterial(event.id, { key: "steel-cap", name: "Steel Cap Test", reservedKitEligible: false });

    const round = await engine.startRound({ eventId: event.id, materialTypeId: material.id, actorParticipantId: moderator.id });

    // Win 2 lots outright for teamA (the cap).
    for (let i = 0; i < 2; i++) {
      const lot = await engine.openNextLot({ eventId: event.id, roundId: round.id, actorParticipantId: moderator.id });
      await engine.placeBid({ eventId: event.id, auctionLotId: lot.id, teamId: teamA.team.id, actingParticipantId: teamA.leader.id, amount: lot.openingBid });
      await engine.closeLot({ eventId: event.id, auctionLotId: lot.id, actorParticipantId: moderator.id });
    }

    const heldLots = await dbModule.db
      .select()
      .from(schema.materialLots)
      .where(dbModule.and(dbModule.eq(schema.materialLots.materialTypeId, material.id), dbModule.eq(schema.materialLots.ownerTeamId, teamA.team.id), dbModule.eq(schema.materialLots.status, "sold")));
    expect(heldLots).toHaveLength(2);

    // A 3rd lot for the same material: the bid is refused outright, not
    // even recorded as a rejected bid.
    const thirdLot = await engine.openNextLot({ eventId: event.id, roundId: round.id, actorParticipantId: moderator.id });
    await expect(
      engine.placeBid({ eventId: event.id, auctionLotId: thirdLot.id, teamId: teamA.team.id, actingParticipantId: teamA.leader.id, amount: thirdLot.openingBid }),
    ).rejects.toMatchObject({ code: "lot_cap_reached" });

    const bidsOnThirdLot = await dbModule.db.select().from(schema.bids).where(dbModule.eq(schema.bids.auctionLotId, thirdLot.id));
    expect(bidsOnThirdLot).toHaveLength(0);
  });
});

describe("Reserved Kit", () => {
  it("lets a team claim one lot at printed opening price with no bidding, counts it toward the Lot Cap, and blocks a second claim", async () => {
    const { event, moderator, teamA } = await createTestFixture(dbModule.db);
    const material = await insertMaterial(event.id, { key: "cement-rk", name: "Cement RK Test", defaultLotQuantity: 120, defaultOpeningBid: 360 });

    const round = await engine.startRound({ eventId: event.id, materialTypeId: material.id, actorParticipantId: moderator.id });

    const before = await dbModule.db.select().from(schema.teams).where(dbModule.eq(schema.teams.id, teamA.team.id));
    const claim = await engine.claimReservedKit({ eventId: event.id, teamId: teamA.team.id, materialTypeId: material.id, actingParticipantId: teamA.leader.id });
    expect(claim.amount).toBe(360);
    expect(claim.quantity).toBe(120);

    const [after] = await dbModule.db.select().from(schema.teams).where(dbModule.eq(schema.teams.id, teamA.team.id));
    expect(after.auctionTokens).toBe(before[0].auctionTokens - 360);

    const inventory = await engine.getTeamInventory(event.id, teamA.team.id);
    expect(inventory.find((i: any) => i.materialTypeId === material.id)?.quantity).toBe(120);

    // Can't claim a second Reserved Kit lot of the same material.
    await expect(
      engine.claimReservedKit({ eventId: event.id, teamId: teamA.team.id, materialTypeId: material.id, actingParticipantId: teamA.leader.id }),
    ).rejects.toMatchObject({ code: "conflict" });

    // One more auction win takes teamA to the 2-lot cap...
    const lot = await engine.openNextLot({ eventId: event.id, roundId: round.id, actorParticipantId: moderator.id });
    await engine.placeBid({ eventId: event.id, auctionLotId: lot.id, teamId: teamA.team.id, actingParticipantId: teamA.leader.id, amount: lot.openingBid });
    await engine.closeLot({ eventId: event.id, auctionLotId: lot.id, actorParticipantId: moderator.id });

    // ...and a hypothetical second material's Reserved Kit claim would
    // still work (different material, cap is per-material) but this
    // team is now at cap for THIS material, so even a fresh
    // (never-claimed) Reserved Kit attempt is refused by the cap check.
    const heldLots = await dbModule.db
      .select({ count: dbModule.sql`count(*)` })
      .from(schema.materialLots)
      .where(dbModule.and(dbModule.eq(schema.materialLots.materialTypeId, material.id), dbModule.eq(schema.materialLots.ownerTeamId, teamA.team.id), dbModule.eq(schema.materialLots.status, "sold")));
    expect(Number(heldLots[0].count)).toBe(2);
  });

  it("closes the window the moment the first lot in that round is opened", async () => {
    const { event, moderator, teamA, teamB } = await createTestFixture(dbModule.db);
    const material = await insertMaterial(event.id, { key: "bricks-rk", name: "Bricks RK Test", defaultLotQuantity: 240, defaultOpeningBid: 240 });

    const round = await engine.startRound({ eventId: event.id, materialTypeId: material.id, actorParticipantId: moderator.id });
    const lot = await engine.openNextLot({ eventId: event.id, roundId: round.id, actorParticipantId: moderator.id });

    await expect(
      engine.claimReservedKit({ eventId: event.id, teamId: teamB.team.id, materialTypeId: material.id, actingParticipantId: teamB.leader.id }),
    ).rejects.toMatchObject({ code: "conflict" });

    await engine.closeLot({ eventId: event.id, auctionLotId: lot.id, actorParticipantId: moderator.id });
  });

  it("refuses a Reserved Kit claim on a material that isn't Bricks/Cement/Steel", async () => {
    const { event, moderator, material: nonEligible, teamA } = await createTestFixture(dbModule.db);
    // fixtures.ts's default material (Bricks key, but reservedKitEligible
    // defaults false since it wasn't set) — stand-in for a non-eligible
    // material like Wood/Glass/etc.
    await engine.startRound({ eventId: event.id, materialTypeId: nonEligible.id, actorParticipantId: moderator.id });
    await expect(
      engine.claimReservedKit({ eventId: event.id, teamId: teamA.team.id, materialTypeId: nonEligible.id, actingParticipantId: teamA.leader.id }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("Multi-round pause/resume", () => {
  it("lets a moderator start a second material's round without finishing the first, then resume the first later", async () => {
    const { event, moderator, material: materialX, teamA, teamB } = await createTestFixture(dbModule.db);
    const materialY = await insertMaterial(event.id, { key: "materialY", name: "Material Y", reservedKitEligible: false });

    const roundX = await engine.startRound({ eventId: event.id, materialTypeId: materialX.id, actorParticipantId: moderator.id });

    // Starting Y while X is still active (and fully pending) now
    // succeeds — this is the actual feature: no longer forced to finish
    // X before starting Y.
    const roundY = await engine.startRound({ eventId: event.id, materialTypeId: materialY.id, actorParticipantId: moderator.id });

    const active = await engine.listActiveRounds(event.id);
    const activeIds = active.map((r: any) => r.id).sort();
    expect(activeIds).toEqual([roundX.id, roundY.id].sort());

    // But starting X a SECOND time while its round is still active is
    // still refused — one active round per material at a time.
    await expect(
      engine.startRound({ eventId: event.id, materialTypeId: materialX.id, actorParticipantId: moderator.id }),
    ).rejects.toMatchObject({ code: "conflict" });

    // Open and win a lot in Y...
    const yLot = await engine.openNextLot({ eventId: event.id, roundId: roundY.id, actorParticipantId: moderator.id });
    await engine.placeBid({ eventId: event.id, auctionLotId: yLot.id, teamId: teamA.team.id, actingParticipantId: teamA.leader.id, amount: yLot.openingBid });

    // ...and while Y's lot is still live, X can't be opened — only one
    // live lot anywhere in the event at a time.
    await expect(
      engine.openNextLot({ eventId: event.id, roundId: roundX.id, actorParticipantId: moderator.id }),
    ).rejects.toMatchObject({ code: "conflict" });

    await engine.closeLot({ eventId: event.id, auctionLotId: yLot.id, actorParticipantId: moderator.id });

    // Now X can be resumed even though Y (paused, with its remaining
    // lots still pending) was never fully drained.
    const xLot = await engine.openNextLot({ eventId: event.id, roundId: roundX.id, actorParticipantId: moderator.id });
    expect(xLot.roundId).toBe(roundX.id);
  });
});
