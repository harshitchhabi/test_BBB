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

  it("Eco Incentive: winning a free-round Solar lot auto-grants +15 (not +10) at construction, capped by real holdings", async () => {
    const { event, moderator, teamA } = await createTestFixture(dbModule.db);

    const [solar] = await dbModule.db
      .insert(schema.materialTypes)
      .values({ eventId: event.id, key: "solar", name: "Solar", unitLabel: "units", stickerPrice: 5, isRare: false, isBonusOnly: true, sortOrder: 2, defaultLotQuantity: 100, defaultOpeningBid: 100 })
      .returning();
    await dbModule.db.insert(schema.marketShockCards).values({
      eventId: event.id,
      key: "eco_incentive",
      title: "Eco Incentive",
      description: "Solar lots are free this round; Solar attached this round gives +15 Eco instead of +10.",
      effectJson: JSON.stringify({ type: "material_free_this_round", materialKey: "solar", ecoBonusOverride: 15 }),
      copiesInDeck: 1,
    });
    const [recipe] = await dbModule.db.insert(schema.buildingRecipes).values({ eventId: event.id, key: "shed", name: "Shed", basePoints: 5, sortOrder: 1 }).returning();

    // Round 1 has no card (sequence 1) - just retire it to reach round 2,
    // where the only card in the deck is guaranteed to be drawn. teamA's
    // base recipe material comes from a plain grant, not the auction -
    // this test is only exercising the Eco path, not the base recipe.
    const round1 = await engine.startRound({ eventId: event.id, materialTypeId: (await dbModule.db.select().from(schema.materialTypes).where(dbModule.and(dbModule.eq(schema.materialTypes.eventId, event.id), dbModule.eq(schema.materialTypes.key, "bricks"))))[0].id, actorParticipantId: moderator.id });
    await retireRound(event.id, round1.id, moderator.id);

    const round2 = await engine.startRound({ eventId: event.id, materialTypeId: solar.id, actorParticipantId: moderator.id });
    expect(round2.ecoBonusOverride).toBe(15);
    const lot = await engine.openNextLot({ eventId: event.id, roundId: round2.id, actorParticipantId: moderator.id });
    expect(lot.openingBid).toBe(0); // material_free_this_round

    await engine.placeBid({ eventId: event.id, auctionLotId: lot.id, teamId: teamA.team.id, actingParticipantId: teamA.leader.id, amount: 50 });
    await engine.closeLot({ eventId: event.id, auctionLotId: lot.id, actorParticipantId: moderator.id, reason: "close" });

    const [afterWin] = await dbModule.db.select().from(schema.teams).where(dbModule.eq(schema.teams.id, teamA.team.id));
    expect(afterWin.ecoEligibleSolarUnits).toBe(100); // the whole free lot's quantity

    await engine.setEventStatus({ eventId: event.id, status: "stage_2", actorParticipantId: moderator.id });
    const building = await engine.constructBuilding({
      eventId: event.id,
      teamId: teamA.team.id,
      recipeId: recipe.id,
      bonuses: { eco: true },
      actorParticipantId: teamA.leader.id,
    });
    expect(building.ecoBonus).toBe(15); // NOT the standard 10

    const [afterBuild] = await dbModule.db.select().from(schema.teams).where(dbModule.eq(schema.teams.id, teamA.team.id));
    expect(afterBuild.ecoEligibleSolarUnits).toBe(96); // 100 - 4 spent on this bonus

    // A second Eco bonus on ordinary (non-free-round) Solar correctly
    // falls back to the standard +10 once the eco-eligible units run out
    // relative to a fresh recipe's requirement - simulated here by
    // draining the counter to below 4 directly and building again.
    await dbModule.db.update(schema.teams).set({ ecoEligibleSolarUnits: 2 }).where(dbModule.eq(schema.teams.id, teamA.team.id));
    const secondBuilding = await engine.constructBuilding({
      eventId: event.id,
      teamId: teamA.team.id,
      recipeId: recipe.id,
      bonuses: { eco: true },
      actorParticipantId: teamA.leader.id,
    });
    expect(secondBuilding.ecoBonus).toBe(10); // standard bonus, not enough banked eco-eligible units
  });

  it("Supply Crunch: automatically raises the next round's opening bid for the identified material, then clears itself", async () => {
    const { event, moderator } = await createTestFixture(dbModule.db);

    const [medical] = await dbModule.db
      .insert(schema.materialTypes)
      .values({ eventId: event.id, key: "medical", name: "Medical", unitLabel: "units", stickerPrice: 10, isRare: true, isBonusOnly: false, sortOrder: 2, defaultLotQuantity: 50, defaultOpeningBid: 400 })
      .returning();
    await dbModule.db.insert(schema.marketShockCards).values({
      eventId: event.id,
      key: "supply_crunch",
      title: "Supply Crunch",
      description: "The unsold material with the smallest lot size opens 50% higher.",
      effectJson: JSON.stringify({ type: "smallest_unsold_lot_price_increase", percent: 50, priorityMaterialKeys: ["medical"] }),
      copiesInDeck: 1,
    });

    const [bricks] = await dbModule.db.select().from(schema.materialTypes).where(dbModule.and(dbModule.eq(schema.materialTypes.eventId, event.id), dbModule.eq(schema.materialTypes.key, "bricks")));

    // Round 1: Medical goes completely unsold (no bids) - lands in bank
    // stock, which is what makes it a Supply Crunch target.
    const round1 = await engine.startRound({ eventId: event.id, materialTypeId: medical.id, actorParticipantId: moderator.id });
    await retireRound(event.id, round1.id, moderator.id);

    // Round 2 (Bricks): the only card in the deck is drawn - a global
    // effect, so it fires regardless of round 2's own material, flagging
    // Medical for its own next round.
    const round2 = await engine.startRound({ eventId: event.id, materialTypeId: bricks.id, actorParticipantId: moderator.id });
    expect(round2.marketShockCardId).not.toBeNull();
    await retireRound(event.id, round2.id, moderator.id);

    const [medicalAfterCrunch] = await dbModule.db.select().from(schema.materialTypes).where(dbModule.eq(schema.materialTypes.id, medical.id));
    expect(medicalAfterCrunch.pendingOpeningBidIncreasePercent).toBe(50);

    // Round 3: Medical comes up again - the pending increase applies
    // automatically, no moderator openingBidOverride needed, and clears
    // itself so a FOURTH Medical round isn't also inflated.
    const round3 = await engine.startRound({ eventId: event.id, materialTypeId: medical.id, actorParticipantId: moderator.id });
    const round3Lots = await dbModule.db.select().from(schema.auctionLots).where(dbModule.eq(schema.auctionLots.roundId, round3.id));
    expect(round3Lots.length).toBeGreaterThan(0);
    for (const lot of round3Lots) {
      expect(lot.openingBid).toBe(Math.ceil(400 * 1.5)); // 400 default * 1.5 (50% higher)
    }

    const [medicalAfterRound3] = await dbModule.db.select().from(schema.materialTypes).where(dbModule.eq(schema.materialTypes.id, medical.id));
    expect(medicalAfterRound3.pendingOpeningBidIncreasePercent).toBeNull();
  });
});
