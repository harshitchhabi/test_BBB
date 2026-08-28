// Phase 0 seed runner: creates one event and populates every table that
// Section 9 Phase 0 says must be reviewable before game logic is touched —
// event + settings, materials, recipes, market shocks, and city blocks.
// It deliberately does NOT create teams, rounds, lots, or any Stage
// 1-3 runtime state — those are Phase 1+ concerns.
//
// Usage: DATABASE_URL=... npx tsx seed/run.ts ["Event name"] ["creator@email.com"]
//
// The creator email is optional but strongly recommended: it's stored as
// events.created_by and becomes the ONLY participant allowed to claim the
// first moderator slot for this event (see addEventStaff in
// packages/game-engine/src/team-service.ts) — without it, bootstrap falls
// back to "whoever claims it first," which is a real gap if the event
// id/link ever leaks before you get to /moderator/setup yourself. The
// email must belong to someone who has already signed into the app at
// least once (participants only exist after a Google sign-in), so seed
// the event, have your organizer account sign in once, then run the seed
// again with their email if you skipped it the first time — or just add
// yourself as staff manually via addEventStaff/the setup screen while
// created_by is still null, before sharing the link with anyone else.
import "dotenv/config";
import { db, eq } from "../index";
import {
  events,
  eventSettings,
  materialTypes,
  marketShockCards,
  buildingRecipes,
  recipeRequirements,
  cities,
  cityPreferences,
  participants,
} from "../schema";
import {
  MATERIAL_SEED,
  stickerPriceFor,
  MARKET_SHOCK_SEED,
  RECIPE_SEED,
  CITY_BLOCK_SEED,
  openingBidForTier,
} from "./data";

async function seed(eventName: string, creatorEmail?: string) {
  await db.transaction(async (tx) => {
    let createdBy: string | undefined;
    if (creatorEmail) {
      const [creator] = await tx.select().from(participants).where(eq(participants.email, creatorEmail));
      if (!creator) {
        throw new Error(
          `No participant with email "${creatorEmail}" has signed in yet. Have them sign into the app once first, then re-run this seed.`,
        );
      }
      createdBy = creator.id;
    } else {
      console.warn(
        "⚠️  No creator email given — this event's first moderator slot will be open to whoever claims it first. Pass an email to lock it down: npx tsx seed/run.ts \"Event name\" you@email.com",
      );
    }

    const [event] = await tx.insert(events).values({ name: eventName, createdBy }).returning();
    console.log(`Created event ${event.id} (${event.name})${createdBy ? ` — created_by locked to ${creatorEmail}` : ""}`);

    await tx.insert(eventSettings).values({ eventId: event.id });

    const insertedMaterials = await tx
      .insert(materialTypes)
      .values(
        MATERIAL_SEED.map((m) => ({
          eventId: event.id,
          key: m.key,
          name: m.name,
          unitLabel: m.unitLabel,
          stickerPrice: stickerPriceFor(m),
          isRare: m.isRare,
          isBonusOnly: m.isBonusOnly,
          sortOrder: m.sortOrder,
          defaultLotQuantity: m.lotQuantity,
          defaultOpeningBid: m.openingBid,
        })),
      )
      .returning();
    const materialIdByKey = new Map(insertedMaterials.map((m) => [m.key, m.id]));
    console.log(`Seeded ${insertedMaterials.length} material types`);

    await tx.insert(marketShockCards).values(
      MARKET_SHOCK_SEED.map((card) => ({
        eventId: event.id,
        key: card.key,
        title: card.title,
        description: card.description,
        effectJson: JSON.stringify(card.effect),
      })),
    );
    console.log(`Seeded ${MARKET_SHOCK_SEED.length} market shock cards`);

    const insertedRecipes = await tx
      .insert(buildingRecipes)
      .values(
        RECIPE_SEED.map((r) => ({
          eventId: event.id,
          key: r.key,
          name: r.name,
          basePoints: r.basePoints,
          sortOrder: r.sortOrder,
        })),
      )
      .returning();
    const recipeIdByKey = new Map(insertedRecipes.map((r) => [r.key, r.id]));

    const requirementRows = RECIPE_SEED.flatMap((r) =>
      Object.entries(r.requirements).map(([materialKey, requiredQuantity]) => {
        const materialTypeId = materialIdByKey.get(materialKey);
        if (!materialTypeId) {
          throw new Error(`Recipe "${r.key}" references unknown material "${materialKey}"`);
        }
        return {
          recipeId: recipeIdByKey.get(r.key)!,
          materialTypeId,
          requiredQuantity,
        };
      }),
    );
    await tx.insert(recipeRequirements).values(requirementRows);
    console.log(`Seeded ${insertedRecipes.length} recipes, ${requirementRows.length} requirement rows`);

    let cityCount = 0;
    let preferenceCount = 0;
    for (const block of CITY_BLOCK_SEED) {
      for (const city of block.cities) {
        const [insertedCity] = await tx
          .insert(cities)
          .values({
            eventId: event.id,
            blockNumber: block.block,
            name: city.name,
            tier: city.tier,
            openingBid: openingBidForTier(city.tier),
            hiddenMultiplier: city.multiplier,
            isTrap: "isTrap" in city ? Boolean(city.isTrap) : false,
            isSleeper: "isSleeper" in city ? Boolean(city.isSleeper) : false,
          })
          .returning();
        cityCount++;

        const preferenceRows = city.preferred.map((recipeKey) => {
          const buildingRecipeId = recipeIdByKey.get(recipeKey);
          if (!buildingRecipeId) {
            throw new Error(`City "${city.name}" prefers unknown recipe "${recipeKey}"`);
          }
          return { cityId: insertedCity.id, buildingRecipeId };
        });
        await tx.insert(cityPreferences).values(preferenceRows);
        preferenceCount += preferenceRows.length;
      }
    }
    console.log(
      `Seeded ${cityCount} cities across ${CITY_BLOCK_SEED.length} blocks (${preferenceCount} preference rows). ` +
        `Block 5 was NOT seeded — see BLOCK_5_MULTIPLIERS_ONLY_NO_TIER_DATA in seed/data.ts.`,
    );

    console.log(`\nEvent ${event.id} is ready for moderator review before any team/auction data is created.`);
  });
}

const eventName = process.argv[2] ?? "Bricks by Bid";
const creatorEmail = process.argv[3];
seed(eventName, creatorEmail)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
