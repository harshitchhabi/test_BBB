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

describe("deleteTeam", () => {
  it("permanently removes a team and everything exclusively its own, without breaking a shared lot's history", async () => {
    const { event, moderator, material, teamA, teamB } = await createTestFixture(dbModule.db);
    const round = await engine.startRound({ eventId: event.id, materialTypeId: material.id, actorParticipantId: moderator.id });
    const lot = await engine.openNextLot({ eventId: event.id, roundId: round.id, actorParticipantId: moderator.id });

    // teamA wins the lot; teamB also bid (and lost) on the same lot — this
    // is the case that would break if deleteTeam mishandled shared rows.
    await engine.placeBid({ eventId: event.id, auctionLotId: lot.id, teamId: teamB.team.id, actingParticipantId: teamB.leader.id, amount: 650 });
    await engine.placeBid({ eventId: event.id, auctionLotId: lot.id, teamId: teamA.team.id, actingParticipantId: teamA.leader.id, amount: 700 });
    await engine.closeLot({ eventId: event.id, auctionLotId: lot.id, actorParticipantId: moderator.id, reason: "close" });

    const [closedLot] = await dbModule.db.select().from(schema.auctionLots).where(dbModule.eq(schema.auctionLots.id, lot.id));
    expect(closedLot.winnerTeamId).toBe(teamA.team.id);

    // Delete the WINNING team.
    const result = await engine.deleteTeam({ eventId: event.id, teamId: teamA.team.id, actorParticipantId: moderator.id, reason: "Duplicate registration." });
    expect(result.teamId).toBe(teamA.team.id);

    // Team itself and its membership are gone.
    const [deletedTeam] = await dbModule.db.select().from(schema.teams).where(dbModule.eq(schema.teams.id, teamA.team.id));
    expect(deletedTeam).toBeUndefined();
    const remainingMembers = await dbModule.db.select().from(schema.teamMembers).where(dbModule.eq(schema.teamMembers.teamId, teamA.team.id));
    expect(remainingMembers).toHaveLength(0);

    // The lot itself survives, but no longer claims the deleted team won it.
    const [lotAfter] = await dbModule.db.select().from(schema.auctionLots).where(dbModule.eq(schema.auctionLots.id, lot.id));
    expect(lotAfter).toBeDefined();
    expect(lotAfter.winnerTeamId).toBeNull();

    // teamB's own (losing) bid is untouched — deleting teamA never
    // touches another team's rows.
    const teamBBids = await dbModule.db.select().from(schema.bids).where(dbModule.eq(schema.bids.teamId, teamB.team.id));
    expect(teamBBids).toHaveLength(1);
    expect(teamBBids[0].status).toBe("outbid");

    // teamA's own bid row is gone.
    const teamABids = await dbModule.db.select().from(schema.bids).where(dbModule.eq(schema.bids.teamId, teamA.team.id));
    expect(teamABids).toHaveLength(0);
  });

  it("requires a reason and staff status", async () => {
    const { event, moderator, teamA } = await createTestFixture(dbModule.db);
    await expect(
      engine.deleteTeam({ eventId: event.id, teamId: teamA.team.id, actorParticipantId: teamA.member.id, reason: "x" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      engine.deleteTeam({ eventId: event.id, teamId: teamA.team.id, actorParticipantId: moderator.id, reason: "" }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});
