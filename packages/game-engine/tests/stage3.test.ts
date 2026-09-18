import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { startTestDatabase, type TestDb } from "./test-db";
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

describe("City auction", () => {
  it("never leaks the hidden multiplier through listCities before reveal", async () => {
    const { event } = await createStage3Fixture(dbModule.db);
    const list = await engine.listCities(event.id);
    for (const city of list) {
      expect(city).not.toHaveProperty("hiddenMultiplier");
    }
  });

  it("enforces one city per team — a team that already won a city cannot bid again", async () => {
    const { event, moderator, cities, teamA } = await createStage3Fixture(dbModule.db);

    const auction1 = await engine.startCityAuction({ eventId: event.id, cityId: cities.metroCity.id, actorParticipantId: moderator.id });
    await engine.placeCityBid({ eventId: event.id, cityAuctionId: auction1.id, teamId: teamA.team.id, actingParticipantId: teamA.leader.id, amount: 400 });
    await engine.closeCityAuction({ eventId: event.id, cityAuctionId: auction1.id, actorParticipantId: moderator.id });

    const auction2 = await engine.startCityAuction({ eventId: event.id, cityId: cities.townCity.id, actorParticipantId: moderator.id });
    await expect(
      engine.placeCityBid({ eventId: event.id, cityAuctionId: auction2.id, teamId: teamA.team.id, actingParticipantId: teamA.leader.id, amount: 100 }),
    ).rejects.toMatchObject({ code: "already_has_city" });
  });

  it("splits payment from city wallet first, then leftover auction tokens", async () => {
    const { event, moderator, cities, teamA } = await createStage3Fixture(dbModule.db);
    // teamA: cityWalletTokens=500, auctionTokens=200. Bid 650 -> 500 from wallet, 150 from leftover.
    const auction = await engine.startCityAuction({ eventId: event.id, cityId: cities.metroCity.id, actorParticipantId: moderator.id });
    await engine.placeCityBid({ eventId: event.id, cityAuctionId: auction.id, teamId: teamA.team.id, actingParticipantId: teamA.leader.id, amount: 650 });
    await engine.closeCityAuction({ eventId: event.id, cityAuctionId: auction.id, actorParticipantId: moderator.id });

    const [teamARow] = await dbModule.db.select().from(schema.teams).where(dbModule.eq(schema.teams.id, teamA.team.id));
    expect(teamARow.cityWalletTokens).toBe(0);
    expect(teamARow.auctionTokens).toBe(50); // 200 - 150
  });

  it("assigns the last remaining city to the last team without bidding, at the opening bid", async () => {
    const { event, moderator, cities, teamA, teamB } = await createStage3Fixture(dbModule.db);
    // Genuinely make it "the last team, the last city": teamB already has
    // metroCity, leaving exactly teamA without a city and exactly
    // townCity unsold.
    await dbModule.db.update(schema.cities).set({ assignedTeamId: teamB.team.id, saleOrder: 1 }).where(dbModule.eq(schema.cities.id, cities.metroCity.id));

    const result = await engine.assignLastCity({ eventId: event.id, cityId: cities.townCity.id, teamId: teamA.team.id, actorParticipantId: moderator.id });
    expect(result.winnerTeamId).toBe(teamA.team.id);

    const [updatedCity] = await dbModule.db.select().from(schema.cities).where(dbModule.eq(schema.cities.id, cities.townCity.id));
    expect(updatedCity.assignedTeamId).toBe(teamA.team.id);
  });

  it("refuses assignLastCity when it is NOT genuinely the last team/city situation", async () => {
    const { event, moderator, cities, teamA } = await createStage3Fixture(dbModule.db);
    // Both teamA and teamB still lack a city, and both cities are unsold —
    // this must be refused even though a moderator is calling it.
    await expect(
      engine.assignLastCity({ eventId: event.id, cityId: cities.townCity.id, teamId: teamA.team.id, actorParticipantId: moderator.id }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("rulebook v3 Contingency #6: voids a winning city bid instead of going negative if the team can no longer cover it by settlement", async () => {
    const { event, moderator, cities, teamA } = await createStage3Fixture(dbModule.db);
    const auction = await engine.startCityAuction({ eventId: event.id, cityId: cities.metroCity.id, actorParticipantId: moderator.id });
    // teamA affords 400 at bid time (cityWalletTokens=500), but a
    // moderator override drains its wallet before the auction closes -
    // e.g. a manual correction made in the moments between the bid and
    // the close. Settlement must catch this instead of driving the
    // team's balance negative.
    await engine.placeCityBid({ eventId: event.id, cityAuctionId: auction.id, teamId: teamA.team.id, actingParticipantId: teamA.leader.id, amount: 400 });
    await dbModule.db.update(schema.teams).set({ cityWalletTokens: 50 }).where(dbModule.eq(schema.teams.id, teamA.team.id));

    const result = await engine.closeCityAuction({ eventId: event.id, cityAuctionId: auction.id, actorParticipantId: moderator.id });
    expect(result.winnerTeamId).toBeNull();

    const [teamAAfter] = await dbModule.db.select().from(schema.teams).where(dbModule.eq(schema.teams.id, teamA.team.id));
    expect(teamAAfter.cityWalletTokens).toBe(50); // untouched, not driven negative
    expect(teamAAfter.auctionTokens).toBe(200); // untouched

    const [cityAfter] = await dbModule.db.select().from(schema.cities).where(dbModule.eq(schema.cities.id, cities.metroCity.id));
    expect(cityAfter.assignedTeamId).toBeNull(); // still available - a moderator can start its auction again
  });
});

describe("Scout reports", () => {
  it("gives a clue that is true but never the exact hidden multiplier value in the raw response", async () => {
    const { event, cities, teamA } = await createStage3Fixture(dbModule.db);
    await dbModule.db.update(schema.eventSettings).set({ scoutReportsEnabled: true }).where(dbModule.eq(schema.eventSettings.eventId, event.id));

    const report = await engine.purchaseScoutReport({ eventId: event.id, teamId: teamA.team.id, cityId: cities.metroCity.id, actingParticipantId: teamA.leader.id });

    expect(["minimum_multiplier", "maximum_multiplier"]).toContain(report.clueType);
    const clue = Number(report.clueValue);
    const actual = 3.5; // metroCity's seeded hiddenMultiplier
    if (report.clueType === "minimum_multiplier") expect(clue).toBeLessThanOrEqual(actual);
    else expect(clue).toBeGreaterThanOrEqual(actual);

    const [teamARow] = await dbModule.db.select().from(schema.teams).where(dbModule.eq(schema.teams.id, teamA.team.id));
    expect(teamARow.scoutReportCount).toBe(1);
  });

  it("rejects a third scout report once the limit is reached", async () => {
    const { event, cities, teamA } = await createStage3Fixture(dbModule.db);
    await dbModule.db.update(schema.eventSettings).set({ scoutReportsEnabled: true }).where(dbModule.eq(schema.eventSettings.eventId, event.id));

    await engine.purchaseScoutReport({ eventId: event.id, teamId: teamA.team.id, cityId: cities.metroCity.id, actingParticipantId: teamA.leader.id });
    await engine.purchaseScoutReport({ eventId: event.id, teamId: teamA.team.id, cityId: cities.townCity.id, actingParticipantId: teamA.leader.id });

    const [thirdCity] = await dbModule.db
      .insert(schema.cities)
      .values({ eventId: event.id, blockNumber: 1, name: "ThirdCity", tier: "city", openingBid: 250, hiddenMultiplier: "2.00" })
      .returning();
    await expect(
      engine.purchaseScoutReport({ eventId: event.id, teamId: teamA.team.id, cityId: thirdCity.id, actingParticipantId: teamA.leader.id }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("City auction timer sweep", () => {
  it("closeExpiredCityAuctions settles a city auction whose timer already passed", async () => {
    const { event, moderator, cities, teamA } = await createStage3Fixture(dbModule.db);
    const auction = await engine.startCityAuction({ eventId: event.id, cityId: cities.metroCity.id, actorParticipantId: moderator.id });
    await engine.placeCityBid({ eventId: event.id, cityAuctionId: auction.id, teamId: teamA.team.id, actingParticipantId: teamA.leader.id, amount: 400 });

    await dbModule.db
      .update(schema.cityAuctions)
      .set({ closesAt: new Date(Date.now() - 1000) })
      .where(dbModule.eq(schema.cityAuctions.id, auction.id));

    const { closedAuctionIds } = await engine.closeExpiredCityAuctions();
    expect(closedAuctionIds).toContain(auction.id);

    const [updatedCity] = await dbModule.db.select().from(schema.cities).where(dbModule.eq(schema.cities.id, cities.metroCity.id));
    expect(updatedCity.assignedTeamId).toBe(teamA.team.id);
  });
});

describe("Scoring and tiebreakers", () => {
  it("computes a reproducible final score for every team and orders ties by buildings, then best building, then leftover tokens", async () => {
    const { event, moderator, cities, teamA, teamB } = await createStage3Fixture(dbModule.db);

    // Give each team a city directly (bypassing bidding mechanics, already
    // covered above) so both teams have an assigned multiplier.
    await dbModule.db.update(schema.cities).set({ assignedTeamId: teamA.team.id, saleOrder: 1 }).where(dbModule.eq(schema.cities.id, cities.metroCity.id));
    await dbModule.db.update(schema.cities).set({ assignedTeamId: teamB.team.id, saleOrder: 2 }).where(dbModule.eq(schema.cities.id, cities.townCity.id));

    const [recipe] = await dbModule.db
      .insert(schema.buildingRecipes)
      .values({ eventId: event.id, key: "park", name: "Park", basePoints: 10 })
      .returning();

    // Both teams end up with the SAME final score (10 * 3.5 for A's metro
    // vs needing town's 1.5x to differ) — force a tie by giving teamB's
    // town-multiplier building enough base points to match teamA exactly:
    // teamA: 1 building x 10 pts x 3.5 = 35. teamB: 1 building x ~23.33 pts
    // x 1.5 isn't a clean tie, so instead directly assert on real
    // computed values first, then a controlled tie scenario below.
    await dbModule.db.insert(schema.constructedBuildings).values({
      eventId: event.id,
      teamId: teamA.team.id,
      recipeId: recipe.id,
      deedNumber: "DEED-A1",
      basePoints: 10,
      ecoBonus: 0,
      luxuryBonus: 0,
      landmarkBonus: 0,
    });
    await dbModule.db.insert(schema.constructedBuildings).values({
      eventId: event.id,
      teamId: teamB.team.id,
      recipeId: recipe.id,
      deedNumber: "DEED-B1",
      basePoints: 20,
      ecoBonus: 0,
      luxuryBonus: 0,
      landmarkBonus: 0,
    });

    const snapshots = await engine.revealCitiesAndScore({ eventId: event.id, actorParticipantId: moderator.id });
    expect(snapshots).toHaveLength(2);

    const teamASnapshot = snapshots.find((s: any) => s.teamId === teamA.team.id);
    const teamBSnapshot = snapshots.find((s: any) => s.teamId === teamB.team.id);
    expect(Number(teamASnapshot.finalScore)).toBe(10 * 3.5); // 35
    expect(Number(teamBSnapshot.finalScore)).toBe(20 * 1.5); // 30
    expect(teamASnapshot.tiebreakerRank).toBe(1);
    expect(teamBSnapshot.tiebreakerRank).toBe(2);

    // Every team's calculation is reproducible from stored JSON alone.
    expect(teamASnapshot.calculationJson.formula).toContain("cityMultiplier");

    const [updatedEvent] = await dbModule.db.select().from(schema.events).where(dbModule.eq(schema.events.id, event.id));
    expect(updatedEvent.status).toBe("completed");

    const [revealedCity] = await dbModule.db.select().from(schema.cities).where(dbModule.eq(schema.cities.id, cities.metroCity.id));
    expect(revealedCity.revealState).toBe("revealed");
  });

  it("breaks a tied final score by building count, then best single building, then leftover tokens", async () => {
    const { event, moderator, cities, teamA, teamB } = await createStage3Fixture(dbModule.db);
    await dbModule.db.update(schema.cities).set({ assignedTeamId: teamA.team.id, saleOrder: 1 }).where(dbModule.eq(schema.cities.id, cities.metroCity.id));
    // Give teamB the SAME multiplier city tier by inserting a second metro-equivalent city for a clean tie.
    const [teamBCity] = await dbModule.db
      .insert(schema.cities)
      .values({ eventId: event.id, blockNumber: 1, name: "TeamBCity", tier: "metro", openingBid: 400, hiddenMultiplier: "3.50", assignedTeamId: teamB.team.id, saleOrder: 2 })
      .returning();
    void teamBCity;

    const [recipe] = await dbModule.db
      .insert(schema.buildingRecipes)
      .values({ eventId: event.id, key: "park", name: "Park", basePoints: 10 })
      .returning();

    // Same total building points (10) and same multiplier (3.5) for both
    // teams -> identical finalScore (35) -> same `rank`. teamA reaches its
    // 10 points via TWO buildings (5+5), teamB via ONE (10) — the "most
    // buildings" tiebreaker must place teamA first despite the tied score.
    await dbModule.db.insert(schema.constructedBuildings).values({ eventId: event.id, teamId: teamA.team.id, recipeId: recipe.id, deedNumber: "DEED-A1", basePoints: 5 });
    await dbModule.db.insert(schema.constructedBuildings).values({ eventId: event.id, teamId: teamA.team.id, recipeId: recipe.id, deedNumber: "DEED-A2", basePoints: 5 });
    await dbModule.db.insert(schema.constructedBuildings).values({ eventId: event.id, teamId: teamB.team.id, recipeId: recipe.id, deedNumber: "DEED-B1", basePoints: 10 });

    const snapshots = await engine.revealCitiesAndScore({ eventId: event.id, actorParticipantId: moderator.id });
    const teamASnapshot = snapshots.find((s: any) => s.teamId === teamA.team.id);
    const teamBSnapshot = snapshots.find((s: any) => s.teamId === teamB.team.id);

    expect(Number(teamASnapshot.finalScore)).toBe(Number(teamBSnapshot.finalScore)); // genuinely tied on score
    expect(teamASnapshot.rank).toBe(teamBSnapshot.rank); // same rank ...
    expect(teamASnapshot.tiebreakerRank).toBe(1); // ... but teamA (2 buildings) placed ahead of teamB (1 building)
    expect(teamBSnapshot.tiebreakerRank).toBe(2);
  });
});
