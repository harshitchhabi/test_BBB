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

describe("leaveTeam", () => {
  it("lets a regular member leave freely", async () => {
    const { event, teamA } = await createTestFixture(dbModule.db);
    const result = await engine.leaveTeam({ eventId: event.id, participantId: teamA.member.id });
    expect(result.teamId).toBe(teamA.team.id);

    const [row] = await dbModule.db
      .select()
      .from(schema.teamMembers)
      .where(dbModule.and(dbModule.eq(schema.teamMembers.teamId, teamA.team.id), dbModule.eq(schema.teamMembers.participantId, teamA.member.id)));
    expect(row).toBeUndefined();
  });

  it("refuses to let the leader leave while other members remain", async () => {
    const { event, teamA } = await createTestFixture(dbModule.db);
    await expect(engine.leaveTeam({ eventId: event.id, participantId: teamA.leader.id })).rejects.toMatchObject({ code: "conflict" });
  });

  it("lets the leader leave if they are the only member left", async () => {
    const { event, teamA } = await createTestFixture(dbModule.db);
    await engine.leaveTeam({ eventId: event.id, participantId: teamA.member.id }); // member leaves first
    const result = await engine.leaveTeam({ eventId: event.id, participantId: teamA.leader.id }); // now leader can too
    expect(result.teamId).toBe(teamA.team.id);
  });
});

describe("transferLeadership", () => {
  it("lets the current leader hand off to another member", async () => {
    const { event, teamA } = await createTestFixture(dbModule.db);
    const result = await engine.transferLeadership({
      eventId: event.id,
      teamId: teamA.team.id,
      requesterParticipantId: teamA.leader.id,
      newLeaderParticipantId: teamA.member.id,
    });
    expect(result.newLeaderParticipantId).toBe(teamA.member.id);

    const [newLeaderRow] = await dbModule.db
      .select()
      .from(schema.teamMembers)
      .where(dbModule.and(dbModule.eq(schema.teamMembers.teamId, teamA.team.id), dbModule.eq(schema.teamMembers.participantId, teamA.member.id)));
    expect(newLeaderRow.role).toBe("leader");

    const [oldLeaderRow] = await dbModule.db
      .select()
      .from(schema.teamMembers)
      .where(dbModule.and(dbModule.eq(schema.teamMembers.teamId, teamA.team.id), dbModule.eq(schema.teamMembers.participantId, teamA.leader.id)));
    expect(oldLeaderRow.role).toBe("member");
  });

  it("lets staff transfer leadership for recovery, but refuses a random participant", async () => {
    const { event, moderator, teamA } = await createTestFixture(dbModule.db);
    const result = await engine.transferLeadership({
      eventId: event.id,
      teamId: teamA.team.id,
      requesterParticipantId: moderator.id,
      newLeaderParticipantId: teamA.member.id,
    });
    expect(result.newLeaderParticipantId).toBe(teamA.member.id);

    await expect(
      engine.transferLeadership({ eventId: event.id, teamId: teamA.team.id, requesterParticipantId: teamA.leader.id, newLeaderParticipantId: teamA.leader.id }),
    ).rejects.toMatchObject({ code: "forbidden" }); // teamA.leader is no longer the leader after the transfer above
  });

  it("refuses to make someone leader who isn't a member of that team", async () => {
    const { event, teamA, teamB } = await createTestFixture(dbModule.db);
    await expect(
      engine.transferLeadership({ eventId: event.id, teamId: teamA.team.id, requesterParticipantId: teamA.leader.id, newLeaderParticipantId: teamB.leader.id }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("joinTeam (unwired dead code - kept guarded even if it were ever reachable)", () => {
  it("refuses to join a team that already has its one login", async () => {
    const { event, moderator } = await createTestFixture(dbModule.db);
    const passwordHash = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8oxL/Yjyq6XvXqAtVvjGdiWZOWXQNi";

    // createTeamLogin only works pre-Stage-1; this fixture's event
    // starts at stage_1 for the auction tests, so back it up first -
    // joinTeam itself doesn't care about event status either way.
    await dbModule.db.update(schema.events).set({ status: "setup" }).where(dbModule.eq(schema.events.id, event.id));

    // A team shaped exactly like production ever creates one: one
    // participant, one team_members row (the leader), via
    // createTeamLogin - not the two-member test fixture above.
    const solo = await engine.createTeamLogin({ eventId: event.id, actorParticipantId: moderator.id, teamName: "SoloTeam", username: `solo-${event.id.slice(0, 8)}` });

    const [outsider] = await dbModule.db
      .insert(schema.participants)
      .values({ name: "Outsider", username: `outsider-${event.id.slice(0, 8)}`, passwordHash })
      .returning();

    await expect(
      engine.joinTeam({ eventId: event.id, participantId: outsider.id, code: solo.team.code }),
    ).rejects.toMatchObject({ code: "conflict" });

    // Confirmed still exactly one login on the team - the rejected
    // attempt never got as far as inserting a second row.
    const members = await dbModule.db.select().from(schema.teamMembers).where(dbModule.eq(schema.teamMembers.teamId, solo.team.id));
    expect(members).toHaveLength(1);
  });
});
