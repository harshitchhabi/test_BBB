import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { startTestDatabase, type TestDb } from "./test-db";
import { createTestFixture } from "./fixtures";

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

// startRound refuses to open a second round while one is still "active" —
// a round only completes once every one of its lots has left
// pending/live (see completeRoundIfFinished in auction-service.ts). These
// tests care about round *sequencing*, not bidding, so just cycle every
// lot through open -> close-with-no-bids to retire the round quickly.
async function retireRound(eventId: string, roundId: string, moderatorId: string) {
  for (;;) {
    const [pending] = await dbModule.db
      .select({ id: schema.auctionLots.id })
      .from(schema.auctionLots)
      .where(dbModule.and(dbModule.eq(schema.auctionLots.roundId, roundId), dbModule.eq(schema.auctionLots.status, "pending")));
    if (!pending) break;
    const lot = await engine.openNextLot({ eventId, roundId, actorParticipantId: moderatorId });
    await engine.closeLot({ eventId, auctionLotId: lot.id, actorParticipantId: moderatorId, reason: "test retire" });
  }
}

describe("Market Shock deck", () => {
  it("does not draw a card for the first round, but does for the second", async () => {
    const { event, moderator, material } = await createTestFixture(dbModule.db);

    const [steel] = await dbModule.db
      .insert(schema.materialTypes)
      .values({
        eventId: event.id,
        key: "steel",
        name: "Steel",
        unitLabel: "units",
        stickerPrice: 8,
        isRare: true,
        isBonusOnly: false,
        sortOrder: 2,
        defaultLotQuantity: 100,
        defaultOpeningBid: 800,
      })
      .returning();

    const [card] = await dbModule.db
      .insert(schema.marketShockCards)
      .values({
        eventId: event.id,
        key: "steel_embargo",
        title: "Steel Embargo",
        description: "Steel's opening bids double for this round.",
        effectJson: JSON.stringify({ type: "opening_bid_multiplier", materialKey: "steel", multiplier: 2 }),
        copiesInDeck: 1,
      })
      .returning();

    const round1 = await engine.startRound({ eventId: event.id, materialTypeId: material.id, actorParticipantId: moderator.id });
    expect(round1.marketShockCardId).toBeNull();
    await retireRound(event.id, round1.id, moderator.id);

    const round2 = await engine.startRound({ eventId: event.id, materialTypeId: steel.id, actorParticipantId: moderator.id });
    expect(round2.marketShockCardId).toBe(card.id);

    const steelLots = await dbModule.db
      .select()
      .from(schema.auctionLots)
      .where(dbModule.eq(schema.auctionLots.roundId, round2.id));
    expect(steelLots.length).toBeGreaterThan(0);
    for (const lot of steelLots) {
      expect(lot.openingBid).toBe(800 * 2); // opening_bid_multiplier applied
    }
  });

  it("grants every active team tokens immediately when an Investor Grant is drawn", async () => {
    const { event, moderator, material, teamA, teamB } = await createTestFixture(dbModule.db);

    // A second material so round 2 (the earliest a shock can be drawn) has
    // something to auction.
    const [wood] = await dbModule.db
      .insert(schema.materialTypes)
      .values({
        eventId: event.id,
        key: "wood",
        name: "Wood",
        unitLabel: "units",
        stickerPrice: 2,
        isRare: false,
        isBonusOnly: false,
        sortOrder: 2,
        defaultLotQuantity: 120,
        defaultOpeningBid: 240,
      })
      .returning();

    await dbModule.db.insert(schema.marketShockCards).values({
      eventId: event.id,
      key: "investor_grant",
      title: "Investor Grant",
      description: "Every team immediately receives an extra 200 tokens.",
      effectJson: JSON.stringify({ type: "grant_tokens_all_teams", amount: 200 }),
      copiesInDeck: 1,
    });

    const round1 = await engine.startRound({ eventId: event.id, materialTypeId: material.id, actorParticipantId: moderator.id });
    await retireRound(event.id, round1.id, moderator.id);
    await engine.startRound({ eventId: event.id, materialTypeId: wood.id, actorParticipantId: moderator.id });

    const [updatedA] = await dbModule.db.select().from(schema.teams).where(dbModule.eq(schema.teams.id, teamA.team.id));
    const [updatedB] = await dbModule.db.select().from(schema.teams).where(dbModule.eq(schema.teams.id, teamB.team.id));
    expect(updatedA.auctionTokens).toBe(1200);
    expect(updatedB.auctionTokens).toBe(1200);
  });
});
