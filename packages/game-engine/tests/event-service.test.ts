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
    const [moderator] = await dbModule.db.insert(schema.participants).values({ name: "Mod", email: `mod-${event.id}@test.local`, username: `mod-${event.id}`, passwordHash: "$2a$10$CwTycUXWue0Thq9StjUM0uJ8oxL/Yjyq6XvXqAtVvjGdiWZOWXQNi" }).returning();
    await dbModule.db.insert(schema.eventStaff).values({ eventId: event.id, participantId: moderator.id, role: "staff" });

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
    const [leader] = await dbModule.db.insert(schema.participants).values({ name: "Leader", email: `leader-${event.id}@test.local`, username: `leader-${event.id}`, passwordHash: "$2a$10$CwTycUXWue0Thq9StjUM0uJ8oxL/Yjyq6XvXqAtVvjGdiWZOWXQNi" }).returning();
    const [team] = await dbModule.db.insert(schema.teams).values({ eventId: event.id, name: "A", code: "AAAAAA", ownerParticipantId: leader.id }).returning();
    await dbModule.db.insert(schema.teamMembers).values({ eventId: event.id, teamId: team.id, participantId: leader.id, role: "leader" });

    const round = await engine.startRound({ eventId: event.id, materialTypeId: material.id, actorParticipantId: moderator.id });
    expect(round.status).toBe("active");
  });

  it("doesn't require a reason to pause/resume, but still logs a clear placeholder when one isn't given, and rejects a non-staff actor", async () => {
    const [event] = await dbModule.db.insert(schema.events).values({ name: "Pause Test", status: "lobby" }).returning();
    const [moderator] = await dbModule.db.insert(schema.participants).values({ name: "Mod", email: `mod2-${event.id}@test.local`, username: `mod2-${event.id}`, passwordHash: "$2a$10$CwTycUXWue0Thq9StjUM0uJ8oxL/Yjyq6XvXqAtVvjGdiWZOWXQNi" }).returning();
    await dbModule.db.insert(schema.eventStaff).values({ eventId: event.id, participantId: moderator.id, role: "staff" });
    const [randomPerson] = await dbModule.db.insert(schema.participants).values({ name: "Random", email: `random-${event.id}@test.local`, username: `random-${event.id}`, passwordHash: "$2a$10$CwTycUXWue0Thq9StjUM0uJ8oxL/Yjyq6XvXqAtVvjGdiWZOWXQNi" }).returning();

    await expect(
      engine.setEventStatus({ eventId: event.id, status: "paused", actorParticipantId: randomPerson.id, reason: "test" }),
    ).rejects.toMatchObject({ code: "forbidden" });

    const paused = await engine.setEventStatus({ eventId: event.id, status: "paused", actorParticipantId: moderator.id });
    expect(paused.status).toBe("paused");
    const [pauseEntry] = await dbModule.db
      .select()
      .from(schema.auditLog)
      .where(dbModule.and(dbModule.eq(schema.auditLog.eventId, event.id), dbModule.eq(schema.auditLog.action, "event.stage_changed")))
      .orderBy(dbModule.desc(schema.auditLog.createdAt));
    expect(pauseEntry.reason).toBe("No reason given");

    // Resuming FROM paused works the same way, reason still optional.
    const resumed = await engine.setEventStatus({ eventId: event.id, status: "lobby", actorParticipantId: moderator.id, reason: "All clear." });
    expect(resumed.status).toBe("lobby");
  });

  it("blocks advancing out of stage_1 while a lot is still live, and allows it once closed", async () => {
    const [event] = await dbModule.db.insert(schema.events).values({ name: "Live Lot Guard Test", status: "stage_1" }).returning();
    await dbModule.db.insert(schema.eventSettings).values({ eventId: event.id });
    const [moderator] = await dbModule.db.insert(schema.participants).values({ name: "Mod", email: `mod3-${event.id}@test.local`, username: `mod3-${event.id}`, passwordHash: "$2a$10$CwTycUXWue0Thq9StjUM0uJ8oxL/Yjyq6XvXqAtVvjGdiWZOWXQNi" }).returning();
    await dbModule.db.insert(schema.eventStaff).values({ eventId: event.id, participantId: moderator.id, role: "staff" });
    const [material] = await dbModule.db
      .insert(schema.materialTypes)
      .values({ eventId: event.id, key: "bricks", name: "Bricks", unitLabel: "units", stickerPrice: 1, isRare: false, isBonusOnly: false, sortOrder: 1, defaultLotQuantity: 100, defaultOpeningBid: 100 })
      .returning();
    const [leader] = await dbModule.db.insert(schema.participants).values({ name: "Leader", email: `leader3-${event.id}@test.local`, username: `leader3-${event.id}`, passwordHash: "$2a$10$CwTycUXWue0Thq9StjUM0uJ8oxL/Yjyq6XvXqAtVvjGdiWZOWXQNi" }).returning();
    const [team] = await dbModule.db.insert(schema.teams).values({ eventId: event.id, name: "A", code: "BBBBBB", ownerParticipantId: leader.id }).returning();
    await dbModule.db.insert(schema.teamMembers).values({ eventId: event.id, teamId: team.id, participantId: leader.id, role: "leader" });

    const round = await engine.startRound({ eventId: event.id, materialTypeId: material.id, actorParticipantId: moderator.id });
    const lot = await engine.openNextLot({ eventId: event.id, roundId: round.id, actorParticipantId: moderator.id });
    expect(lot.status).toBe("live");

    // The exact bug this test guards against: without the fix, this
    // transition would silently succeed and orphan the live lot forever
    // (placeBid/closeLot both require stage_1, so it could never close
    // through the normal flow again).
    await expect(
      engine.setEventStatus({ eventId: event.id, status: "stage_2", actorParticipantId: moderator.id }),
    ).rejects.toMatchObject({ code: "conflict" });

    await engine.closeLot({ eventId: event.id, auctionLotId: lot.id, actorParticipantId: moderator.id });

    const advanced = await engine.setEventStatus({ eventId: event.id, status: "stage_2", actorParticipantId: moderator.id });
    expect(advanced.status).toBe("stage_2");
  });
});

describe("forceEventStage (Task 3: admin stage override)", () => {
  it("jumps straight to any stage, voiding a live lot along the way, with a reason still optional", async () => {
    const [event] = await dbModule.db.insert(schema.events).values({ name: "Force Stage Test", status: "stage_1" }).returning();
    await dbModule.db.insert(schema.eventSettings).values({ eventId: event.id });
    const [moderator] = await dbModule.db
      .insert(schema.participants)
      .values({ name: "Mod", username: `forcemod-${event.id}`, passwordHash: "$2a$10$CwTycUXWue0Thq9StjUM0uJ8oxL/Yjyq6XvXqAtVvjGdiWZOWXQNi" })
      .returning();
    await dbModule.db.insert(schema.eventStaff).values({ eventId: event.id, participantId: moderator.id });
    const [randomPerson] = await dbModule.db
      .insert(schema.participants)
      .values({ name: "Random", username: `forcerandom-${event.id}`, passwordHash: "$2a$10$CwTycUXWue0Thq9StjUM0uJ8oxL/Yjyq6XvXqAtVvjGdiWZOWXQNi" })
      .returning();

    const [material] = await dbModule.db
      .insert(schema.materialTypes)
      .values({ eventId: event.id, key: "bricks", name: "Bricks", unitLabel: "units", stickerPrice: 1, isRare: false, isBonusOnly: false, sortOrder: 1, defaultLotQuantity: 100, defaultOpeningBid: 100 })
      .returning();
    const [leader] = await dbModule.db
      .insert(schema.participants)
      .values({ name: "Leader", username: `forceleader-${event.id}`, passwordHash: "$2a$10$CwTycUXWue0Thq9StjUM0uJ8oxL/Yjyq6XvXqAtVvjGdiWZOWXQNi" })
      .returning();
    const [team] = await dbModule.db.insert(schema.teams).values({ eventId: event.id, name: "A", code: "BBBBBB", ownerParticipantId: leader.id }).returning();
    await dbModule.db.insert(schema.teamMembers).values({ eventId: event.id, teamId: team.id, participantId: leader.id, role: "leader" });

    const round = await engine.startRound({ eventId: event.id, materialTypeId: material.id, actorParticipantId: moderator.id });
    const lot = await engine.openNextLot({ eventId: event.id, roundId: round.id, actorParticipantId: moderator.id });
    const { bid } = await engine.placeBid({ eventId: event.id, auctionLotId: lot.id, teamId: team.id, actingParticipantId: leader.id, amount: 150 });
    expect(bid.status).toBe("winning");

    // Non-staff is refused; a blank reason is fine (logged with a
    // placeholder rather than blocking the override).
    await expect(
      engine.forceEventStage({ eventId: event.id, status: "stage_3", actorParticipantId: randomPerson.id, reason: "x" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      engine.forceEventStage({ eventId: event.id, status: "not_a_real_stage", actorParticipantId: moderator.id, reason: "test" }),
    ).rejects.toMatchObject({ code: "invalid_input" });

    // Jump straight from stage_1 to stage_3 — normally impossible via
    // setEventStatus (stage_1's only valid next steps are stage_2/paused).
    const forced = await engine.forceEventStage({
      eventId: event.id,
      status: "stage_3",
      actorParticipantId: moderator.id,
      reason: "Skipping Stage 2 for a fast-moving group.",
    });
    expect(forced.status).toBe("stage_3");
    expect(forced.activeRoundId).toBeNull();

    // The live lot that was abandoned mid-bid got voided, not left
    // dangling — and its material went back to the bank, not to
    // whichever team happened to be winning at the moment of the jump.
    const [lotAfter] = await dbModule.db.select().from(schema.auctionLots).where(dbModule.eq(schema.auctionLots.id, lot.id));
    expect(lotAfter.status).toBe("voided");
    const [materialLotAfter] = await dbModule.db.select().from(schema.materialLots).where(dbModule.eq(schema.materialLots.id, lotAfter.materialLotId));
    expect(materialLotAfter.status).toBe("bank_stock");

    const [roundAfter] = await dbModule.db.select().from(schema.auctionRounds).where(dbModule.eq(schema.auctionRounds.id, round.id));
    expect(roundAfter.status).toBe("cancelled");

    // Nobody paid anything — placeBid never deducts tokens, only
    // closeLot does, and this lot never closed.
    const [teamAfter] = await dbModule.db.select().from(schema.teams).where(dbModule.eq(schema.teams.id, team.id));
    expect(teamAfter.auctionTokens).toBe(1000);

    // Can't force it to the stage it's already at.
    await expect(
      engine.forceEventStage({ eventId: event.id, status: "stage_3", actorParticipantId: moderator.id, reason: "again" }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("updateEventSettings", () => {
  it("updates numeric, boolean, and the custom rules note fields, and rejects a non-staff actor", async () => {
    const [event] = await dbModule.db.insert(schema.events).values({ name: "Settings Test" }).returning();
    await dbModule.db.insert(schema.eventSettings).values({ eventId: event.id });
    const [moderator] = await dbModule.db.insert(schema.participants).values({ name: "Mod", email: `mod-${event.id}@test.local`, username: `mod-${event.id}`, passwordHash: "$2a$10$CwTycUXWue0Thq9StjUM0uJ8oxL/Yjyq6XvXqAtVvjGdiWZOWXQNi" }).returning();
    await dbModule.db.insert(schema.eventStaff).values({ eventId: event.id, participantId: moderator.id, role: "staff" });
    const [randomPerson] = await dbModule.db.insert(schema.participants).values({ name: "Random", email: `random-${event.id}@test.local`, username: `random-${event.id}`, passwordHash: "$2a$10$CwTycUXWue0Thq9StjUM0uJ8oxL/Yjyq6XvXqAtVvjGdiWZOWXQNi" }).returning();

    await expect(
      engine.updateEventSettings({ eventId: event.id, actorParticipantId: randomPerson.id, updates: { tradeLimit: 6 } }),
    ).rejects.toMatchObject({ code: "forbidden" });

    const updated = await engine.updateEventSettings({
      eventId: event.id,
      actorParticipantId: moderator.id,
      updates: { tradeLimit: 6, inspectionsEnabled: true, customRulesNote: "No trading Solar during the last 5 minutes." },
    });
    expect(updated.tradeLimit).toBe(6);
    expect(updated.inspectionsEnabled).toBe(true);
    expect(updated.customRulesNote).toBe("No trading Solar during the last 5 minutes.");
    // Untouched fields keep their defaults - a partial update, not a
    // full-row replace that would zero out everything else.
    expect(updated.stage1StartingTokens).toBe(1000);

    // Rejects an out-of-range / wrong-type value instead of silently
    // coercing it or writing garbage.
    await expect(
      engine.updateEventSettings({ eventId: event.id, actorParticipantId: moderator.id, updates: { tradeLimit: -1 } }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("edits rulesContent (the Rules page's actual bullet lines) independently of every settings field, and validates its shape", async () => {
    const [event] = await dbModule.db.insert(schema.events).values({ name: "Rules Content Test" }).returning();
    await dbModule.db.insert(schema.eventSettings).values({ eventId: event.id, tradeLimit: 4 });
    const [moderator] = await dbModule.db
      .insert(schema.participants)
      .values({ name: "Mod", email: `mod-rc-${event.id}@test.local`, username: `mod-rc-${event.id}`, passwordHash: "$2a$10$CwTycUXWue0Thq9StjUM0uJ8oxL/Yjyq6XvXqAtVvjGdiWZOWXQNi" })
      .returning();
    await dbModule.db.insert(schema.eventStaff).values({ eventId: event.id, participantId: moderator.id, role: "staff" });

    const updated = await engine.updateEventSettings({
      eventId: event.id,
      actorParticipantId: moderator.id,
      updates: { rulesContent: { stage1: ["Custom line one", "Custom line two"], tiebreakers: [] } },
    });
    expect(JSON.parse(updated.rulesContent)).toEqual({ stage1: ["Custom line one", "Custom line two"], tiebreakers: [] });
    // Saving rulesContent must never touch any actual gameplay field.
    expect(updated.tradeLimit).toBe(4);

    // Rejects an unknown stage key instead of silently accepting it.
    await expect(
      engine.updateEventSettings({ eventId: event.id, actorParticipantId: moderator.id, updates: { rulesContent: { notARealStage: ["x"] } } }),
    ).rejects.toMatchObject({ code: "invalid_input" });

    // Rejects a non-array value for a stage.
    await expect(
      engine.updateEventSettings({ eventId: event.id, actorParticipantId: moderator.id, updates: { rulesContent: { stage1: "not an array" } } }),
    ).rejects.toMatchObject({ code: "invalid_input" });

    // Rejects a line that's too long rather than truncating it silently.
    await expect(
      engine.updateEventSettings({ eventId: event.id, actorParticipantId: moderator.id, updates: { rulesContent: { stage1: ["x".repeat(301)] } } }),
    ).rejects.toMatchObject({ code: "invalid_input" });

    // null clears it back to "use the auto-generated default".
    const cleared = await engine.updateEventSettings({ eventId: event.id, actorParticipantId: moderator.id, updates: { rulesContent: null } });
    expect(cleared.rulesContent).toBeNull();
  });
});
