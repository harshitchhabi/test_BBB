import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { startTestDatabase, type TestDb } from "./test-db";
import { createStage2Fixture, grantInventory } from "./stage2-fixtures";

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

describe("Construction", () => {
  it("fails when even one required unit is missing", async () => {
    const { event, materials, recipes, teamA } = await createStage2Fixture(dbModule.db);
    await grantInventory(dbModule.db, event.id, teamA.team.id, materials.bricks.id, 50);
    await grantInventory(dbModule.db, event.id, teamA.team.id, materials.cement.id, 20);
    await grantInventory(dbModule.db, event.id, teamA.team.id, materials.wood.id, 39); // one short
    await grantInventory(dbModule.db, event.id, teamA.team.id, materials.furniture.id, 1);

    await expect(
      engine.constructBuilding({ eventId: event.id, teamId: teamA.team.id, recipeId: recipes.park.id, actorParticipantId: teamA.leader.id }),
    ).rejects.toMatchObject({ code: "recipe_incomplete" });
  });

  it("succeeds with exact materials, applies eco + landmark bonuses, and every consumed unit traces back to this building", async () => {
    const { event, materials, recipes, teamA } = await createStage2Fixture(dbModule.db);
    await grantInventory(dbModule.db, event.id, teamA.team.id, materials.bricks.id, 50);
    await grantInventory(dbModule.db, event.id, teamA.team.id, materials.cement.id, 20);
    await grantInventory(dbModule.db, event.id, teamA.team.id, materials.wood.id, 40);
    await grantInventory(dbModule.db, event.id, teamA.team.id, materials.furniture.id, 1);
    await grantInventory(dbModule.db, event.id, teamA.team.id, materials.solar.id, 4);
    await grantInventory(dbModule.db, event.id, teamA.team.id, materials.blueprint.id, 1);

    const building = await engine.constructBuilding({
      eventId: event.id,
      teamId: teamA.team.id,
      recipeId: recipes.park.id,
      bonuses: { eco: true, landmark: true },
      actorParticipantId: teamA.leader.id,
    });

    expect(building.basePoints).toBe(13);
    expect(building.ecoBonus).toBe(10);
    expect(building.landmarkBonus).toBe(20);
    expect(building.deedNumber).toMatch(/^DEED-/);

    // Trace: every unit this building consumed is reconstructable from the
    // ledger alone.
    const consumedRows = await dbModule.db
      .select()
      .from(schema.teamInventoryTransactions)
      .where(
        dbModule.and(
          dbModule.eq(schema.teamInventoryTransactions.relatedEntityType, "constructed_building"),
          dbModule.eq(schema.teamInventoryTransactions.relatedEntityId, building.id),
        ),
      );
    const byMaterial = new Map(consumedRows.map((r: any) => [r.materialTypeId, -r.quantityDelta]));
    expect(byMaterial.get(materials.bricks.id)).toBe(50);
    expect(byMaterial.get(materials.cement.id)).toBe(20);
    expect(byMaterial.get(materials.wood.id)).toBe(40);
    expect(byMaterial.get(materials.furniture.id)).toBe(1);
    expect(byMaterial.get(materials.solar.id)).toBe(4);
    expect(byMaterial.get(materials.blueprint.id)).toBe(1);
  });

  it("rejects a luxury bonus on a recipe that isn't Mall/University/Office", async () => {
    const { event, materials, recipes, teamA } = await createStage2Fixture(dbModule.db);
    await grantInventory(dbModule.db, event.id, teamA.team.id, materials.bricks.id, 50);
    await grantInventory(dbModule.db, event.id, teamA.team.id, materials.cement.id, 20);
    await grantInventory(dbModule.db, event.id, teamA.team.id, materials.wood.id, 40);
    await grantInventory(dbModule.db, event.id, teamA.team.id, materials.furniture.id, 1);
    await grantInventory(dbModule.db, event.id, teamA.team.id, materials.marble.id, 1);

    await expect(
      engine.constructBuilding({
        eventId: event.id,
        teamId: teamA.team.id,
        recipeId: recipes.park.id,
        bonuses: { luxury: true, luxuryMaterialKey: "marble" },
        actorParticipantId: teamA.leader.id,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("Authorization", () => {
  it("rejects construction, bank purchase, trade proposal, and inspection requests from a non-leader team member", async () => {
    const { event, materials, recipes, teamA, teamB } = await createStage2Fixture(dbModule.db);
    await grantInventory(dbModule.db, event.id, teamA.team.id, materials.bricks.id, 50);

    await expect(
      engine.constructBuilding({ eventId: event.id, teamId: teamA.team.id, recipeId: recipes.park.id, actorParticipantId: teamA.member.id }),
    ).rejects.toMatchObject({ code: "forbidden" });

    await expect(
      engine.purchaseFromBank({ eventId: event.id, teamId: teamA.team.id, materialTypeId: materials.bricks.id, quantity: 1, actingParticipantId: teamA.member.id }),
    ).rejects.toMatchObject({ code: "forbidden" });

    await expect(
      engine.proposeTrade({
        eventId: event.id,
        proposerTeamId: teamA.team.id,
        counterpartyTeamId: teamB.team.id,
        proposerParticipantId: teamA.member.id,
        lines: [{ fromTeamId: teamA.team.id, materialTypeId: materials.bricks.id, quantity: 1 }],
      }),
    ).rejects.toMatchObject({ code: "forbidden" });

    await expect(
      engine.requestInspection({ eventId: event.id, challengerTeamId: teamA.team.id, targetBuildingId: "00000000-0000-0000-0000-000000000000", actingParticipantId: teamA.member.id }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("rejects moderator-only actions (register/complete/reject trade, void building, resolve inspection) from a non-staff participant", async () => {
    const { event, teamA } = await createStage2Fixture(dbModule.db);
    const fakeModeratorId = teamA.member.id; // a real participant, just not staff for this event

    await expect(
      engine.registerTrade({ eventId: event.id, tradeId: "00000000-0000-0000-0000-000000000000", moderatorParticipantId: fakeModeratorId }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      engine.rejectTrade({ eventId: event.id, tradeId: "00000000-0000-0000-0000-000000000000", moderatorParticipantId: fakeModeratorId, reason: "x" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      engine.completeTrade({ eventId: event.id, tradeId: "00000000-0000-0000-0000-000000000000", moderatorParticipantId: fakeModeratorId }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      engine.voidBuilding({ eventId: event.id, buildingId: "00000000-0000-0000-0000-000000000000", moderatorParticipantId: fakeModeratorId, reason: "x" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      engine.resolveInspection({ eventId: event.id, inspectionId: "00000000-0000-0000-0000-000000000000", result: "passed", moderatorParticipantId: fakeModeratorId }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("Trading", () => {
  it("conserves total material quantity across both teams and enforces the trade limit", async () => {
    const { event, materials, moderator, teamA, teamB } = await createStage2Fixture(dbModule.db);
    await grantInventory(dbModule.db, event.id, teamA.team.id, materials.bricks.id, 100);

    const trade = await engine.proposeTrade({
      eventId: event.id,
      proposerTeamId: teamA.team.id,
      counterpartyTeamId: teamB.team.id,
      proposerParticipantId: teamA.leader.id,
      lines: [{ fromTeamId: teamA.team.id, materialTypeId: materials.bricks.id, quantity: 30 }],
    });
    await engine.registerTrade({ eventId: event.id, tradeId: trade.id, moderatorParticipantId: moderator.id });
    await engine.completeTrade({ eventId: event.id, tradeId: trade.id, moderatorParticipantId: moderator.id });

    const [teamARow] = await dbModule.db.select().from(schema.teams).where(dbModule.eq(schema.teams.id, teamA.team.id));
    const [teamBRow] = await dbModule.db.select().from(schema.teams).where(dbModule.eq(schema.teams.id, teamB.team.id));
    expect(teamARow.tradeCount).toBe(1);
    expect(teamBRow.tradeCount).toBe(1);

    const inventory = await dbModule.db
      .select()
      .from(schema.teamInventoryTransactions)
      .where(dbModule.eq(schema.teamInventoryTransactions.materialTypeId, materials.bricks.id));
    const totalDelta = inventory.reduce((sum: number, r: any) => sum + r.quantityDelta, 0);
    expect(totalDelta).toBe(100); // 100 granted in, -30/+30 traded — net total unchanged

    // Now push teamA to its trade limit (default 4) using handshake-free
    // registered trades against teamB, and confirm the 5th is refused.
    for (let i = 0; i < 3; i++) {
      await grantInventory(dbModule.db, event.id, teamA.team.id, materials.bricks.id, 5);
      const t = await engine.proposeTrade({
        eventId: event.id,
        proposerTeamId: teamA.team.id,
        counterpartyTeamId: teamB.team.id,
        proposerParticipantId: teamA.leader.id,
        lines: [{ fromTeamId: teamA.team.id, materialTypeId: materials.bricks.id, quantity: 1 }],
      });
      await engine.registerTrade({ eventId: event.id, tradeId: t.id, moderatorParticipantId: moderator.id });
      await engine.completeTrade({ eventId: event.id, tradeId: t.id, moderatorParticipantId: moderator.id });
    }

    const [teamARowAfter] = await dbModule.db.select().from(schema.teams).where(dbModule.eq(schema.teams.id, teamA.team.id));
    expect(teamARowAfter.tradeCount).toBe(4);

    await grantInventory(dbModule.db, event.id, teamA.team.id, materials.bricks.id, 1);
    const fifthTrade = await engine.proposeTrade({
      eventId: event.id,
      proposerTeamId: teamA.team.id,
      counterpartyTeamId: teamB.team.id,
      proposerParticipantId: teamA.leader.id,
      lines: [{ fromTeamId: teamA.team.id, materialTypeId: materials.bricks.id, quantity: 1 }],
    });
    await engine.registerTrade({ eventId: event.id, tradeId: fifthTrade.id, moderatorParticipantId: moderator.id });
    await expect(
      engine.completeTrade({ eventId: event.id, tradeId: fifthTrade.id, moderatorParticipantId: moderator.id }),
    ).rejects.toMatchObject({ code: "trade_limit_reached" });
  });
});

describe("Bank purchases", () => {
  it("charges the rare-material tax rate and depletes finite bank stock", async () => {
    const { event, materials, teamA } = await createStage2Fixture(dbModule.db);

    // Seed bank stock for the rare material (steel) directly, as if it
    // went unsold in Stage 1.
    await dbModule.db.insert(schema.materialLots).values({
      eventId: event.id,
      materialTypeId: materials.steel.id,
      quantity: 10,
      openingBid: 800,
      source: "bank",
      status: "bank_stock",
    });

    const purchase = await engine.purchaseFromBank({
      eventId: event.id,
      teamId: teamA.team.id,
      materialTypeId: materials.steel.id,
      quantity: 10,
      actingParticipantId: teamA.leader.id,
    });

    // stickerPrice=10/unit * 10 units = 100 base; steel is rare -> 20% tax -> +20 -> 120 total.
    expect(purchase.basePrice).toBe(100);
    expect(purchase.taxRatePercent).toBe(20);
    expect(purchase.taxAmount).toBe(20);
    expect(purchase.totalCost).toBe(120);

    const [teamARow] = await dbModule.db.select().from(schema.teams).where(dbModule.eq(schema.teams.id, teamA.team.id));
    expect(teamARow.auctionTokens).toBe(1000 - 120);

    // Bank is now empty — an 11th unit purchase must fail.
    await expect(
      engine.purchaseFromBank({ eventId: event.id, teamId: teamA.team.id, materialTypeId: materials.steel.id, quantity: 1, actingParticipantId: teamA.leader.id }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("Inspections", () => {
  it("voids a failed building and returns its exact materials to the bank, not the team", async () => {
    const { event, materials, recipes, moderator, teamA, teamB } = await createStage2Fixture(dbModule.db);
    await grantInventory(dbModule.db, event.id, teamA.team.id, materials.bricks.id, 50);
    await grantInventory(dbModule.db, event.id, teamA.team.id, materials.cement.id, 20);
    await grantInventory(dbModule.db, event.id, teamA.team.id, materials.wood.id, 40);
    await grantInventory(dbModule.db, event.id, teamA.team.id, materials.furniture.id, 1);

    const building = await engine.constructBuilding({ eventId: event.id, teamId: teamA.team.id, recipeId: recipes.park.id, actorParticipantId: teamA.leader.id });

    const inspection = await engine.requestInspection({
      eventId: event.id,
      challengerTeamId: teamB.team.id,
      targetBuildingId: building.id,
      actingParticipantId: teamB.leader.id,
    });

    const [teamBAfterRequest] = await dbModule.db.select().from(schema.teams).where(dbModule.eq(schema.teams.id, teamB.team.id));
    expect(teamBAfterRequest.auctionTokens).toBe(1000 - 150); // forfeited immediately

    await engine.resolveInspection({ eventId: event.id, inspectionId: inspection.id, result: "failed", moderatorParticipantId: moderator.id });

    const [updatedBuilding] = await dbModule.db.select().from(schema.constructedBuildings).where(dbModule.eq(schema.constructedBuildings.id, building.id));
    expect(updatedBuilding.status).toBe("voided");

    // Materials went to the BANK, not back to teamA.
    const bankLots = await dbModule.db
      .select()
      .from(schema.materialLots)
      .where(dbModule.and(dbModule.eq(schema.materialLots.materialTypeId, materials.bricks.id), dbModule.eq(schema.materialLots.status, "bank_stock")));
    const totalReturned = bankLots.reduce((sum: number, l: any) => sum + l.quantity, 0);
    expect(totalReturned).toBe(50);
  });
});
