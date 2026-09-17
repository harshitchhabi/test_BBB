import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { startTestDatabase, type TestDb } from "./test-db";

// Full end-to-end mock run at real event scale (15 teams) — the night-
// before-the-event smoke test: build a whole event from scratch (no
// shared fixture, since none of the existing ones are parametric on
// team count) and drive it through Stage 1 (split-lot scaling, Lot Cap,
// Reserved Kit), Stage 2 (material + token trades, construction), and
// Stage 3 (15 simultaneous city auctions, scout reports, final reveal +
// scoring) exactly the way a real 15-team event would, checking that
// nothing throws and every invariant holds at this scale, not just the
// 2-3 team scale the rest of the suite uses.

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
}, 60000);

afterAll(async () => {
  await dbModule.pool.end();
  await testDb.stop();
});

const TEAM_COUNT = 15;
const PASSWORD_HASH = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8oxL/Yjyq6XvXqAtVvjGdiWZOWXQNi";

describe("Mock run: 15-team event, Stage 1 through final scoring", () => {
  it("runs the whole game at 15-team scale without breaking any invariant", async () => {
    const db = dbModule.db;

    const [event] = await db.insert(schema.events).values({ name: "Mock Run 15 Teams", status: "stage_1" }).returning();
    await db.insert(schema.eventSettings).values({ eventId: event.id });

    const [moderator] = await db
      .insert(schema.participants)
      .values({ name: "Mod", email: `mod-${event.id}@test.local`, username: `mod-${event.id}`, passwordHash: PASSWORD_HASH })
      .returning();
    await db.insert(schema.eventStaff).values({ eventId: event.id, participantId: moderator.id, role: "staff" });

    // Two materials: Bricks-like (split, Reserved-Kit-eligible) and
    // Pipes-like (one lot per team, not split) - enough to exercise both
    // lot-generation paths at 15-team scale.
    const [bricks] = await db
      .insert(schema.materialTypes)
      .values({
        eventId: event.id,
        key: "bricks",
        name: "Bricks",
        unitLabel: "units",
        stickerPrice: 1,
        isRare: false,
        isBonusOnly: false,
        sortOrder: 1,
        defaultLotQuantity: 240,
        defaultOpeningBid: 240,
        splitLots: true,
        reservedKitEligible: true,
      })
      .returning();
    const [pipes] = await db
      .insert(schema.materialTypes)
      .values({
        eventId: event.id,
        key: "pipes",
        name: "Pipes",
        unitLabel: "units",
        stickerPrice: 4,
        isRare: false,
        isBonusOnly: false,
        sortOrder: 2,
        defaultLotQuantity: 20,
        defaultOpeningBid: 75,
        splitLots: false,
        reservedKitEligible: false,
      })
      .returning();

    async function createTeamWithLeader(i: number) {
      const name = `Team${i}`;
      const [leader] = await db
        .insert(schema.participants)
        .values({ name: `${name} Leader`, email: `${name.toLowerCase()}-${event.id}@test.local`, username: `${name.toLowerCase()}-leader-${event.id}`, passwordHash: PASSWORD_HASH })
        .returning();
      const [team] = await db
        .insert(schema.teams)
        .values({ eventId: event.id, name, code: name.toUpperCase().slice(0, 6), ownerParticipantId: leader.id, auctionTokens: 1000, cityWalletTokens: 500 })
        .returning();
      await db.insert(schema.teamMembers).values({ eventId: event.id, teamId: team.id, participantId: leader.id, role: "leader" });
      return { team, leader };
    }

    const teams: Array<{ team: any; leader: any }> = [];
    for (let i = 1; i <= TEAM_COUNT; i++) teams.push(await createTeamWithLeader(i));

    // ---------------------------------------------------------------
    // STAGE 1: Bricks (split, Reserved Kit eligible)
    // ---------------------------------------------------------------
    const bricksRound = await engine.startRound({ eventId: event.id, materialTypeId: bricks.id, actorParticipantId: moderator.id });
    const bricksLots = await db.select().from(schema.auctionLots).where(dbModule.eq(schema.auctionLots.roundId, bricksRound.id));
    // round(15 * 2.5) = 38
    expect(bricksLots).toHaveLength(38);
    expect(bricksLots.every((l: any) => l.minimumRaise === 50 && l.openingBid === 240)).toBe(true);

    // Teams 1-3 claim their Reserved Kit lot before any open bidding.
    for (const { team, leader } of teams.slice(0, 3)) {
      const claim = await engine.claimReservedKit({ eventId: event.id, teamId: team.id, materialTypeId: bricks.id, actingParticipantId: leader.id });
      expect(claim.amount).toBe(240);
    }
    // Team 1 tries a second Reserved Kit claim on the same material -
    // refused (one claim per team per material).
    await expect(
      engine.claimReservedKit({ eventId: event.id, teamId: teams[0].team.id, materialTypeId: bricks.id, actingParticipantId: teams[0].leader.id }),
    ).rejects.toMatchObject({ code: "conflict" });

    // Drain the remaining 35 lots: team 1 wins a 2nd lot (hitting the
    // cap), then tries and fails to win a 3rd; every other lot goes to
    // whichever team is "next" in a round-robin, some deliberately left
    // unsold to exercise that path at scale too.
    let bricksWinners = 0;
    let bricksUnsold = 0;
    let nextBidderIndex = 1; // team 0 already has 1 lot (Reserved Kit); give it lot #2 first
    // Tracks each team's Bricks lot count client-side so the round-robin
    // never re-selects a team already at the 2-lot cap (Reserved Kit
    // claims already put teams 0-2 at count 1) - this is test-script
    // bookkeeping, not an engine call; the engine's own cap enforcement
    // is exercised separately and directly at lotIndex 1 below.
    const bricksWinCount = new Map<string, number>(teams.map((t) => [t.team.id, 0]));
    bricksWinCount.set(teams[0].team.id, 1);
    bricksWinCount.set(teams[1].team.id, 1);
    bricksWinCount.set(teams[2].team.id, 1);
    for (let lotIndex = 0; lotIndex < 35; lotIndex++) {
      const lot = await engine.openNextLot({ eventId: event.id, roundId: bricksRound.id, actorParticipantId: moderator.id });
      if (lotIndex === 0) {
        // Team 0 wins its 2nd lot - now at the cap.
        await engine.placeBid({ eventId: event.id, auctionLotId: lot.id, teamId: teams[0].team.id, actingParticipantId: teams[0].leader.id, amount: lot.openingBid });
        await engine.closeLot({ eventId: event.id, auctionLotId: lot.id, actorParticipantId: moderator.id });
        bricksWinCount.set(teams[0].team.id, 2);
        bricksWinners++;
      } else if (lotIndex === 1) {
        // Team 0 tries for a 3rd lot mid-auction - refused outright, no
        // bid row recorded, and the lot is left to close unsold.
        await expect(
          engine.placeBid({ eventId: event.id, auctionLotId: lot.id, teamId: teams[0].team.id, actingParticipantId: teams[0].leader.id, amount: lot.openingBid }),
        ).rejects.toMatchObject({ code: "lot_cap_reached" });
        await engine.closeLot({ eventId: event.id, auctionLotId: lot.id, actorParticipantId: moderator.id });
        bricksUnsold++;
      } else if (lotIndex % 4 === 0) {
        // Every 4th remaining lot deliberately goes unsold (no bids).
        await engine.closeLot({ eventId: event.id, auctionLotId: lot.id, actorParticipantId: moderator.id });
        bricksUnsold++;
      } else {
        // Advance to the next team that isn't already at the cap for
        // Bricks (at most TEAM_COUNT checks needed to find one, since
        // total cap capacity - 15 teams x 2 - comfortably exceeds the 38
        // lots this round has).
        let bidder = teams[nextBidderIndex % TEAM_COUNT];
        while ((bricksWinCount.get(bidder.team.id) ?? 0) >= 2) {
          nextBidderIndex++;
          bidder = teams[nextBidderIndex % TEAM_COUNT];
        }
        nextBidderIndex++;
        await engine.placeBid({ eventId: event.id, auctionLotId: lot.id, teamId: bidder.team.id, actingParticipantId: bidder.leader.id, amount: lot.openingBid });
        await engine.closeLot({ eventId: event.id, auctionLotId: lot.id, actorParticipantId: moderator.id });
        bricksWinCount.set(bidder.team.id, (bricksWinCount.get(bidder.team.id) ?? 0) + 1);
        bricksWinners++;
      }
    }
    expect(bricksWinners + bricksUnsold).toBe(35);

    // No team ever exceeds the 2-lot cap, mechanically - verified
    // directly against the ledger, not just trusted from the rejections
    // above.
    const capCheck = await db
      .select({ teamId: schema.materialLots.ownerTeamId, count: dbModule.sql`count(*)` })
      .from(schema.materialLots)
      .where(dbModule.and(dbModule.eq(schema.materialLots.materialTypeId, bricks.id), dbModule.eq(schema.materialLots.status, "sold")))
      .groupBy(schema.materialLots.ownerTeamId);
    for (const row of capCheck) {
      expect(Number(row.count)).toBeLessThanOrEqual(2);
    }

    // ---------------------------------------------------------------
    // STAGE 1: Pipes (one lot per team - 15 lots)
    // ---------------------------------------------------------------
    const pipesRound = await engine.startRound({ eventId: event.id, materialTypeId: pipes.id, actorParticipantId: moderator.id });
    const pipesLots = await db.select().from(schema.auctionLots).where(dbModule.eq(schema.auctionLots.roundId, pipesRound.id));
    expect(pipesLots).toHaveLength(TEAM_COUNT);
    for (let i = 0; i < TEAM_COUNT; i++) {
      const lot = await engine.openNextLot({ eventId: event.id, roundId: pipesRound.id, actorParticipantId: moderator.id });
      const bidder = teams[i];
      await engine.placeBid({ eventId: event.id, auctionLotId: lot.id, teamId: bidder.team.id, actingParticipantId: bidder.leader.id, amount: lot.openingBid });
      await engine.closeLot({ eventId: event.id, auctionLotId: lot.id, actorParticipantId: moderator.id });
    }

    // ---------------------------------------------------------------
    // STAGE 2: trades (material-for-material, token-for-material) and
    // one construction.
    // ---------------------------------------------------------------
    await engine.setEventStatus({ eventId: event.id, status: "stage_2", actorParticipantId: moderator.id });

    // Snapshot balances right before the trade - how many Bricks/Pipes
    // lots each team actually won in the round-robin above is
    // deterministic but not hand-friendly to predict, so this checks the
    // trade's OWN effect (token conservation) rather than an absolute
    // balance.
    const [team0Before] = await db.select().from(schema.teams).where(dbModule.eq(schema.teams.id, teams[0].team.id));
    const [team3Before] = await db.select().from(schema.teams).where(dbModule.eq(schema.teams.id, teams[3].team.id));

    // Team 0 has surplus bricks (at least 2 lots); trade some to Team 3
    // for tokens.
    const tokenTrade = await engine.proposeTrade({
      eventId: event.id,
      proposerTeamId: teams[0].team.id,
      counterpartyTeamId: teams[3].team.id,
      proposerParticipantId: teams[0].leader.id,
      lines: [
        { fromTeamId: teams[0].team.id, materialTypeId: bricks.id, quantity: 100 },
        { fromTeamId: teams[3].team.id, materialTypeId: null, quantity: 150 }, // tokens
      ],
    });
    await engine.acceptTrade({ eventId: event.id, tradeId: tokenTrade.id, acceptingParticipantId: teams[3].leader.id });
    await engine.registerTrade({ eventId: event.id, tradeId: tokenTrade.id, moderatorParticipantId: moderator.id });
    await engine.completeTrade({ eventId: event.id, tradeId: tokenTrade.id, moderatorParticipantId: moderator.id });

    const [team0After] = await db.select().from(schema.teams).where(dbModule.eq(schema.teams.id, teams[0].team.id));
    const [team3After] = await db.select().from(schema.teams).where(dbModule.eq(schema.teams.id, teams[3].team.id));
    // Tokens conserved exactly across the trade: team0 gained the 150
    // team3 gave, nothing created or destroyed.
    expect(team0After.auctionTokens).toBe(team0Before.auctionTokens + 150);
    expect(team3After.auctionTokens).toBe(team3Before.auctionTokens - 150);

    const team0BricksHeld = (await engine.getTeamInventory(event.id, teams[0].team.id)).find((i: any) => i.materialTypeId === bricks.id)?.quantity ?? 0;
    expect(team0BricksHeld).toBeGreaterThanOrEqual(200); // enough left for the Shed recipe below despite trading 100 away

    // A simple recipe using only Bricks + Pipes, so at least one team
    // can actually build with what this mock run gave it.
    const [recipe] = await db
      .insert(schema.buildingRecipes)
      .values({ eventId: event.id, key: "shed", name: "Shed", basePoints: 10, sortOrder: 1 })
      .returning();
    await db.insert(schema.recipeRequirements).values([
      { recipeId: recipe.id, materialTypeId: bricks.id, requiredQuantity: 200 },
      { recipeId: recipe.id, materialTypeId: pipes.id, requiredQuantity: 10 },
    ]);
    // Team 0 originally won 2 bricks lots (480) then traded away 100,
    // leaving 380 - plenty for 200; it also won a Pipes lot (20 units).
    const building = await engine.constructBuilding({ eventId: event.id, teamId: teams[0].team.id, recipeId: recipe.id, actorParticipantId: teams[0].leader.id });
    expect(building.basePoints).toBe(10);

    // ---------------------------------------------------------------
    // STAGE 3: 15 teams, 17 cities (a few more than teams, per
    // rulebook), scout reports, then reveal + final scoring.
    // ---------------------------------------------------------------
    await engine.setEventStatus({ eventId: event.id, status: "stage_3", actorParticipantId: moderator.id });

    const cityRows = [];
    for (let i = 1; i <= 17; i++) {
      const tier = i <= 3 ? "metro" : i <= 10 ? "city" : "town";
      const openingBid = tier === "metro" ? 400 : tier === "city" ? 250 : 100;
      const [city] = await db
        .insert(schema.cities)
        .values({ eventId: event.id, blockNumber: 1, name: `City${i}`, tier, openingBid, hiddenMultiplier: "2.50" })
        .returning();
      cityRows.push(city);
    }

    // A couple of scout reports - not load-bearing for the test, just
    // confirmed to not blow up at this scale.
    await engine.purchaseScoutReport({ eventId: event.id, teamId: teams[1].team.id, cityId: cityRows[0].id, actingParticipantId: teams[1].leader.id });
    await engine.purchaseScoutReport({ eventId: event.id, teamId: teams[2].team.id, cityId: cityRows[1].id, actingParticipantId: teams[2].leader.id });

    // Every team wins exactly one city, one auction at a time.
    for (let i = 0; i < TEAM_COUNT; i++) {
      const city = cityRows[i];
      const auction = await engine.startCityAuction({ eventId: event.id, cityId: city.id, actorParticipantId: moderator.id });
      const bidder = teams[i];
      await engine.placeCityBid({ eventId: event.id, cityAuctionId: auction.id, teamId: bidder.team.id, actingParticipantId: bidder.leader.id, amount: city.openingBid });
      const result = await engine.closeCityAuction({ eventId: event.id, cityAuctionId: auction.id, actorParticipantId: moderator.id });
      expect(result.winnerTeamId).toBe(bidder.team.id);
    }

    // Every team now has exactly one city.
    const allCitiesAfter = await db.select().from(schema.cities).where(dbModule.eq(schema.cities.eventId, event.id));
    for (const { team } of teams) {
      expect(allCitiesAfter.filter((c: any) => c.assignedTeamId === team.id)).toHaveLength(1);
    }

    const snapshots = await engine.revealCitiesAndScore({ eventId: event.id, actorParticipantId: moderator.id });
    expect(snapshots).toHaveLength(TEAM_COUNT);
    for (const s of snapshots) {
      expect(Number.isFinite(Number(s.finalScore))).toBe(true);
      expect(Number(s.finalScore)).toBeGreaterThanOrEqual(0);
    }

    const [eventAfter] = await db.select().from(schema.events).where(dbModule.eq(schema.events.id, event.id));
    expect(eventAfter.status).toBe("completed");

    const scoreboard = await engine.getScoreboard(event.id);
    expect(scoreboard).toHaveLength(TEAM_COUNT);
  }, 60000);
});
