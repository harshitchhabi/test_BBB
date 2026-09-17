// Phase 0 seed runner: creates one event and populates every table that
// Section 9 Phase 0 says must be reviewable before game logic is touched —
// event + settings, materials, recipes, market shocks, and city blocks.
// It deliberately does NOT create teams, rounds, lots, or any Stage
// 1-3 runtime state — those are Phase 1+ concerns.
//
// Usage: DATABASE_URL=... npx tsx seed/run.ts ["Event name"] ["admin-username"]
//
// Task 1: Google OAuth is gone, so there's no more "have the organizer
// sign in once first, then re-run the seed with their email." The admin
// username is optional but strongly recommended — when given, this
// mints the organizer's staff login directly (bcrypt-hashed password,
// printed once) and records events.created_by pointing at it, so the
// event never has a moment where its first staff slot is unclaimed and
// up for grabs by whoever gets to /moderator/setup first. Skip it only
// for local/dev use; you can still add staff manually afterward as long
// as you get there before anyone else does.
import "dotenv/config";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { db, eq } from "../index";
import {
  events,
  eventSettings,
  eventStaff,
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

const PASSWORD_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function generatePassword(length = 10): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length];
  return out;
}

async function seed(eventName: string, adminUsername?: string) {
  let issuedPassword: string | null = null;

  await db.transaction(async (tx) => {
    let createdBy: string | undefined;

    if (adminUsername) {
      const username = adminUsername.trim().toLowerCase();
      const [existing] = await tx.select({ id: participants.id }).from(participants).where(eq(participants.username, username));
      if (existing) {
        throw new Error(`Username "${username}" already exists. Pick a different one, or add staff later via the app.`);
      }
      issuedPassword = generatePassword();
      const passwordHash = await bcrypt.hash(issuedPassword, 10);
      const [admin] = await tx.insert(participants).values({ name: "Event Admin", username, passwordHash }).returning();
      createdBy = admin.id;
    } else {
      console.warn(
        '⚠️  No admin username given — this event has no staff login yet, and its first staff slot is open to whoever claims it first via the app. Pass a username to avoid that: npx tsx seed/run.ts "Event name" admin-username',
      );
    }

    const [event] = await tx.insert(events).values({ name: eventName, createdBy }).returning();
    console.log(`Created event ${event.id} (${event.name})`);

    if (createdBy) {
      await tx.insert(eventStaff).values({ eventId: event.id, participantId: createdBy });
      console.log(`Created the admin login and made it staff for this event.`);
    }

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
          splitLots: m.splitLots,
          reservedKitEligible: m.reservedKitEligible,
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

  if (adminUsername && issuedPassword) {
    console.log(`\nAdmin login — shown once, write it down now:`);
    console.log(`  Username: ${adminUsername.trim().toLowerCase()}`);
    console.log(`  Password: ${issuedPassword}`);
  }
}

const eventName = process.argv[2] ?? "Bricks by Bid";
const adminUsername = process.argv[3];
seed(eventName, adminUsername)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
