// Stage 2 fixture: an event already past the auction, with a small set of
// materials/recipes and teams pre-stocked directly via inventory ledger
// grants (standing in for "already won these at auction" — Stage 1's own
// mechanics are covered in auction-service.test.ts, this fixture only
// needs teams to already HAVE materials).
import type { db as DbType } from "db";
import {
  events,
  eventSettings,
  eventStaff,
  teams,
  teamMembers,
  participants,
  materialTypes,
  buildingRecipes,
  recipeRequirements,
  teamInventoryTransactions,
} from "db/schema";

export async function createStage2Fixture(db: typeof DbType) {
  const [event] = await db.insert(events).values({ name: "Stage 2 Test Event", status: "stage_2" }).returning();
  await db.insert(eventSettings).values({ eventId: event.id, inspectionsEnabled: true });

  const [moderator] = await db.insert(participants).values({ name: "Mod", email: `mod-${event.id}@test.local`, username: `mod-${event.id}`, passwordHash: "$2a$10$CwTycUXWue0Thq9StjUM0uJ8oxL/Yjyq6XvXqAtVvjGdiWZOWXQNi" }).returning();
  await db.insert(eventStaff).values({ eventId: event.id, participantId: moderator.id, role: "staff" });

  const materialSeed = [
    { key: "bricks", isRare: false, isBonusOnly: false },
    { key: "cement", isRare: false, isBonusOnly: false },
    { key: "wood", isRare: false, isBonusOnly: false },
    { key: "furniture", isRare: false, isBonusOnly: false },
    { key: "marble", isRare: false, isBonusOnly: false },
    { key: "tiles", isRare: false, isBonusOnly: false },
    { key: "solar", isRare: false, isBonusOnly: true },
    { key: "blueprint", isRare: false, isBonusOnly: true },
    { key: "steel", isRare: true, isBonusOnly: false },
  ];
  const materials: Record<string, { id: string; key: string }> = {};
  for (const [i, m] of materialSeed.entries()) {
    const [row] = await db
      .insert(materialTypes)
      .values({
        eventId: event.id,
        key: m.key,
        name: m.key,
        unitLabel: "units",
        stickerPrice: 10,
        isRare: m.isRare,
        isBonusOnly: m.isBonusOnly,
        sortOrder: i,
        defaultLotQuantity: 100,
        defaultOpeningBid: 100,
      })
      .returning();
    materials[m.key] = row;
  }

  const [park] = await db
    .insert(buildingRecipes)
    .values({ eventId: event.id, key: "park", name: "Park", basePoints: 13, sortOrder: 1 })
    .returning();
  await db.insert(recipeRequirements).values([
    { recipeId: park.id, materialTypeId: materials.bricks.id, requiredQuantity: 50 },
    { recipeId: park.id, materialTypeId: materials.cement.id, requiredQuantity: 20 },
    { recipeId: park.id, materialTypeId: materials.wood.id, requiredQuantity: 40 },
    { recipeId: park.id, materialTypeId: materials.furniture.id, requiredQuantity: 1 },
  ]);

  const [mall] = await db
    .insert(buildingRecipes)
    .values({ eventId: event.id, key: "mall", name: "Mall", basePoints: 88, sortOrder: 2 })
    .returning();
  await db.insert(recipeRequirements).values([
    { recipeId: mall.id, materialTypeId: materials.bricks.id, requiredQuantity: 200 },
    { recipeId: mall.id, materialTypeId: materials.tiles.id, requiredQuantity: 1 },
    { recipeId: mall.id, materialTypeId: materials.marble.id, requiredQuantity: 1 },
  ]);

  async function createTeamWithLeader(name: string, auctionTokens: number) {
    const [leader] = await db
      .insert(participants)
      .values({ name: `${name} Leader`, email: `${name.toLowerCase()}-${event.id}@test.local`, username: `${name.toLowerCase()}-leader-${event.id}`, passwordHash: "$2a$10$CwTycUXWue0Thq9StjUM0uJ8oxL/Yjyq6XvXqAtVvjGdiWZOWXQNi" })
      .returning();
    const [member] = await db
      .insert(participants)
      .values({ name: `${name} Member`, email: `${name.toLowerCase()}-member-${event.id}@test.local`, username: `${name.toLowerCase()}-member-${event.id}`, passwordHash: "$2a$10$CwTycUXWue0Thq9StjUM0uJ8oxL/Yjyq6XvXqAtVvjGdiWZOWXQNi" })
      .returning();
    const [team] = await db
      .insert(teams)
      .values({ eventId: event.id, name, code: name.toUpperCase().slice(0, 6), ownerParticipantId: leader.id, auctionTokens, cityWalletTokens: 500 })
      .returning();
    await db.insert(teamMembers).values({ eventId: event.id, teamId: team.id, participantId: leader.id, role: "leader" });
    await db.insert(teamMembers).values({ eventId: event.id, teamId: team.id, participantId: member.id, role: "member" });
    return { team, leader, member };
  }

  const teamA = await createTeamWithLeader("TeamA", 1000);
  const teamB = await createTeamWithLeader("TeamB", 1000);

  return { event, moderator, materials, recipes: { park, mall }, teamA, teamB };
}

export async function grantInventory(db: typeof DbType, eventId: string, teamId: string, materialTypeId: string, quantity: number) {
  await db.insert(teamInventoryTransactions).values({
    eventId,
    teamId,
    materialTypeId,
    quantityDelta: quantity,
    reason: "manual_adjustment",
  });
}
