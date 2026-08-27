import { NextResponse } from "next/server";
import { db, eq } from "db";
import { buildingRecipes, recipeRequirements, materialTypes } from "db/schema";
import { requireParticipant, apiErrorResponse } from "@/lib/api";

// GET /events/:id/recipes — backs the Build desk's recipe cards (Section
// 7.5) and the "can build now" filter, which needs each recipe's exact
// requirement list to compare against a team's live inventory client-side
// for display — the actual construction check still always happens
// server-side in constructBuilding regardless of what this shows.
export async function GET(_req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    await requireParticipant();

    const recipes = await db.select().from(buildingRecipes).where(eq(buildingRecipes.eventId, eventId));
    const requirements = await db
      .select({
        recipeId: recipeRequirements.recipeId,
        materialTypeId: recipeRequirements.materialTypeId,
        materialKey: materialTypes.key,
        materialName: materialTypes.name,
        requiredQuantity: recipeRequirements.requiredQuantity,
      })
      .from(recipeRequirements)
      .innerJoin(materialTypes, eq(recipeRequirements.materialTypeId, materialTypes.id))
      .where(eq(materialTypes.eventId, eventId));

    const requirementsByRecipe = new Map<string, typeof requirements>();
    for (const req of requirements) {
      if (!requirementsByRecipe.has(req.recipeId)) requirementsByRecipe.set(req.recipeId, []);
      requirementsByRecipe.get(req.recipeId)!.push(req);
    }

    return NextResponse.json({
      recipes: recipes
        .filter((r) => r.active)
        .map((r) => ({ ...r, requirements: requirementsByRecipe.get(r.id) ?? [] })),
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
