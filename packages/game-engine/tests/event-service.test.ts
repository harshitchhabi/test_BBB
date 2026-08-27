import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { startTestDatabase, type TestDb } from "./test-db";

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

describe("Event stage control (setEventStatus)", () => {
  it("walks an event through the full sequence and rejects skipping a stage", async () => {
    const [event] = await dbModule.db.insert(schema.events).values({ name: "Stage Control Test" }).returning();
    await dbModule.db.insert(schema.eventSettings).values({ eventId: event.id });
    const [moderator] = await dbModule.db.insert(schema.participants).values({ name: "Mod", email: `mod-${event.id}@test.local` }).returning();
    await dbModule.db.insert(schema.eventStaff).values({ eventId: event.id, participantId: moderator.id, role: "moderator" });

    expect(event.status).toBe("setup");

    // Can't jump straight from setup to stage_1.
    await expect(
      engine.setEventStatus({ eventId: event.id, status: "stage_1", actorParticipantId: moderator.id }),
    ).rejects.toMatchObject({ code: "invalid_event_stage" });

    const toLobby = await engine.setEventStatus({ eventId: event.id, status: "lobby", actorParticipantId: moderator.id });
    expect(toLobby.status).toBe("lobby");

    const toStage1 = await engine.setEventStatus({ eventId: event.id, status: "stage_1", actorParticipantId: moderator.id });
    expect(toStage1.status).toBe("stage_1");
    expect(toStage1.startedAt).not.toBeNull();

    // Now the exact action that was broken before this fix: starting a
    // round requires status stage_1, which the event has just reached.
    const [material] = await dbModule.db
      .insert(schema.materialTypes)
      .values({ eventId: event.id, key: "bricks", name: "Bricks", unitLabel: "units", stickerPrice: 1, isRare: false, isBonusOnly: false, sortOrder: 1, defaultLotQuantity: 100, defaultOpeningBid: 100 })
      .returning();
    const [leader] = await dbModule.db.insert(schema.participants).values({ name: "Leader", email: `leader-${event.id}@test.local` }).returning();
    const [team] = await dbModule.db.insert(schema.teams).values({ eventId: event.id, name: "A", code: "AAAAAA", ownerParticipantId: leader.id }).returning();
    await dbModule.db.insert(schema.teamMembers).values({ eventId: event.id, teamId: team.id, participantId: leader.id, role: "leader" });

    const round = await engine.startRound({ eventId: event.id, materialTypeId: material.id, actorParticipantId: moderator.id });
    expect(round.status).toBe("active");
  });

  it("requires a reason to pause, and rejects a non-staff actor", async () => {
    const [event] = await dbModule.db.insert(schema.events).values({ name: "Pause Test", status: "lobby" }).returning();
    const [moderator] = await dbModule.db.insert(schema.participants).values({ name: "Mod", email: `mod2-${event.id}@test.local` }).returning();
    await dbModule.db.insert(schema.eventStaff).values({ eventId: event.id, participantId: moderator.id, role: "moderator" });
    const [randomPerson] = await dbModule.db.insert(schema.participants).values({ name: "Random", email: `random-${event.id}@test.local` }).returning();

    await expect(
      engine.setEventStatus({ eventId: event.id, status: "paused", actorParticipantId: moderator.id }),
    ).rejects.toMatchObject({ code: "conflict" });

    await expect(
      engine.setEventStatus({ eventId: event.id, status: "paused", actorParticipantId: randomPerson.id, reason: "test" }),
    ).rejects.toMatchObject({ code: "forbidden" });

    const paused = await engine.setEventStatus({ eventId: event.id, status: "paused", actorParticipantId: moderator.id, reason: "Fire alarm." });
    expect(paused.status).toBe("paused");

    // Resuming FROM paused is an override too (isOverride checks either
    // side of the transition), so it also requires a reason.
    await expect(
      engine.setEventStatus({ eventId: event.id, status: "lobby", actorParticipantId: moderator.id }),
    ).rejects.toMatchObject({ code: "conflict" });

    const resumed = await engine.setEventStatus({ eventId: event.id, status: "lobby", actorParticipantId: moderator.id, reason: "All clear." });
    expect(resumed.status).toBe("lobby");
  });
});
